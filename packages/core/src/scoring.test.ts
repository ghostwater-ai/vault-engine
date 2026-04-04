import { describe, it, expect } from 'vitest';
import {
  DEFAULT_SCORING_CONFIG,
  type ScoringConfig,
  type ScoredDocument,
} from './scoring.js';
import type { NoteType } from './types.js';

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
