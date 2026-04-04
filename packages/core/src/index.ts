export type { NoteType, BodySection, VaultDocument, QueryOptions, QueryResult } from './types.js';
export { parseFile, parseVaultDirectory } from './parser.js';
export {
  VaultIndex,
  rebuildIndex,
  processTerm,
  type IndexStats,
  type VaultSearchResult,
} from './indexer.js';
export { VaultWatcher } from './watcher.js';
export {
  DEFAULT_SCORING_CONFIG,
  computeScore,
  normalizeBm25,
  type ScoringConfig,
  type ScoredDocument,
  type ComputeScoreOptions,
} from './scoring.js';
export {
  query,
  tokenize,
  DEFAULT_QUERY_OPTIONS,
  type RetrievalConfig,
} from './retrieval.js';
