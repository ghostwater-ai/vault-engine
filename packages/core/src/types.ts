/**
 * Core type definitions for vault-engine.
 *
 * These types represent parsed vault notes with all metadata needed for
 * indexing, scoring, and retrieval.
 */

/**
 * The 7 supported note types in a vault.
 * - experience: Raw evidence from past events
 * - research: Reference material and findings
 * - belief: Synthesized understanding and positions
 * - entity: Reference data about people, orgs, tools
 * - bet: Forward-looking predictions
 * - question: Open unknowns being explored
 * - topic: Navigational map pages (from _topics/ directory)
 */
export type NoteType =
  | 'experience'
  | 'research'
  | 'belief'
  | 'entity'
  | 'bet'
  | 'question'
  | 'topic';

/**
 * A parsed body section from a vault note.
 * Body sections are delimited by ## headers in the markdown.
 */
export interface BodySection {
  /** The section header name (without the ## prefix) */
  name: string;
  /** The section content (markdown text between headers) */
  content: string;
}

/**
 * A parsed vault document with all extracted metadata.
 *
 * All frontmatter fields are optional to support graceful degradation
 * for incomplete or malformed notes.
 */
export interface VaultDocument {
  /** Absolute path to the source file */
  path: string;

  /** URL-safe identifier derived from the file path */
  slug: string;

  /** The type of note (experience, research, belief, etc.) */
  noteType: NoteType;

  /** The note title (from filename or frontmatter) */
  title: string;

  /** Short summary of the note (from frontmatter) */
  description?: string;

  /** List of topic tags (from frontmatter) */
  topics?: string[];

  /** Status of the note - meaning varies by note type */
  status?: string;

  /** Confidence level for belief notes (high, medium, low) */
  confidence?: string;

  /** Maturity level for belief notes (evergreen, developing, seedling) */
  maturity?: string;

  /** Source or origin of the information */
  provenance?: string;

  /** Creation or event date */
  date?: string;

  /** Last update timestamp */
  updatedAt?: string;

  /** Connected notes - from frontmatter and [[wiki-links]] in body */
  connections?: string[];

  /** Parsed body sections split on ## headers */
  bodySections: BodySection[];

  /** The raw markdown body (without frontmatter) */
  rawBody: string;
}

/**
 * Options for the query function.
 *
 * All options are optional and have sensible defaults.
 */
export interface QueryOptions {
  /** Maximum number of results to return (default: 3) */
  maxResults?: number;

  /** Minimum compound score threshold (default: 0.30) */
  minScore?: number;

  /** Minimum BM25 normalized score floor (default: 0.10) */
  minBm25Score?: number;

  /** Filter results to only these note types */
  noteTypes?: NoteType[];

  /** Token budget for results (for formatting — not used in core) */
  tokenBudget?: number;

  /** Context string for post-hoc re-ranking by term overlap */
  context?: string;
}

/**
 * Result of a query operation.
 *
 * Includes ranked results, tier metadata, and latency timing.
 */
export interface QueryResult {
  /** Ranked results sorted by final score (descending) */
  results: import('./scoring.js').ScoredDocument[];

  /** Retrieval tier used (0 = BM25 only for MVP) */
  tier: number;

  /** Query latency in milliseconds */
  latencyMs: number;

  /** The original query string */
  query: string;

  /** Context terms extracted (only present when context was provided) */
  contextTerms?: string[];
}
