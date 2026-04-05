import type { QueryResult, ScoredDocument } from '@ghostwater/vault-engine';

export interface InjectionFormatOptions {
  maxTokens: number;
}

const HEADER = '## Vault Context';
const MAX_RESULTS = 3;
const PER_RESULT_TOKEN_CAP = 400;
const TOTAL_TOKEN_CAP = 1500;
const SEPARATOR = '\n\n';

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

function formatResult(result: ScoredDocument): string {
  const status = result.doc.status ?? 'unknown';
  const header = `[${result.doc.noteType}|${status}] ${result.doc.title}`;

  if (!result.doc.description) {
    return header;
  }

  return `${header}\n${result.doc.description}`;
}

export function formatAppendSystemContext(
  queryResult: QueryResult,
  options: InjectionFormatOptions
): string | undefined {
  if (queryResult.results.length === 0) {
    return undefined;
  }

  const availableTokens = Math.min(TOTAL_TOKEN_CAP, Math.max(1, Math.floor(options.maxTokens)));
  const selectedResults = queryResult.results.slice(0, MAX_RESULTS);
  const usedTokens = estimateTokenCount(HEADER);
  if (usedTokens > availableTokens) {
    return undefined;
  }

  const chunks: Array<{ text: string; tokens: number }> = [];
  for (const result of selectedResults) {
    const rawChunk = formatResult(result);
    const text = truncateToTokenCap(rawChunk, PER_RESULT_TOKEN_CAP);
    const tokens = estimateTokenCount(text);
    chunks.push({ text, tokens });
  }

  const separatorTokens = estimateTokenCount(SEPARATOR);
  let totalTokens = usedTokens + chunks.reduce((acc, chunk) => acc + chunk.tokens + separatorTokens, 0);
  while (totalTokens > availableTokens && chunks.length > 0) {
    const removed = chunks.pop();
    if (!removed) {
      break;
    }
    totalTokens -= removed.tokens + separatorTokens;
  }

  if (chunks.length === 0) {
    return undefined;
  }

  return [HEADER, ...chunks.map((chunk) => chunk.text)].join(SEPARATOR);
}
