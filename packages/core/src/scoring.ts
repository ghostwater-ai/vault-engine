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

/**
 * Options for computeScore function.
 */
export interface ComputeScoreOptions {
  /** Fields that matched the query */
  matchedFields?: string[];
}

/**
 * Normalizes a raw BM25 score to the range [0, 1).
 *
 * Formula: bm25_normalized = raw / (1 + raw)
 *
 * This transforms unbounded BM25 scores into a bounded range
 * while preserving relative ordering.
 */
export function normalizeBm25(raw: number): number {
  return raw / (1 + raw);
}

/**
 * Formats a number with explicit sign prefix.
 * @param value - The number to format
 * @returns String with +/- prefix and 2 decimal places
 */
function formatSignedNumber(value: number): string {
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}`;
}

/**
 * Gets the modifier label for explanation based on note type.
 */
function getModifierLabel(noteType: NoteType): string {
  switch (noteType) {
    case 'belief':
      return 'confidence';
    case 'research':
      return 'status';
    default:
      return 'modifier';
  }
}

/**
 * Computes the compound score for a vault document.
 *
 * This is a pure, stateless function that applies BM25 normalization
 * and multiplicative compound scoring based on note type and
 * epistemic quality indicators.
 *
 * Formula: compound = bm25_normalized × (1 + type_boost + confidence_modifier)
 *
 * @param doc - The vault document to score
 * @param bm25Raw - Raw BM25 score from search
 * @param config - Optional scoring configuration (defaults to DEFAULT_SCORING_CONFIG)
 * @param options - Optional additional options (matchedFields, etc.)
 * @returns ScoredDocument with breakdown, or null if below BM25 floor
 */
export function computeScore(
  doc: VaultDocument,
  bm25Raw: number,
  config: ScoringConfig = DEFAULT_SCORING_CONFIG,
  options: ComputeScoreOptions = {}
): ScoredDocument | null {
  // Normalize BM25 score
  const bm25Normalized = normalizeBm25(bm25Raw);

  // Apply BM25 floor filter
  if (bm25Normalized < config.bm25Floor) {
    return null;
  }

  // Get type boost (default to 0 for unknown types)
  const typeBoost = config.typeBoosts[doc.noteType] ?? 0;

  // Compute confidence/status/maturity modifier based on note type
  let confidenceModifier = 0;

  if (doc.noteType === 'belief') {
    // For beliefs: confidence + maturity modifiers (cumulative)
    const confidenceKey = doc.confidence as
      | keyof ScoringConfig['confidenceModifiers']
      | undefined;
    if (confidenceKey && confidenceKey in config.confidenceModifiers) {
      confidenceModifier += config.confidenceModifiers[confidenceKey];
    }

    const maturityKey = doc.maturity as
      | keyof ScoringConfig['maturityModifiers']
      | undefined;
    if (maturityKey && maturityKey in config.maturityModifiers) {
      confidenceModifier += config.maturityModifiers[maturityKey];
    }
  } else if (doc.noteType === 'research') {
    // For research: status modifier
    const statusKey = doc.status as
      | keyof ScoringConfig['statusModifiers']
      | undefined;
    if (statusKey && statusKey in config.statusModifiers) {
      confidenceModifier = config.statusModifiers[statusKey];
    }
  }
  // For other note types, confidenceModifier stays at 0

  // Compute compound score
  const multiplier = 1 + typeBoost + confidenceModifier;
  const score = bm25Normalized * multiplier;

  // Build explanation string
  const modifierLabel = getModifierLabel(doc.noteType);
  const explanation =
    `BM25: ${bm25Normalized.toFixed(2)} (raw: ${bm25Raw.toFixed(2)}) × ` +
    `(1 + type:${formatSignedNumber(typeBoost)} + ${modifierLabel}:${formatSignedNumber(confidenceModifier)}) = ` +
    `${score.toFixed(3)}`;

  return {
    doc,
    score,
    bm25Raw,
    bm25Normalized,
    typeBoost,
    confidenceModifier,
    matchedFields: options.matchedFields ?? [],
    explanation,
  };
}
