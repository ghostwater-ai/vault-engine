/**
 * Retrieval API for vault-engine.
 *
 * Implements the core query pipeline:
 * 1. Preprocess query (stem, normalize, strip stopwords)
 * 2. MiniSearch BM25 search with fuzzy + prefix
 * 3. Normalize BM25 scores: s / (1 + s)
 * 4. Apply BM25 floor filter (default 0.10)
 * 5. Compute compound score per result
 * 6. Apply compound score threshold (default 0.30)
 * 7. Sort by final score and return top N (default 3)
 *
 * @see PRODUCT.md UAC-011, UAC-012, UAC-014
 */

import type { VaultIndex } from './indexer.js';
import { processTerm } from './indexer.js';
import {
  computeScore,
  type ScoredDocument,
  type ScoringConfig,
  DEFAULT_SCORING_CONFIG,
} from './scoring.js';
import type { QueryOptions, QueryResult } from './types.js';

/**
 * Default options for the query function.
 */
export const DEFAULT_QUERY_OPTIONS = {
  maxResults: 3,
  minScore: 0.3,
  minBm25Score: 0.1,
} as const;

/**
 * Configuration for the retrieval engine.
 */
export interface RetrievalConfig {
  /** Scoring configuration for compound score calculation */
  scoring?: ScoringConfig;
  /** Default query options */
  defaults?: Partial<QueryOptions>;
}

/**
 * Tokenizes a string into processed terms using the same pipeline as indexing.
 *
 * Applies: lowercase normalization, stopword removal, and English stemming.
 *
 * @param text - The text to tokenize
 * @returns Array of processed, unique terms
 */
export function tokenize(text: string): string[] {
  // Split on whitespace and common punctuation
  const rawTerms = text.split(/[\s,;:!?.()[\]{}'"]+/);
  const processed = new Set<string>();

  for (const term of rawTerms) {
    if (!term) continue;
    const result = processTerm(term);
    if (result) {
      processed.add(result);
    }
  }

  return Array.from(processed);
}

/**
 * Computes the fraction of context keywords that appear in a document.
 *
 * @param doc - The VaultDocument to check
 * @param contextTerms - Set of stemmed context terms
 * @returns Fraction of context terms found in the document (0 to 1)
 */
function computeContextOverlap(doc: import('./types.js').VaultDocument, contextTerms: Set<string>): number {
  if (contextTerms.size === 0) return 0;

  // Tokenize the document content
  const docText = [
    doc.title,
    doc.description ?? '',
    doc.topics?.join(' ') ?? '',
    doc.rawBody,
  ].join(' ');

  const docTerms = new Set(tokenize(docText));

  // Count how many context terms appear in the document
  let matches = 0;
  for (const term of contextTerms) {
    if (docTerms.has(term)) {
      matches++;
    }
  }

  return matches / contextTerms.size;
}

/**
 * Threshold for determining if two scores are "similar" for context re-ranking.
 * Results within this score difference are considered similar and can be
 * re-ordered by context relevance without violating BM25 primacy.
 */
const SIMILARITY_THRESHOLD = 0.05;

/**
 * Re-ranks results by context overlap as a tiebreaker for similarly-scored results.
 *
 * This preserves BM25 primacy: results with significantly different scores
 * maintain their relative order. Only results within SIMILARITY_THRESHOLD
 * of each other can be re-ordered by context relevance.
 *
 * @param results - Array of scored documents to re-rank
 * @param contextTerms - Set of stemmed context terms
 * @returns Re-ranked results with contextOverlap populated
 */
function reRankByContext(
  results: ScoredDocument[],
  contextTerms: Set<string>
): ScoredDocument[] {
  if (results.length === 0 || contextTerms.size === 0) {
    return results;
  }

  // First, compute contextOverlap for all results
  const resultsWithOverlap = results.map((r) => ({
    ...r,
    contextOverlap: computeContextOverlap(r.doc, contextTerms),
  }));

  // Sort with a stable algorithm that preserves BM25 primacy:
  // - Results with significantly different scores maintain score order
  // - Results with similar scores (within SIMILARITY_THRESHOLD) are ordered by contextOverlap
  resultsWithOverlap.sort((a, b) => {
    const scoreDiff = b.score - a.score;

    // If scores are significantly different, sort by score (BM25 primacy)
    if (Math.abs(scoreDiff) > SIMILARITY_THRESHOLD) {
      return scoreDiff;
    }

    // Scores are similar - use context overlap as tiebreaker
    const overlapDiff = (b.contextOverlap ?? 0) - (a.contextOverlap ?? 0);
    if (overlapDiff !== 0) {
      return overlapDiff;
    }

    // If overlap is also equal, maintain score order
    return scoreDiff;
  });

  return resultsWithOverlap;
}

/**
 * Queries the vault index and returns ranked results.
 *
 * Pipeline:
 * 1. Preprocess query using processTerm (stemming, stopwords, case normalization)
 * 2. MiniSearch BM25 search with fuzzy + prefix → raw scores
 * 3. Normalize BM25 scores: s / (1 + s)
 * 4. Apply BM25 floor filter (default 0.10)
 * 5. Compute compound score per result (multiplicative formula)
 * 6. Apply compound score threshold (default 0.30)
 * 7. If context provided, post-hoc re-rank by context term overlap
 * 8. Sort by final score and return top N (default 3)
 *
 * @param index - The VaultIndex to search
 * @param text - The query text
 * @param options - Optional query configuration
 * @param config - Optional retrieval configuration (scoring, defaults)
 * @returns QueryResult with ranked results
 */
export function query(
  index: VaultIndex,
  text: string,
  options?: QueryOptions,
  config?: RetrievalConfig
): QueryResult {
  const startTime = performance.now();

  // Merge options with defaults
  const mergedOptions = {
    ...DEFAULT_QUERY_OPTIONS,
    ...config?.defaults,
    ...options,
  };

  const {
    maxResults,
    minScore,
    minBm25Score,
    noteTypes,
    context,
  } = mergedOptions;

  // Get scoring config
  const scoringConfig: ScoringConfig = config?.scoring
    ? { ...config.scoring, bm25Floor: minBm25Score ?? config.scoring.bm25Floor }
    : { ...DEFAULT_SCORING_CONFIG, bm25Floor: minBm25Score ?? DEFAULT_SCORING_CONFIG.bm25Floor };

  // Step 1-2: MiniSearch handles query preprocessing internally via processTerm
  // Search with fuzzy + prefix (configured in VaultIndex)
  const searchResults = index.search(text);

  // Step 3-5: Score and filter results
  const scoredResults: ScoredDocument[] = [];

  for (const result of searchResults) {
    const doc = index.getDocument(result.id);
    if (!doc) continue;

    // Apply noteTypes filter
    if (noteTypes && noteTypes.length > 0 && !noteTypes.includes(doc.noteType)) {
      continue;
    }

    // Extract matched fields from MiniSearch result
    const matchedFields = Object.keys(result.match);

    // Compute score (handles BM25 normalization and floor filtering)
    const scored = computeScore(doc, result.score, scoringConfig, {
      matchedFields,
    });

    // Skip if below BM25 floor (computeScore returns null)
    if (!scored) continue;

    scoredResults.push(scored);
  }

  // Step 6: Apply compound score threshold
  const thresholdedResults = scoredResults.filter(
    (r) => r.score >= (minScore ?? DEFAULT_QUERY_OPTIONS.minScore)
  );

  // Sort by score (descending) before context re-ranking or final selection
  thresholdedResults.sort((a, b) => b.score - a.score);

  // Step 7: Context re-ranking (if context provided)
  let contextTerms: string[] | undefined;
  let finalResults: ScoredDocument[];

  if (context && context.trim()) {
    // Tokenize context using same processTerm pipeline
    const terms = tokenize(context);
    contextTerms = terms;
    const contextTermSet = new Set(terms);

    // Re-rank by context overlap (tiebreaker only)
    const reranked = reRankByContext(thresholdedResults, contextTermSet);
    finalResults = reranked.slice(0, maxResults ?? DEFAULT_QUERY_OPTIONS.maxResults);
  } else {
    // No context - just take top N
    finalResults = thresholdedResults.slice(0, maxResults ?? DEFAULT_QUERY_OPTIONS.maxResults);
  }

  const endTime = performance.now();

  const result: QueryResult = {
    results: finalResults,
    tier: 0, // Always Tier 0 for MVP
    latencyMs: endTime - startTime,
    query: text,
  };

  // Include contextTerms only when context was provided
  if (contextTerms !== undefined) {
    result.contextTerms = contextTerms;
  }

  return result;
}
