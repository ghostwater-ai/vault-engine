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
 * Queries the vault index and returns ranked results.
 *
 * Pipeline:
 * 1. Preprocess query using processTerm (stemming, stopwords, case normalization)
 * 2. MiniSearch BM25 search with fuzzy + prefix → raw scores
 * 3. Normalize BM25 scores: s / (1 + s)
 * 4. Apply BM25 floor filter (default 0.10)
 * 5. Compute compound score per result (multiplicative formula)
 * 6. Apply compound score threshold (default 0.30)
 * 7. Sort by final score and return top N (default 3)
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

  // Step 7: Sort by score (descending) and take top N
  thresholdedResults.sort((a, b) => b.score - a.score);
  const topResults = thresholdedResults.slice(0, maxResults ?? DEFAULT_QUERY_OPTIONS.maxResults);

  const endTime = performance.now();

  return {
    results: topResults,
    tier: 0, // Always Tier 0 for MVP
    latencyMs: endTime - startTime,
    query: text,
  };
}
