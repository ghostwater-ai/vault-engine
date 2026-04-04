/**
 * Scoring engine types and configuration for vault-engine.
 *
 * Implements multiplicative compound scoring that preserves BM25 primacy
 * while amplifying results based on note type and epistemic quality.
 *
 * Formula: compound = bm25_normalized × (1 + type_boost + confidence_modifier)
 *
 * @see PRODUCT.md UAC-006, UAC-007, UAC-008, UAC-010
 */

import type { NoteType, VaultDocument } from './types.js';

/**
 * Configuration for compound scoring.
 *
 * All weights and thresholds are configurable to allow tuning
 * based on vault characteristics and usage patterns.
 */
export interface ScoringConfig {
  /**
   * Type boost values per note type.
   * Applied as part of the multiplicative factor: (1 + type_boost + confidence_modifier)
   */
  typeBoosts: Record<NoteType, number>;

  /**
   * Confidence modifiers for belief notes.
   * Higher confidence beliefs get boosted.
   */
  confidenceModifiers: {
    high: number;
    medium: number;
    low: number;
  };

  /**
   * Status modifiers for research notes.
   * Higher quality research (proven, battle-tested) gets boosted.
   */
  statusModifiers: {
    proven: number;
    'battle-tested': number;
    'benchmarks-only': number;
    anecdotal: number;
    theoretical: number;
    opinion: number;
  };

  /**
   * Maturity modifiers for belief notes.
   * Evergreen beliefs get boosted, seedlings get penalized.
   */
  maturityModifiers: {
    evergreen: number;
    developing: number;
    seedling: number;
  };

  /**
   * Minimum BM25 normalized score to consider a document.
   * Documents below this floor are excluded before compound scoring.
   */
  bm25Floor: number;
}

/**
 * Default scoring configuration.
 *
 * Type boosts reflect epistemic value:
 * - beliefs (+0.15): Synthesized understanding — highest epistemic value
 * - research (+0.05): Reference material — useful but not our position
 * - experiences (+0.00): Raw evidence — relevant when query is about events
 * - entities (+0.00): Reference data — high for "what is X?" queries
 * - topics (+0.00): Navigational map pages — useful for broad queries
 * - bets (-0.05): Forward-looking — rarely relevant for passive injection
 * - questions (-0.10): Open unknowns — almost never passively injected
 */
export const DEFAULT_SCORING_CONFIG: ScoringConfig = {
  typeBoosts: {
    belief: 0.15,
    research: 0.05,
    experience: 0.0,
    entity: 0.0,
    topic: 0.0,
    bet: -0.05,
    question: -0.1,
  },

  confidenceModifiers: {
    high: 0.1,
    medium: 0.05,
    low: 0.0,
  },

  statusModifiers: {
    proven: 0.1,
    'battle-tested': 0.05,
    'benchmarks-only': 0.02,
    anecdotal: 0.0,
    theoretical: -0.03,
    opinion: -0.05,
  },

  maturityModifiers: {
    evergreen: 0.05,
    developing: 0.0,
    seedling: -0.03,
  },

  bm25Floor: 0.1,
};

/**
 * A document with computed compound score and scoring breakdown.
 *
 * Includes all components needed to understand why a document
 * received its score, supporting the `--explain` flag.
 */
export interface ScoredDocument {
  /** The original vault document */
  doc: VaultDocument;

  /** Final compound score: bm25_normalized × (1 + type_boost + confidence_modifier) */
  score: number;

  /** Raw BM25 score from MiniSearch */
  bm25Raw: number;

  /** Normalized BM25 score: raw / (1 + raw), maps to [0, 1) */
  bm25Normalized: number;

  /** Type boost applied based on note type */
  typeBoost: number;

  /**
   * Combined confidence/status/maturity modifier applied.
   * For beliefs: confidence + maturity modifiers
   * For research: status modifier
   * For other types: 0
   */
  confidenceModifier: number;

  /** Fields that matched the query (title, description, body, topics) */
  matchedFields: string[];

  /**
   * Human-readable explanation of the scoring breakdown.
   * Format: "BM25: 0.42 (raw: 0.72) × (1 + type:+0.15 + confidence:+0.10) = 0.525"
   */
  explanation: string;
}
