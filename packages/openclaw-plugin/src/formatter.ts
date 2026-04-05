import type { QueryResult, ScoredDocument } from '@ghostwater/vault-engine';

export interface InjectionFormatOptions {
  maxTokens: number;
}

const HEADER = '## Vault Context';
const PER_RESULT_TOKEN_CAP = 400;

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

  const chunks: string[] = [HEADER];
  let usedTokens = estimateTokenCount(HEADER);

  for (const result of queryResult.results) {
    const rawChunk = formatResult(result);
    const cappedChunk = truncateToTokenCap(rawChunk, PER_RESULT_TOKEN_CAP);
    const chunkTokens = estimateTokenCount(cappedChunk);

    if (usedTokens + chunkTokens > options.maxTokens) {
      break;
    }

    chunks.push(cappedChunk);
    usedTokens += chunkTokens;
  }

  if (chunks.length === 1) {
    return undefined;
  }

  return chunks.join('\n\n');
}
