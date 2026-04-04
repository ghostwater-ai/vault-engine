export type { NoteType, BodySection, VaultDocument } from './types.js';
export { parseFile, parseVaultDirectory } from './parser.js';
export {
  VaultIndex,
  rebuildIndex,
  type IndexStats,
  type VaultSearchResult,
} from './indexer.js';
