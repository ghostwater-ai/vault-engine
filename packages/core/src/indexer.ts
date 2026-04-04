/**
 * VaultIndex: In-memory MiniSearch index for vault documents.
 *
 * Provides BM25 search with field boosting, stemming, and stopword removal.
 * Designed to index VaultDocument objects parsed from markdown vault notes.
 */

import MiniSearch, { type SearchResult } from 'minisearch';
import { stemmer } from 'stemmer';
import { parseVaultDirectory } from './parser.js';
import type { NoteType, VaultDocument } from './types.js';

/**
 * English stopwords list for filtering common words during indexing and search.
 * These words are filtered out because they don't contribute to search relevance.
 */
const ENGLISH_STOPWORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'but',
  'by',
  'for',
  'if',
  'in',
  'into',
  'is',
  'it',
  'no',
  'not',
  'of',
  'on',
  'or',
  'such',
  'that',
  'the',
  'their',
  'then',
  'there',
  'these',
  'they',
  'this',
  'to',
  'was',
  'will',
  'with',
]);

/**
 * Processes a term for indexing and searching.
 * Applies lowercase normalization, stopword removal, and English stemming.
 *
 * This function is exported so the retrieval module can use the same
 * term processing for query preprocessing and context tokenization.
 *
 * @param term - The term to process
 * @returns The processed term, or null/undefined to filter out the term
 */
export function processTerm(term: string): string | null | undefined {
  // Lowercase normalization
  const lower = term.toLowerCase();

  // Filter out stopwords
  if (ENGLISH_STOPWORDS.has(lower)) {
    return null;
  }

  // Apply English stemming
  return stemmer(lower);
}

/**
 * Document structure used internally by MiniSearch.
 * Maps VaultDocument fields to indexable format.
 */
interface IndexedDocument {
  /** Unique identifier (document path) */
  id: string;
  /** Document title */
  title: string;
  /** Document description */
  description: string;
  /** Topics as space-separated string */
  topics: string;
  /** Raw body content */
  body: string;
}

/**
 * Statistics about the vault index.
 */
export interface IndexStats {
  /** Total number of documents in the index */
  documentCount: number;
  /** Distribution of documents by note type */
  typeDistribution: Record<NoteType, number>;
  /** Approximate size of the index in bytes */
  indexSizeBytes: number;
  /** ISO timestamp of the last full index build, or empty string if not built */
  lastBuildTime: string;
}

/**
 * Search result from MiniSearch with BM25 score.
 */
export interface VaultSearchResult extends SearchResult {
  /** Document path (id) */
  id: string;
  /** Raw BM25 score from MiniSearch */
  score: number;
  /** Fields that matched the query */
  match: Record<string, string[]>;
  /** Query terms that matched */
  terms: string[];
}

/**
 * VaultIndex provides full-text search over vault documents using MiniSearch.
 *
 * Features:
 * - BM25 scoring with field boosting (title:5, description:3, topics:2, body:1)
 * - English stemming via the stemmer package
 * - Stopword removal
 * - Fuzzy matching (0.2 tolerance)
 * - Prefix search
 */
export class VaultIndex {
  private miniSearch: MiniSearch<IndexedDocument>;
  private documents: Map<string, VaultDocument>;
  private lastBuildTime: string = '';

  constructor() {
    this.documents = new Map();
    this.miniSearch = new MiniSearch<IndexedDocument>({
      fields: ['title', 'description', 'topics', 'body'],
      storeFields: ['title', 'description', 'topics', 'body'],
      idField: 'id',
      processTerm,
      searchOptions: {
        boost: {
          title: 5,
          description: 3,
          topics: 2,
          body: 1,
        },
        fuzzy: 0.2,
        prefix: true,
      },
    });
  }

  /**
   * Converts a VaultDocument to the indexed document format.
   */
  private toIndexedDocument(doc: VaultDocument): IndexedDocument {
    return {
      id: doc.path,
      title: doc.title,
      description: doc.description ?? '',
      topics: doc.topics?.join(' ') ?? '',
      body: doc.rawBody,
    };
  }

  /**
   * Adds a single document to the index.
   *
   * @param doc - The VaultDocument to add
   * @throws Error if a document with the same path already exists
   */
  addDocument(doc: VaultDocument): void {
    if (this.documents.has(doc.path)) {
      throw new Error(`Document already exists: ${doc.path}`);
    }

    this.documents.set(doc.path, doc);
    this.miniSearch.add(this.toIndexedDocument(doc));
  }

  /**
   * Removes a document from the index by its path.
   *
   * @param id - The document path (id) to remove
   * @throws Error if the document does not exist
   */
  removeDocument(id: string): void {
    const doc = this.documents.get(id);
    if (!doc) {
      throw new Error(`Document not found: ${id}`);
    }

    this.miniSearch.remove(this.toIndexedDocument(doc));
    this.documents.delete(id);
  }

  /**
   * Updates a document in the index. Removes the old version and adds the new one.
   *
   * @param doc - The updated VaultDocument
   * @throws Error if the document does not exist
   */
  updateDocument(doc: VaultDocument): void {
    const existingDoc = this.documents.get(doc.path);
    if (!existingDoc) {
      throw new Error(`Document not found: ${doc.path}`);
    }

    this.miniSearch.remove(this.toIndexedDocument(existingDoc));
    this.documents.set(doc.path, doc);
    this.miniSearch.add(this.toIndexedDocument(doc));
  }

  /**
   * Searches the index with the given query.
   *
   * @param query - The search query string
   * @returns Array of search results with BM25 scores
   */
  search(query: string): VaultSearchResult[] {
    return this.miniSearch.search(query) as VaultSearchResult[];
  }

  /**
   * Gets a document by its path.
   *
   * @param id - The document path
   * @returns The VaultDocument or undefined if not found
   */
  getDocument(id: string): VaultDocument | undefined {
    return this.documents.get(id);
  }

  /**
   * Returns statistics about the current index state.
   */
  getStats(): IndexStats {
    const typeDistribution: Record<NoteType, number> = {
      experience: 0,
      research: 0,
      belief: 0,
      entity: 0,
      bet: 0,
      question: 0,
      topic: 0,
    };

    for (const doc of this.documents.values()) {
      typeDistribution[doc.noteType]++;
    }

    // Estimate index size by serializing the MiniSearch index to JSON
    // This provides a rough approximation of actual memory usage
    let indexSizeBytes: number;
    try {
      indexSizeBytes = JSON.stringify(this.miniSearch).length;
    } catch {
      // Fallback to rough estimate if serialization fails
      const avgDocSize = 2000;
      const indexOverhead = 1.5;
      indexSizeBytes = Math.round(this.documents.size * avgDocSize * indexOverhead);
    }

    return {
      documentCount: this.documents.size,
      typeDistribution,
      indexSizeBytes,
      lastBuildTime: this.lastBuildTime,
    } satisfies IndexStats;
  }

  /**
   * Clears all documents from the index.
   */
  clear(): void {
    this.miniSearch.removeAll();
    this.documents.clear();
    this.lastBuildTime = '';
  }

  /**
   * Builds the index from all documents in a vault directory.
   * Clears any existing index data before building.
   *
   * @param vaultPath - Absolute path to the vault root directory
   * @returns The number of documents indexed
   */
  async buildIndex(vaultPath: string): Promise<number> {
    // Clear existing index
    this.clear();

    // Parse all documents from vault
    const docs = await parseVaultDirectory(vaultPath);

    // Add all documents to index
    for (const doc of docs) {
      this.documents.set(doc.path, doc);
      this.miniSearch.add(this.toIndexedDocument(doc));
    }

    this.lastBuildTime = new Date().toISOString();

    return docs.length;
  }
}

/**
 * Creates a new VaultIndex and builds it from the given vault path.
 *
 * @param vaultPath - Absolute path to the vault root directory
 * @returns A promise resolving to the built VaultIndex
 */
export async function rebuildIndex(vaultPath: string): Promise<VaultIndex> {
  const index = new VaultIndex();
  await index.buildIndex(vaultPath);
  return index;
}
