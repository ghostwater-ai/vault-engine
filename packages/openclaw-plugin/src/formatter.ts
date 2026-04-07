import type { QueryResult, ScoredDocument } from '@ghostwater/vault-engine';
import type { VaultMode } from './runtime.js';

export interface InjectionFormatOptions {
  maxTokens: number;
  availableVaults?: Array<{
    name: string;
    description: string;
    mode: VaultMode;
  }>;
}

const HEADER = '## Vault Context';
const MAX_RESULTS = 3;
const PER_RESULT_TOKEN_CAP = 400;
const TOTAL_TOKEN_CAP = 1500;
const SEPARATOR = '\n\n';
const EXPLANATION =
  'Vaults are curated knowledge bases. Use `vault_query` when you need deeper or targeted retrieval.';

function estimateTokenCount(text: string): number {
  return Math.ceil(text.length / 4);
}

function truncateToTokenCap(text: string, maxTokens: number): string {
  const maxChars = maxTokens * 4;
  if (text.length <= maxChars) {
    return text;
  }

  return `${text.slice(0, Math.max(0, maxChars - 3)).trimEnd()}...`;
}

function selectSecondaryMetadata(result: ScoredDocument): string | undefined {
  const { doc } = result;
  if (doc.noteType === 'belief') {
    return doc.confidence ?? doc.maturity;
  }

  if (doc.noteType === 'research') {
    return doc.status;
  }

  return doc.status ?? doc.provenance ?? doc.date ?? doc.updatedAt;
}

function formatResult(result: ScoredDocument): string {
  const secondary = selectSecondaryMetadata(result);
  const prefix = secondary
    ? `[${result.doc.noteType}|${secondary}]`
    : `[${result.doc.noteType}]`;
  const header = `${prefix} ${result.doc.title}`;

  if (!result.doc.description) {
    return header;
  }

  return `${header}\n${result.doc.description}`;
}

function formatAvailableVault(vault: { name: string; description: string; mode: VaultMode }): string {
  const modeLabel = vault.mode === 'query-only' ? ' (query-only)' : '';
  return `- ${vault.name}${modeLabel}: ${vault.description}`;
}

interface PassiveResultWithVaultMetadata extends ScoredDocument {
  vaultName?: string;
}

interface FormattedPassiveChunk {
  vaultName: string;
  text: string;
}

function renderGroupedResultSections(chunks: FormattedPassiveChunk[]): string[] {
  const sections: string[] = [];
  let currentVaultName: string | undefined;

  for (const chunk of chunks) {
    const vaultName = chunk.vaultName;
    if (vaultName !== currentVaultName) {
      sections.push(`### ${vaultName}`);
      currentVaultName = vaultName;
    }
    sections.push(chunk.text);
  }

  return sections;
}

export function formatAppendSystemContext(
  queryResult: QueryResult,
  options: InjectionFormatOptions
): string | undefined {
  if (queryResult.results.length === 0) {
    return undefined;
  }

  const availableTokens = Math.min(TOTAL_TOKEN_CAP, Math.max(1, Math.floor(options.maxTokens)));
  const selectedResults = queryResult.results.slice(0, MAX_RESULTS) as PassiveResultWithVaultMetadata[];

  const formattedChunks = selectedResults.map((result) => {
    const rawChunk = formatResult(result);
    const text = truncateToTokenCap(rawChunk, PER_RESULT_TOKEN_CAP);
    return {
      vaultName: result.vaultName ?? 'Unknown Vault',
      text,
    };
  });

  const availableVaults = options.availableVaults ?? [];
  const baseParts = [HEADER, EXPLANATION];
  if (availableVaults.length > 0) {
    baseParts.push(['Available vaults:', ...availableVaults.map((vault) => formatAvailableVault(vault))].join('\n'));
  }
  const baseText = baseParts.join(SEPARATOR);
  if (estimateTokenCount(baseText) > availableTokens) {
    return undefined;
  }

  let keptChunks = [...formattedChunks];
  while (keptChunks.length > 0) {
    const groupedSections = renderGroupedResultSections(keptChunks);
    const rendered = [...baseParts, ...groupedSections].join(SEPARATOR);
    if (estimateTokenCount(rendered) <= availableTokens) {
      return rendered;
    }
    keptChunks.pop();
  }

  return undefined;
}
