export type { NoteType, BodySection, VaultDocument } from './types.js';
export { parseFile, parseVaultDirectory } from './parser.js';
export {
  VaultIndex,
  rebuildIndex,
  type IndexStats,
  type VaultSearchResult,
} from './indexer.js';
export { VaultWatcher } from './watcher.js';
export {
  DEFAULT_SCORING_CONFIG,
  type ScoringConfig,
  type ScoredDocument,
} from './scoring.js';
