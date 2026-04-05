import { describe, it, expect } from 'vitest';
import {
  DEFAULT_SCORING_CONFIG,
  computeScore,
  normalizeBm25,
  type ScoringConfig,
  type ScoredDocument,
} from './scoring.js';
import type { NoteType, VaultDocument } from './types.js';

/**
 * Creates a minimal VaultDocument for testing.
 */
function createTestDoc(
  overrides: Partial<VaultDocument> = {}
): VaultDocument {
  return {
    path: '/vault/test.md',
    slug: 'test',
    noteType: 'experience',
    title: 'Test Document',
    bodySections: [],
    rawBody: '',
    ...overrides,
  };
}

describe('ScoringConfig', () => {
  describe('DEFAULT_SCORING_CONFIG', () => {
    it('has correct type boosts for all note types', () => {
      const { typeBoosts } = DEFAULT_SCORING_CONFIG;

      expect(typeBoosts.belief).toBe(0.15);
      expect(typeBoosts.research).toBe(0.05);
      expect(typeBoosts.experience).toBe(0.0);
      expect(typeBoosts.entity).toBe(0.0);
      expect(typeBoosts.topic).toBe(0.0);
      expect(typeBoosts.bet).toBe(-0.05);
      expect(typeBoosts.question).toBe(-0.1);
    });

    it('has entries for all 7 note types', () => {
      const noteTypes: NoteType[] = [
        'experience',
        'research',
        'belief',
        'entity',
        'bet',
        'question',
        'topic',
      ];

      for (const noteType of noteTypes) {
        expect(DEFAULT_SCORING_CONFIG.typeBoosts).toHaveProperty(noteType);
        expect(typeof DEFAULT_SCORING_CONFIG.typeBoosts[noteType]).toBe(
          'number'
        );
      }
    });

    it('has correct confidence modifiers', () => {
      const { confidenceModifiers } = DEFAULT_SCORING_CONFIG;

      expect(confidenceModifiers.high).toBe(0.1);
      expect(confidenceModifiers.medium).toBe(0.05);
      expect(confidenceModifiers.low).toBe(0.0);
    });

    it('has correct status modifiers for research notes', () => {
      const { statusModifiers } = DEFAULT_SCORING_CONFIG;

      expect(statusModifiers.proven).toBe(0.1);
      expect(statusModifiers['battle-tested']).toBe(0.05);
      expect(statusModifiers['benchmarks-only']).toBe(0.02);
      expect(statusModifiers.anecdotal).toBe(0.0);
      expect(statusModifiers.theoretical).toBe(-0.03);
      expect(statusModifiers.opinion).toBe(-0.05);
    });

    it('has correct maturity modifiers for belief notes', () => {
      const { maturityModifiers } = DEFAULT_SCORING_CONFIG;

      expect(maturityModifiers.evergreen).toBe(0.05);
      expect(maturityModifiers.developing).toBe(0.0);
      expect(maturityModifiers.seedling).toBe(-0.03);
    });

    it('has correct BM25 floor threshold', () => {
      expect(DEFAULT_SCORING_CONFIG.bm25Floor).toBe(0.1);
    });

    it('type boosts are ordered by epistemic value', () => {
      const { typeBoosts } = DEFAULT_SCORING_CONFIG;

      // Beliefs highest
      expect(typeBoosts.belief).toBeGreaterThan(typeBoosts.research);

      // Research higher than neutral types
      expect(typeBoosts.research).toBeGreaterThan(typeBoosts.experience);

      // Neutral types equal
      expect(typeBoosts.experience).toBe(typeBoosts.entity);
      expect(typeBoosts.entity).toBe(typeBoosts.topic);

      // Bets and questions are penalized
      expect(typeBoosts.bet).toBeLessThan(0);
      expect(typeBoosts.question).toBeLessThan(0);
      expect(typeBoosts.question).toBeLessThan(typeBoosts.bet);
    });

    it('confidence modifiers are ordered correctly', () => {
      const { confidenceModifiers } = DEFAULT_SCORING_CONFIG;

      expect(confidenceModifiers.high).toBeGreaterThan(
        confidenceModifiers.medium
      );
      expect(confidenceModifiers.medium).toBeGreaterThan(
        confidenceModifiers.low
      );
      expect(confidenceModifiers.low).toBe(0);
    });

    it('status modifiers are ordered by research quality', () => {
      const { statusModifiers } = DEFAULT_SCORING_CONFIG;

      // Positive modifiers ordered
      expect(statusModifiers.proven).toBeGreaterThan(
        statusModifiers['battle-tested']
      );
      expect(statusModifiers['battle-tested']).toBeGreaterThan(
        statusModifiers['benchmarks-only']
      );
      expect(statusModifiers['benchmarks-only']).toBeGreaterThan(
        statusModifiers.anecdotal
      );

      // Anecdotal is neutral
      expect(statusModifiers.anecdotal).toBe(0);

      // Negative modifiers
      expect(statusModifiers.theoretical).toBeLessThan(0);
      expect(statusModifiers.opinion).toBeLessThan(statusModifiers.theoretical);
    });

    it('maturity modifiers are ordered correctly', () => {
      const { maturityModifiers } = DEFAULT_SCORING_CONFIG;

      expect(maturityModifiers.evergreen).toBeGreaterThan(
        maturityModifiers.developing
      );
      expect(maturityModifiers.developing).toBe(0);
      expect(maturityModifiers.seedling).toBeLessThan(0);
    });
  });

  describe('ScoringConfig interface', () => {
    it('allows custom configuration', () => {
      const customConfig: ScoringConfig = {
        typeBoosts: {
          belief: 0.2,
          research: 0.1,
          experience: 0.05,
          entity: 0.0,
          topic: 0.0,
          bet: 0.0,
          question: 0.0,
        },
        confidenceModifiers: {
          high: 0.15,
          medium: 0.1,
          low: 0.0,
        },
        statusModifiers: {
          proven: 0.15,
          'battle-tested': 0.1,
          'benchmarks-only': 0.05,
          anecdotal: 0.0,
          theoretical: 0.0,
          opinion: -0.1,
        },
        maturityModifiers: {
          evergreen: 0.1,
          developing: 0.0,
          seedling: -0.05,
        },
        bm25Floor: 0.15,
      };

      expect(customConfig.typeBoosts.belief).toBe(0.2);
      expect(customConfig.bm25Floor).toBe(0.15);
    });
  });
});

describe('ScoredDocument interface', () => {
  it('can be constructed with all required fields', () => {
    const scoredDoc: ScoredDocument = {
      doc: {
        path: '/vault/beliefs/test.md',
        slug: 'test',
        noteType: 'belief',
        title: 'Test Belief',
        description: 'A test belief',
        confidence: 'high',
        maturity: 'evergreen',
        bodySections: [],
        rawBody: '',
      },
      score: 0.525,
      bm25Raw: 0.72,
      bm25Normalized: 0.42,
      typeBoost: 0.15,
      confidenceModifier: 0.1,
      matchedFields: ['title', 'description'],
      explanation:
        'BM25: 0.42 (raw: 0.72) × (1 + type:+0.15 + confidence:+0.10) = 0.525',
    };

    expect(scoredDoc.score).toBe(0.525);
    expect(scoredDoc.bm25Raw).toBe(0.72);
    expect(scoredDoc.bm25Normalized).toBe(0.42);
    expect(scoredDoc.typeBoost).toBe(0.15);
    expect(scoredDoc.confidenceModifier).toBe(0.1);
    expect(scoredDoc.matchedFields).toEqual(['title', 'description']);
    expect(scoredDoc.explanation).toContain('BM25: 0.42');
    expect(scoredDoc.explanation).toContain('type:+0.15');
    expect(scoredDoc.explanation).toContain('confidence:+0.10');
  });

  it('explanation format matches specification', () => {
    const explanation =
      'BM25: 0.42 (raw: 0.72) × (1 + type:+0.15 + confidence:+0.10) = 0.525';

    // Verify format includes all required components
    expect(explanation).toMatch(/BM25: \d+\.\d+/);
    expect(explanation).toMatch(/\(raw: \d+\.\d+\)/);
    expect(explanation).toMatch(/type:[+-]\d+\.\d+/);
    expect(explanation).toMatch(/confidence:[+-]\d+\.\d+/);
    expect(explanation).toMatch(/= \d+\.\d+$/);
  });
});

describe('normalizeBm25', () => {
  it('normalizes raw BM25 scores to [0, 1)', () => {
    // Formula: bm25_normalized = raw / (1 + raw)
    expect(normalizeBm25(0)).toBe(0);
    expect(normalizeBm25(1)).toBe(0.5);
    expect(normalizeBm25(4)).toBe(0.8);
    expect(normalizeBm25(9)).toBe(0.9);
    expect(normalizeBm25(99)).toBeCloseTo(0.99);
  });

  it('approaches 1 asymptotically for large values', () => {
    expect(normalizeBm25(1000)).toBeCloseTo(0.999);
    expect(normalizeBm25(10000)).toBeCloseTo(0.9999);
  });

  it('preserves relative ordering', () => {
    expect(normalizeBm25(2)).toBeGreaterThan(normalizeBm25(1));
    expect(normalizeBm25(5)).toBeGreaterThan(normalizeBm25(3));
  });

  it('clamps negative inputs to zero', () => {
    expect(normalizeBm25(-1)).toBe(0);
    expect(normalizeBm25(-0.5)).toBe(0);
  });
});

describe('computeScore', () => {
  describe('BM25 normalization', () => {
    it('computes bm25_normalized correctly', () => {
      const doc = createTestDoc();
      const result = computeScore(doc, 1.0);

      expect(result).not.toBeNull();
      expect(result!.bm25Normalized).toBe(0.5);
    });

    it('preserves bm25Raw in result', () => {
      const doc = createTestDoc();
      const result = computeScore(doc, 2.5);

      expect(result).not.toBeNull();
      expect(result!.bm25Raw).toBe(2.5);
    });
  });

  describe('BM25 floor filtering', () => {
    it('returns null when bm25_normalized < bm25Floor', () => {
      const doc = createTestDoc();
      // raw = 0.1 → normalized = 0.1 / 1.1 ≈ 0.0909 < 0.10
      const result = computeScore(doc, 0.1);

      expect(result).toBeNull();
    });

    it('returns result when bm25_normalized equals bm25Floor exactly', () => {
      const doc = createTestDoc();
      // To get exactly 0.10: 0.10 = raw / (1 + raw) → raw = 0.10 / 0.90 ≈ 0.1111
      const raw = 0.1 / 0.9;
      const result = computeScore(doc, raw);

      expect(result).not.toBeNull();
      expect(result!.bm25Normalized).toBeCloseTo(0.1);
    });

    it('returns result when bm25_normalized is just above bm25Floor', () => {
      const doc = createTestDoc();
      // raw = 0.12 → normalized = 0.12 / 1.12 ≈ 0.107 > 0.10
      const result = computeScore(doc, 0.12);

      expect(result).not.toBeNull();
    });

    it('excludes results at boundary (0.09 normalized)', () => {
      const doc = createTestDoc();
      // For normalized = 0.09: raw = 0.09 / 0.91 ≈ 0.0989
      const raw = 0.09 / 0.91;
      const result = computeScore(doc, raw);

      expect(result).toBeNull();
    });

    it('respects custom bm25Floor', () => {
      const doc = createTestDoc();
      const customConfig: ScoringConfig = {
        ...DEFAULT_SCORING_CONFIG,
        bm25Floor: 0.2,
      };
      // raw = 0.2 → normalized = 0.2 / 1.2 ≈ 0.167 < 0.20
      const result = computeScore(doc, 0.2, customConfig);

      expect(result).toBeNull();
    });
  });

  describe('zero BM25 edge case', () => {
    it('returns null for zero BM25 (below floor)', () => {
      const doc = createTestDoc();
      const result = computeScore(doc, 0);

      // Zero BM25 normalized = 0, which is below floor of 0.10
      expect(result).toBeNull();
    });

    it('preserves multiplicative property when floor is 0', () => {
      const doc = createTestDoc({ noteType: 'belief', confidence: 'high' });
      const zeroFloorConfig: ScoringConfig = {
        ...DEFAULT_SCORING_CONFIG,
        bm25Floor: 0,
      };
      const result = computeScore(doc, 0, zeroFloorConfig);

      expect(result).not.toBeNull();
      // Zero BM25 × anything = 0
      expect(result!.score).toBe(0);
      expect(result!.bm25Normalized).toBe(0);
    });
  });

  describe('type boosts', () => {
    it('applies belief type boost (+0.15)', () => {
      const doc = createTestDoc({ noteType: 'belief' });
      const result = computeScore(doc, 1.0);

      expect(result).not.toBeNull();
      expect(result!.typeBoost).toBe(0.15);
    });

    it('applies research type boost (+0.05)', () => {
      const doc = createTestDoc({ noteType: 'research' });
      const result = computeScore(doc, 1.0);

      expect(result).not.toBeNull();
      expect(result!.typeBoost).toBe(0.05);
    });

    it('applies experience type boost (+0.00)', () => {
      const doc = createTestDoc({ noteType: 'experience' });
      const result = computeScore(doc, 1.0);

      expect(result).not.toBeNull();
      expect(result!.typeBoost).toBe(0.0);
    });

    it('applies entity type boost (+0.00)', () => {
      const doc = createTestDoc({ noteType: 'entity' });
      const result = computeScore(doc, 1.0);

      expect(result).not.toBeNull();
      expect(result!.typeBoost).toBe(0.0);
    });

    it('applies topic type boost (+0.00)', () => {
      const doc = createTestDoc({ noteType: 'topic' });
      const result = computeScore(doc, 1.0);

      expect(result).not.toBeNull();
      expect(result!.typeBoost).toBe(0.0);
    });

    it('applies bet type boost (-0.05)', () => {
      const doc = createTestDoc({ noteType: 'bet' });
      const result = computeScore(doc, 1.0);

      expect(result).not.toBeNull();
      expect(result!.typeBoost).toBe(-0.05);
    });

    it('applies question type boost (-0.10)', () => {
      const doc = createTestDoc({ noteType: 'question' });
      const result = computeScore(doc, 1.0);

      expect(result).not.toBeNull();
      expect(result!.typeBoost).toBe(-0.1);
    });
  });

  describe('confidence modifiers (belief notes)', () => {
    it('applies high confidence modifier (+0.10)', () => {
      const doc = createTestDoc({ noteType: 'belief', confidence: 'high' });
      const result = computeScore(doc, 1.0);

      expect(result).not.toBeNull();
      expect(result!.confidenceModifier).toBe(0.1);
    });

    it('applies medium confidence modifier (+0.05)', () => {
      const doc = createTestDoc({ noteType: 'belief', confidence: 'medium' });
      const result = computeScore(doc, 1.0);

      expect(result).not.toBeNull();
      expect(result!.confidenceModifier).toBe(0.05);
    });

    it('applies low confidence modifier (+0.00)', () => {
      const doc = createTestDoc({ noteType: 'belief', confidence: 'low' });
      const result = computeScore(doc, 1.0);

      expect(result).not.toBeNull();
      expect(result!.confidenceModifier).toBe(0.0);
    });

    it('defaults to 0 for missing confidence', () => {
      const doc = createTestDoc({ noteType: 'belief' });
      const result = computeScore(doc, 1.0);

      expect(result).not.toBeNull();
      expect(result!.confidenceModifier).toBe(0);
    });

    it('defaults to 0 for unknown confidence value', () => {
      const doc = createTestDoc({ noteType: 'belief', confidence: 'unknown' });
      const result = computeScore(doc, 1.0);

      expect(result).not.toBeNull();
      expect(result!.confidenceModifier).toBe(0);
    });
  });

  describe('maturity modifiers (belief notes)', () => {
    it('applies evergreen maturity modifier (+0.05)', () => {
      const doc = createTestDoc({ noteType: 'belief', maturity: 'evergreen' });
      const result = computeScore(doc, 1.0);

      expect(result).not.toBeNull();
      expect(result!.confidenceModifier).toBe(0.05);
    });

    it('applies developing maturity modifier (+0.00)', () => {
      const doc = createTestDoc({ noteType: 'belief', maturity: 'developing' });
      const result = computeScore(doc, 1.0);

      expect(result).not.toBeNull();
      expect(result!.confidenceModifier).toBe(0.0);
    });

    it('applies seedling maturity modifier (-0.03)', () => {
      const doc = createTestDoc({ noteType: 'belief', maturity: 'seedling' });
      const result = computeScore(doc, 1.0);

      expect(result).not.toBeNull();
      expect(result!.confidenceModifier).toBe(-0.03);
    });

    it('combines confidence and maturity modifiers cumulatively', () => {
      const doc = createTestDoc({
        noteType: 'belief',
        confidence: 'high',
        maturity: 'evergreen',
      });
      const result = computeScore(doc, 1.0);

      expect(result).not.toBeNull();
      // high (+0.10) + evergreen (+0.05) = +0.15
      expect(result!.confidenceModifier).toBeCloseTo(0.15);
    });

    it('handles confidence with seedling maturity', () => {
      const doc = createTestDoc({
        noteType: 'belief',
        confidence: 'high',
        maturity: 'seedling',
      });
      const result = computeScore(doc, 1.0);

      expect(result).not.toBeNull();
      // high (+0.10) + seedling (-0.03) = +0.07
      expect(result!.confidenceModifier).toBeCloseTo(0.07);
    });
  });

  describe('status modifiers (research notes)', () => {
    it('applies proven status modifier (+0.10)', () => {
      const doc = createTestDoc({ noteType: 'research', status: 'proven' });
      const result = computeScore(doc, 1.0);

      expect(result).not.toBeNull();
      expect(result!.confidenceModifier).toBe(0.1);
    });

    it('applies battle-tested status modifier (+0.05)', () => {
      const doc = createTestDoc({ noteType: 'research', status: 'battle-tested' });
      const result = computeScore(doc, 1.0);

      expect(result).not.toBeNull();
      expect(result!.confidenceModifier).toBe(0.05);
    });

    it('applies benchmarks-only status modifier (+0.02)', () => {
      const doc = createTestDoc({ noteType: 'research', status: 'benchmarks-only' });
      const result = computeScore(doc, 1.0);

      expect(result).not.toBeNull();
      expect(result!.confidenceModifier).toBe(0.02);
    });

    it('applies anecdotal status modifier (+0.00)', () => {
      const doc = createTestDoc({ noteType: 'research', status: 'anecdotal' });
      const result = computeScore(doc, 1.0);

      expect(result).not.toBeNull();
      expect(result!.confidenceModifier).toBe(0.0);
    });

    it('applies theoretical status modifier (-0.03)', () => {
      const doc = createTestDoc({ noteType: 'research', status: 'theoretical' });
      const result = computeScore(doc, 1.0);

      expect(result).not.toBeNull();
      expect(result!.confidenceModifier).toBe(-0.03);
    });

    it('applies opinion status modifier (-0.05)', () => {
      const doc = createTestDoc({ noteType: 'research', status: 'opinion' });
      const result = computeScore(doc, 1.0);

      expect(result).not.toBeNull();
      expect(result!.confidenceModifier).toBe(-0.05);
    });

    it('defaults to 0 for missing status', () => {
      const doc = createTestDoc({ noteType: 'research' });
      const result = computeScore(doc, 1.0);

      expect(result).not.toBeNull();
      expect(result!.confidenceModifier).toBe(0);
    });

    it('defaults to 0 for unknown status value', () => {
      const doc = createTestDoc({ noteType: 'research', status: 'unknown' });
      const result = computeScore(doc, 1.0);

      expect(result).not.toBeNull();
      expect(result!.confidenceModifier).toBe(0);
    });
  });

  describe('other note types', () => {
    it('has zero confidenceModifier for experience notes', () => {
      const doc = createTestDoc({ noteType: 'experience', status: 'proven' });
      const result = computeScore(doc, 1.0);

      expect(result).not.toBeNull();
      expect(result!.confidenceModifier).toBe(0);
    });

    it('has zero confidenceModifier for entity notes', () => {
      const doc = createTestDoc({ noteType: 'entity' });
      const result = computeScore(doc, 1.0);

      expect(result).not.toBeNull();
      expect(result!.confidenceModifier).toBe(0);
    });

    it('has zero confidenceModifier for topic notes', () => {
      const doc = createTestDoc({ noteType: 'topic' });
      const result = computeScore(doc, 1.0);

      expect(result).not.toBeNull();
      expect(result!.confidenceModifier).toBe(0);
    });

    it('has zero confidenceModifier for bet notes', () => {
      const doc = createTestDoc({ noteType: 'bet' });
      const result = computeScore(doc, 1.0);

      expect(result).not.toBeNull();
      expect(result!.confidenceModifier).toBe(0);
    });

    it('has zero confidenceModifier for question notes', () => {
      const doc = createTestDoc({ noteType: 'question' });
      const result = computeScore(doc, 1.0);

      expect(result).not.toBeNull();
      expect(result!.confidenceModifier).toBe(0);
    });
  });

  describe('compound score calculation', () => {
    it('computes compound score correctly for experience', () => {
      const doc = createTestDoc({ noteType: 'experience' });
      const result = computeScore(doc, 1.0);

      expect(result).not.toBeNull();
      // bm25_normalized = 0.5
      // multiplier = 1 + 0.0 + 0.0 = 1.0
      // score = 0.5 × 1.0 = 0.5
      expect(result!.score).toBe(0.5);
    });

    it('computes compound score correctly for belief with high confidence', () => {
      const doc = createTestDoc({ noteType: 'belief', confidence: 'high' });
      const result = computeScore(doc, 1.0);

      expect(result).not.toBeNull();
      // bm25_normalized = 0.5
      // multiplier = 1 + 0.15 + 0.10 = 1.25
      // score = 0.5 × 1.25 = 0.625
      expect(result!.score).toBe(0.625);
    });

    it('computes compound score correctly for belief with high confidence and evergreen maturity', () => {
      const doc = createTestDoc({
        noteType: 'belief',
        confidence: 'high',
        maturity: 'evergreen',
      });
      const result = computeScore(doc, 1.0);

      expect(result).not.toBeNull();
      // bm25_normalized = 0.5
      // multiplier = 1 + 0.15 + (0.10 + 0.05) = 1.30
      // score = 0.5 × 1.30 = 0.65
      expect(result!.score).toBeCloseTo(0.65);
    });

    it('computes compound score correctly for research with proven status', () => {
      const doc = createTestDoc({ noteType: 'research', status: 'proven' });
      const result = computeScore(doc, 1.0);

      expect(result).not.toBeNull();
      // bm25_normalized = 0.5
      // multiplier = 1 + 0.05 + 0.10 = 1.15
      // score = 0.5 × 1.15 = 0.575
      expect(result!.score).toBeCloseTo(0.575);
    });

    it('computes compound score correctly for question (penalized)', () => {
      const doc = createTestDoc({ noteType: 'question' });
      const result = computeScore(doc, 1.0);

      expect(result).not.toBeNull();
      // bm25_normalized = 0.5
      // multiplier = 1 + (-0.10) + 0.0 = 0.90
      // score = 0.5 × 0.90 = 0.45
      expect(result!.score).toBe(0.45);
    });
  });

  describe('explanation string', () => {
    it('formats explanation correctly for belief note', () => {
      const doc = createTestDoc({ noteType: 'belief', confidence: 'high' });
      const result = computeScore(doc, 1.0);

      expect(result).not.toBeNull();
      expect(result!.explanation).toContain('BM25: 0.50');
      expect(result!.explanation).toContain('(raw: 1.00)');
      expect(result!.explanation).toContain('type:+0.15');
      expect(result!.explanation).toContain('confidence:+0.10');
      expect(result!.explanation).toMatch(/= 0\.625$/);
    });

    it('formats explanation correctly for research note', () => {
      const doc = createTestDoc({ noteType: 'research', status: 'proven' });
      const result = computeScore(doc, 1.0);

      expect(result).not.toBeNull();
      expect(result!.explanation).toContain('status:+0.10');
    });

    it('formats explanation with negative modifiers', () => {
      const doc = createTestDoc({ noteType: 'question' });
      const result = computeScore(doc, 1.0);

      expect(result).not.toBeNull();
      expect(result!.explanation).toContain('type:-0.10');
    });

    it('formats explanation with zero modifiers', () => {
      const doc = createTestDoc({ noteType: 'experience' });
      const result = computeScore(doc, 1.0);

      expect(result).not.toBeNull();
      expect(result!.explanation).toContain('type:+0.00');
      expect(result!.explanation).toContain('modifier:+0.00');
    });

    it('explanation matches expected format', () => {
      const doc = createTestDoc({ noteType: 'belief', confidence: 'high' });
      const result = computeScore(doc, 1.0);

      expect(result).not.toBeNull();
      // Should match: "BM25: {normalized} (raw: {raw}) × (1 + type:{typeBoost} + {modifierType}:{modifierValue}) = {compound}"
      expect(result!.explanation).toMatch(
        /BM25: \d+\.\d+ \(raw: \d+\.\d+\) × \(1 \+ type:[+-]\d+\.\d+ \+ \w+:[+-]\d+\.\d+\) = \d+\.\d+/
      );
    });
  });

  describe('matchedFields', () => {
    it('defaults to empty array when not provided', () => {
      const doc = createTestDoc();
      const result = computeScore(doc, 1.0);

      expect(result).not.toBeNull();
      expect(result!.matchedFields).toEqual([]);
    });

    it('includes matchedFields from options', () => {
      const doc = createTestDoc();
      const result = computeScore(doc, 1.0, DEFAULT_SCORING_CONFIG, {
        matchedFields: ['title', 'description'],
      });

      expect(result).not.toBeNull();
      expect(result!.matchedFields).toEqual(['title', 'description']);
    });
  });

  describe('custom configuration', () => {
    it('uses custom type boosts', () => {
      const customConfig: ScoringConfig = {
        ...DEFAULT_SCORING_CONFIG,
        typeBoosts: {
          ...DEFAULT_SCORING_CONFIG.typeBoosts,
          belief: 0.25,
        },
      };
      const doc = createTestDoc({ noteType: 'belief' });
      const result = computeScore(doc, 1.0, customConfig);

      expect(result).not.toBeNull();
      expect(result!.typeBoost).toBe(0.25);
    });

    it('uses custom confidence modifiers', () => {
      const customConfig: ScoringConfig = {
        ...DEFAULT_SCORING_CONFIG,
        confidenceModifiers: {
          ...DEFAULT_SCORING_CONFIG.confidenceModifiers,
          high: 0.2,
        },
      };
      const doc = createTestDoc({ noteType: 'belief', confidence: 'high' });
      const result = computeScore(doc, 1.0, customConfig);

      expect(result).not.toBeNull();
      expect(result!.confidenceModifier).toBe(0.2);
    });

    it('uses custom bm25Floor', () => {
      const customConfig: ScoringConfig = {
        ...DEFAULT_SCORING_CONFIG,
        bm25Floor: 0.05,
      };
      const doc = createTestDoc();
      // raw = 0.06 → normalized ≈ 0.0566, would be excluded by default floor of 0.10
      const result = computeScore(doc, 0.06, customConfig);

      expect(result).not.toBeNull();
    });
  });

  describe('function purity', () => {
    it('does not modify the input document', () => {
      const doc = createTestDoc({ noteType: 'belief', confidence: 'high' });
      const originalDoc = { ...doc };

      computeScore(doc, 1.0);

      expect(doc).toEqual(originalDoc);
    });

    it('does not modify the config', () => {
      const config = { ...DEFAULT_SCORING_CONFIG };
      const originalConfig = JSON.stringify(config);
      const doc = createTestDoc();

      computeScore(doc, 1.0, config);

      expect(JSON.stringify(config)).toBe(originalConfig);
    });

    it('returns consistent results for same inputs', () => {
      const doc = createTestDoc({ noteType: 'belief', confidence: 'high' });

      const result1 = computeScore(doc, 1.0);
      const result2 = computeScore(doc, 1.0);

      expect(result1).toEqual(result2);
    });
  });
});
