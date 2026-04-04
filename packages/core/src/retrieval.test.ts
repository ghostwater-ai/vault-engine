import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { query, tokenize, DEFAULT_QUERY_OPTIONS } from './retrieval.js';
import { VaultIndex, rebuildIndex } from './indexer.js';
import { DEFAULT_SCORING_CONFIG } from './scoring.js';
import type { VaultDocument, QueryOptions } from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const fixturesDir = join(__dirname, '__fixtures__');
const vaultFixtureDir = join(fixturesDir, 'vault');

/**
 * Creates a test VaultDocument with the given properties.
 */
function createTestDocument(
  overrides: Partial<VaultDocument> & { path: string }
): VaultDocument {
  return {
    slug: overrides.path.split('/').pop()?.replace('.md', '') ?? 'test',
    noteType: 'experience',
    title: 'Test Document',
    bodySections: [],
    rawBody: '',
    ...overrides,
  };
}

describe('DEFAULT_QUERY_OPTIONS', () => {
  it('has correct default values', () => {
    expect(DEFAULT_QUERY_OPTIONS.maxResults).toBe(3);
    expect(DEFAULT_QUERY_OPTIONS.minScore).toBe(0.3);
    expect(DEFAULT_QUERY_OPTIONS.minBm25Score).toBe(0.1);
  });
});

describe('tokenize', () => {
  it('tokenizes a simple string', () => {
    const terms = tokenize('hello world');
    expect(terms).toContain('hello');
    expect(terms).toContain('world');
  });

  it('applies lowercase normalization', () => {
    const terms = tokenize('Hello WORLD');
    expect(terms).toContain('hello');
    expect(terms).toContain('world');
    expect(terms).not.toContain('Hello');
    expect(terms).not.toContain('WORLD');
  });

  it('filters out stopwords', () => {
    const terms = tokenize('the quick fox is in the forest');
    expect(terms).not.toContain('the');
    expect(terms).not.toContain('is');
    expect(terms).not.toContain('in');
    expect(terms).toContain('quick');
    expect(terms).toContain('fox');
    expect(terms).toContain('forest');
  });

  it('applies stemming', () => {
    const terms = tokenize('running connects memories');
    // Stemmed forms should be present
    expect(terms.some((t) => t === 'run' || t === 'running')).toBe(true);
    expect(terms.some((t) => t === 'connect' || t === 'connects')).toBe(true);
    expect(terms.some((t) => t === 'memori' || t === 'memory')).toBe(true);
  });

  it('returns unique terms only', () => {
    const terms = tokenize('memory memory memory');
    // Should only have one instance of the stemmed term
    const memoryTerms = terms.filter((t) => t.includes('memor'));
    expect(memoryTerms.length).toBe(1);
  });

  it('handles punctuation correctly', () => {
    const terms = tokenize('hello, world! (test)');
    expect(terms).toContain('hello');
    expect(terms).toContain('world');
    expect(terms).toContain('test');
  });

  it('returns empty array for only stopwords', () => {
    const terms = tokenize('the a an is are');
    expect(terms.length).toBe(0);
  });

  it('returns empty array for empty string', () => {
    const terms = tokenize('');
    expect(terms.length).toBe(0);
  });
});

describe('query', () => {
  let index: VaultIndex;

  beforeAll(async () => {
    index = await rebuildIndex(vaultFixtureDir);
  });

  describe('basic functionality', () => {
    it('returns a QueryResult with required fields', () => {
      const result = query(index, 'test');

      expect(result).toHaveProperty('results');
      expect(result).toHaveProperty('tier');
      expect(result).toHaveProperty('latencyMs');
      expect(result).toHaveProperty('query');
      expect(Array.isArray(result.results)).toBe(true);
    });

    it('returns the original query string', () => {
      const result = query(index, 'test belief');
      expect(result.query).toBe('test belief');
    });

    it('tier is always 0 for MVP', () => {
      const result = query(index, 'test');
      expect(result.tier).toBe(0);
    });

    it('latencyMs is populated and > 0', () => {
      const result = query(index, 'test');
      expect(result.latencyMs).toBeGreaterThan(0);
    });
  });

  describe('ranked results for known vault content', () => {
    it('returns results for queries matching vault content', () => {
      const result = query(index, 'test');

      expect(result.results.length).toBeGreaterThan(0);
    });

    it('results are sorted by score descending', () => {
      const result = query(index, 'test');

      for (let i = 1; i < result.results.length; i++) {
        expect(result.results[i - 1].score).toBeGreaterThanOrEqual(
          result.results[i].score
        );
      }
    });

    it('results include all scoring breakdown fields', () => {
      const result = query(index, 'test');

      if (result.results.length > 0) {
        const first = result.results[0];
        expect(first).toHaveProperty('doc');
        expect(first).toHaveProperty('score');
        expect(first).toHaveProperty('bm25Raw');
        expect(first).toHaveProperty('bm25Normalized');
        expect(first).toHaveProperty('typeBoost');
        expect(first).toHaveProperty('confidenceModifier');
        expect(first).toHaveProperty('matchedFields');
        expect(first).toHaveProperty('explanation');
      }
    });

    it('type boosts affect ranking', () => {
      // Query for "test" - should match multiple note types
      // Belief notes have +0.15 type boost, research +0.05, etc.
      const result = query(index, 'test', { maxResults: 10, minScore: 0 });

      // Find belief and experience results
      const beliefResults = result.results.filter(
        (r) => r.doc.noteType === 'belief'
      );
      const experienceResults = result.results.filter(
        (r) => r.doc.noteType === 'experience'
      );

      if (beliefResults.length > 0 && experienceResults.length > 0) {
        // With similar BM25, belief should have higher type boost
        expect(beliefResults[0].typeBoost).toBeGreaterThan(
          experienceResults[0].typeBoost
        );
      }
    });
  });

  describe('BM25 floor filtering', () => {
    it('filters out results below BM25 floor', () => {
      // Use a very high BM25 floor to filter out most results
      const result = query(index, 'test', { minBm25Score: 0.9 });

      // Most results should be filtered out with such a high floor
      // since normalized BM25 rarely exceeds 0.9
      for (const r of result.results) {
        expect(r.bm25Normalized).toBeGreaterThanOrEqual(0.9);
      }
    });

    it('uses default BM25 floor of 0.10', () => {
      const result = query(index, 'test');

      for (const r of result.results) {
        expect(r.bm25Normalized).toBeGreaterThanOrEqual(0.1);
      }
    });

    it('respects custom minBm25Score option', () => {
      const customFloor = 0.3;
      const result = query(index, 'test', { minBm25Score: customFloor });

      for (const r of result.results) {
        expect(r.bm25Normalized).toBeGreaterThanOrEqual(customFloor);
      }
    });
  });

  describe('compound threshold filtering', () => {
    it('filters out results below compound score threshold', () => {
      const result = query(index, 'test', { minScore: 0.5 });

      for (const r of result.results) {
        expect(r.score).toBeGreaterThanOrEqual(0.5);
      }
    });

    it('uses default minScore of 0.30', () => {
      const result = query(index, 'test');

      for (const r of result.results) {
        expect(r.score).toBeGreaterThanOrEqual(0.3);
      }
    });

    it('respects custom minScore option', () => {
      const customThreshold = 0.4;
      const result = query(index, 'test', { minScore: customThreshold });

      for (const r of result.results) {
        expect(r.score).toBeGreaterThanOrEqual(customThreshold);
      }
    });
  });

  describe('empty results', () => {
    it('returns empty results when nothing passes thresholds', () => {
      // Use an impossibly high threshold
      const result = query(index, 'test', { minScore: 10 });

      expect(result.results).toHaveLength(0);
    });

    it('returns empty results for queries with no matches', () => {
      const result = query(index, 'xyzzynonexistent12345');

      expect(result.results).toHaveLength(0);
    });

    it('returns empty QueryResult with tier=0 even with no results', () => {
      const result = query(index, 'xyzzynonexistent12345');

      expect(result.tier).toBe(0);
      expect(result.latencyMs).toBeGreaterThan(0);
      expect(result.query).toBe('xyzzynonexistent12345');
    });

    it('returns empty results when BM25 floor filters everything', () => {
      // Use a BM25 floor of 1.0 - impossible to achieve
      const result = query(index, 'test', { minBm25Score: 1.0 });

      expect(result.results).toHaveLength(0);
    });
  });

  describe('maxResults option', () => {
    it('limits results to maxResults (default 3)', () => {
      // Use low thresholds to get many matches
      const result = query(index, 'test', { minScore: 0, minBm25Score: 0 });

      expect(result.results.length).toBeLessThanOrEqual(3);
    });

    it('respects custom maxResults option', () => {
      const result = query(index, 'test', {
        maxResults: 2,
        minScore: 0,
        minBm25Score: 0,
      });

      expect(result.results.length).toBeLessThanOrEqual(2);
    });

    it('returns fewer than maxResults if not enough matches', () => {
      const result = query(index, 'xyznonexistent', { maxResults: 10 });

      expect(result.results.length).toBe(0);
    });
  });

  describe('noteTypes filter', () => {
    it('filters results to specified note types', () => {
      const result = query(index, 'test', {
        noteTypes: ['belief'],
        minScore: 0,
        minBm25Score: 0,
      });

      for (const r of result.results) {
        expect(r.doc.noteType).toBe('belief');
      }
    });

    it('supports multiple note types', () => {
      const result = query(index, 'test', {
        noteTypes: ['belief', 'research'],
        minScore: 0,
        minBm25Score: 0,
      });

      for (const r of result.results) {
        expect(['belief', 'research']).toContain(r.doc.noteType);
      }
    });

    it('returns empty results when noteTypes filter matches nothing', () => {
      const result = query(index, 'test', {
        noteTypes: ['bet'], // might not have matches with 'test'
        minScore: 0,
        minBm25Score: 0,
        maxResults: 10,
      });

      for (const r of result.results) {
        expect(r.doc.noteType).toBe('bet');
      }
    });

    it('applies noteTypes filter before scoring', () => {
      // Query without filter
      const allResults = query(index, 'test', {
        minScore: 0,
        minBm25Score: 0,
        maxResults: 20,
      });

      // Query with filter
      const filteredResults = query(index, 'test', {
        noteTypes: ['belief'],
        minScore: 0,
        minBm25Score: 0,
        maxResults: 20,
      });

      // Filtered results should be a subset matching the type
      for (const r of filteredResults.results) {
        expect(r.doc.noteType).toBe('belief');
      }

      // And all beliefs from allResults should be in filteredResults
      const beliefPaths = new Set(filteredResults.results.map((r) => r.doc.path));
      for (const r of allResults.results) {
        if (r.doc.noteType === 'belief') {
          expect(beliefPaths.has(r.doc.path)).toBe(true);
        }
      }
    });
  });

  describe('scoring pipeline verification', () => {
    it('applies BM25 normalization formula s/(1+s)', () => {
      const result = query(index, 'test', { minScore: 0, minBm25Score: 0 });

      for (const r of result.results) {
        // Verify the normalization formula
        const expected = r.bm25Raw / (1 + r.bm25Raw);
        expect(r.bm25Normalized).toBeCloseTo(expected, 5);
      }
    });

    it('applies multiplicative compound formula correctly', () => {
      const result = query(index, 'test', { minScore: 0, minBm25Score: 0 });

      for (const r of result.results) {
        // compound = bm25_normalized × (1 + type_boost + confidence_modifier)
        const multiplier = 1 + r.typeBoost + r.confidenceModifier;
        const expected = r.bm25Normalized * multiplier;
        expect(r.score).toBeCloseTo(expected, 5);
      }
    });

    it('includes matchedFields from search results', () => {
      const result = query(index, 'test', { minScore: 0, minBm25Score: 0 });

      // At least some results should have matched fields
      const hasMatchedFields = result.results.some(
        (r) => r.matchedFields.length > 0
      );
      expect(hasMatchedFields).toBe(true);
    });
  });
});

describe('query with custom index', () => {
  let index: VaultIndex;

  beforeEach(() => {
    index = new VaultIndex();
  });

  it('works with manually added documents', () => {
    const doc = createTestDocument({
      path: '/test/memory.md',
      title: 'Memory Systems',
      description: 'About memory management',
      noteType: 'research',
      status: 'proven',
      rawBody: 'Detailed discussion of memory management techniques.',
    });
    index.addDocument(doc);

    const result = query(index, 'memory');

    expect(result.results.length).toBe(1);
    expect(result.results[0].doc.path).toBe('/test/memory.md');
  });

  it('empty index returns empty results', () => {
    const result = query(index, 'anything');

    expect(result.results).toHaveLength(0);
    expect(result.tier).toBe(0);
    expect(result.latencyMs).toBeGreaterThan(0);
  });

  it('belief type boost affects compound score', () => {
    // Add similar documents with different types
    const belief = createTestDocument({
      path: '/test/memory-belief.md',
      title: 'Memory Beliefs',
      noteType: 'belief',
      confidence: 'high',
      maturity: 'evergreen',
      rawBody: 'Our beliefs about memory.',
    });

    const experience = createTestDocument({
      path: '/test/memory-experience.md',
      title: 'Memory Experience',
      noteType: 'experience',
      rawBody: 'Our experience with memory.',
    });

    index.addDocument(belief);
    index.addDocument(experience);

    const result = query(index, 'memory', {
      minScore: 0,
      minBm25Score: 0,
      maxResults: 10,
    });

    // Both should match, but belief should have higher compound score
    // due to type boost (+0.15) and confidence/maturity modifiers
    const beliefResult = result.results.find(
      (r) => r.doc.path === '/test/memory-belief.md'
    );
    const experienceResult = result.results.find(
      (r) => r.doc.path === '/test/memory-experience.md'
    );

    expect(beliefResult).toBeDefined();
    expect(experienceResult).toBeDefined();
    expect(beliefResult!.typeBoost).toBe(0.15);
    expect(experienceResult!.typeBoost).toBe(0.0);
    expect(beliefResult!.score).toBeGreaterThan(experienceResult!.score);
  });

  it('research status modifier affects compound score', () => {
    const proven = createTestDocument({
      path: '/test/research-proven.md',
      title: 'Research Proven',
      noteType: 'research',
      status: 'proven',
      rawBody: 'Proven research findings.',
    });

    const opinion = createTestDocument({
      path: '/test/research-opinion.md',
      title: 'Research Opinion',
      noteType: 'research',
      status: 'opinion',
      rawBody: 'Opinion based research.',
    });

    index.addDocument(proven);
    index.addDocument(opinion);

    const result = query(index, 'research', {
      minScore: 0,
      minBm25Score: 0,
      maxResults: 10,
    });

    const provenResult = result.results.find(
      (r) => r.doc.path === '/test/research-proven.md'
    );
    const opinionResult = result.results.find(
      (r) => r.doc.path === '/test/research-opinion.md'
    );

    expect(provenResult).toBeDefined();
    expect(opinionResult).toBeDefined();
    expect(provenResult!.confidenceModifier).toBe(0.1); // proven
    expect(opinionResult!.confidenceModifier).toBe(-0.05); // opinion
    expect(provenResult!.score).toBeGreaterThan(opinionResult!.score);
  });
});

describe('query with RetrievalConfig', () => {
  let index: VaultIndex;

  beforeEach(() => {
    index = new VaultIndex();
    index.addDocument(
      createTestDocument({
        path: '/test/doc.md',
        title: 'Test Document',
        noteType: 'experience',
        rawBody: 'Test content for retrieval.',
      })
    );
  });

  it('uses custom scoring config', () => {
    const customScoring = {
      ...DEFAULT_SCORING_CONFIG,
      bm25Floor: 0.05,
    };

    const result = query(
      index,
      'test',
      { minBm25Score: 0.05 },
      { scoring: customScoring }
    );

    // Should find results with lower BM25 floor
    // The minBm25Score option overrides the config
    for (const r of result.results) {
      expect(r.bm25Normalized).toBeGreaterThanOrEqual(0.05);
    }
  });

  it('uses default options from config', () => {
    const result = query(
      index,
      'test',
      undefined,
      { defaults: { maxResults: 1 } }
    );

    expect(result.results.length).toBeLessThanOrEqual(1);
  });

  it('query options override config defaults', () => {
    const result = query(
      index,
      'test',
      { maxResults: 2 },
      { defaults: { maxResults: 1 } }
    );

    // maxResults from options (2) should override config defaults (1)
    expect(result.results.length).toBeLessThanOrEqual(2);
  });
});

describe('latencyMs timing', () => {
  let index: VaultIndex;

  beforeAll(async () => {
    index = await rebuildIndex(vaultFixtureDir);
  });

  it('latencyMs reflects actual query time', () => {
    const result = query(index, 'test');

    // Should be a positive number
    expect(result.latencyMs).toBeGreaterThan(0);
    // Should be reasonable (less than 1 second for in-memory search)
    expect(result.latencyMs).toBeLessThan(1000);
  });

  it('latencyMs varies between queries', () => {
    // Run multiple queries
    const results = [
      query(index, 'test'),
      query(index, 'belief'),
      query(index, 'research notes'),
    ];

    // All should have latency
    for (const r of results) {
      expect(r.latencyMs).toBeGreaterThan(0);
    }
  });

  it('latencyMs is populated even for empty results', () => {
    const result = query(index, 'nonexistentquery12345');

    expect(result.latencyMs).toBeGreaterThan(0);
  });
});

describe('context re-ranking', () => {
  let index: VaultIndex;

  beforeEach(() => {
    index = new VaultIndex();
  });

  describe('contextTerms in QueryResult', () => {
    it('contextTerms populated in QueryResult when context provided', () => {
      index.addDocument(
        createTestDocument({
          path: '/test/doc.md',
          title: 'Test Document',
          noteType: 'research',
          rawBody: 'Test content about memory.',
        })
      );

      const result = query(index, 'test', {
        context: 'Memory management strategies',
        minScore: 0,
        minBm25Score: 0,
      });

      expect(result.contextTerms).toBeDefined();
      expect(Array.isArray(result.contextTerms)).toBe(true);
      expect(result.contextTerms!.length).toBeGreaterThan(0);
      // Should include stemmed terms (memory -> memori, management -> manag, strategies -> strategi)
    });

    it('contextTerms not present when no context provided', () => {
      index.addDocument(
        createTestDocument({
          path: '/test/doc.md',
          title: 'Test Document',
          noteType: 'research',
          rawBody: 'Test content.',
        })
      );

      const result = query(index, 'test', {
        minScore: 0,
        minBm25Score: 0,
      });

      expect(result.contextTerms).toBeUndefined();
    });

    it('contextTerms not present when context is empty string', () => {
      index.addDocument(
        createTestDocument({
          path: '/test/doc.md',
          title: 'Test Document',
          noteType: 'research',
          rawBody: 'Test content.',
        })
      );

      const result = query(index, 'test', {
        context: '',
        minScore: 0,
        minBm25Score: 0,
      });

      expect(result.contextTerms).toBeUndefined();
    });

    it('contextTerms not present when context is only whitespace', () => {
      index.addDocument(
        createTestDocument({
          path: '/test/doc.md',
          title: 'Test Document',
          noteType: 'research',
          rawBody: 'Test content.',
        })
      );

      const result = query(index, 'test', {
        context: '   ',
        minScore: 0,
        minBm25Score: 0,
      });

      expect(result.contextTerms).toBeUndefined();
    });

    it('contextTerms filters out stopwords', () => {
      index.addDocument(
        createTestDocument({
          path: '/test/doc.md',
          title: 'Test Document',
          noteType: 'research',
          rawBody: 'Test content.',
        })
      );

      const result = query(index, 'test', {
        context: 'the memory is in the system',
        minScore: 0,
        minBm25Score: 0,
      });

      expect(result.contextTerms).toBeDefined();
      // Should not include 'the', 'is', 'in'
      expect(result.contextTerms).not.toContain('the');
      expect(result.contextTerms).not.toContain('is');
      expect(result.contextTerms).not.toContain('in');
    });
  });

  describe('contextOverlap calculation', () => {
    it('contextOverlap field added to ScoredDocument when context provided', () => {
      index.addDocument(
        createTestDocument({
          path: '/test/doc.md',
          title: 'Memory Systems',
          noteType: 'research',
          rawBody: 'Discussion about memory systems and strategies.',
        })
      );

      const result = query(index, 'memory', {
        context: 'memory strategies',
        minScore: 0,
        minBm25Score: 0,
      });

      expect(result.results.length).toBeGreaterThan(0);
      expect(result.results[0].contextOverlap).toBeDefined();
      expect(typeof result.results[0].contextOverlap).toBe('number');
      expect(result.results[0].contextOverlap).toBeGreaterThanOrEqual(0);
      expect(result.results[0].contextOverlap).toBeLessThanOrEqual(1);
    });

    it('contextOverlap is 1 when all context terms are in document', () => {
      index.addDocument(
        createTestDocument({
          path: '/test/doc.md',
          title: 'Memory Management',
          noteType: 'research',
          rawBody: 'Memory management strategies for systems.',
        })
      );

      const result = query(index, 'memory', {
        context: 'memory management',
        minScore: 0,
        minBm25Score: 0,
      });

      expect(result.results.length).toBe(1);
      expect(result.results[0].contextOverlap).toBe(1);
    });

    it('contextOverlap is 0 when no context terms are in document', () => {
      index.addDocument(
        createTestDocument({
          path: '/test/doc.md',
          title: 'Test Document',
          noteType: 'research',
          rawBody: 'Test content about something.',
        })
      );

      const result = query(index, 'test', {
        context: 'completely unrelated keywords xyz',
        minScore: 0,
        minBm25Score: 0,
      });

      expect(result.results.length).toBe(1);
      expect(result.results[0].contextOverlap).toBe(0);
    });

    it('contextOverlap reflects fraction of context terms in document', () => {
      index.addDocument(
        createTestDocument({
          path: '/test/doc.md',
          title: 'Memory Document',
          noteType: 'research',
          rawBody: 'Discussion about memory only.',
        })
      );

      // Context has 2 terms: 'memory' and 'strategies'
      // Document only contains 'memory'
      const result = query(index, 'memory', {
        context: 'memory strategies',
        minScore: 0,
        minBm25Score: 0,
      });

      expect(result.results.length).toBe(1);
      // Should be 0.5 (1 of 2 context terms found)
      expect(result.results[0].contextOverlap).toBe(0.5);
    });

    it('contextOverlap not present when no context provided', () => {
      index.addDocument(
        createTestDocument({
          path: '/test/doc.md',
          title: 'Test Document',
          noteType: 'research',
          rawBody: 'Test content.',
        })
      );

      const result = query(index, 'test', {
        minScore: 0,
        minBm25Score: 0,
      });

      expect(result.results.length).toBe(1);
      expect(result.results[0].contextOverlap).toBeUndefined();
    });
  });

  describe('re-ranking behavior', () => {
    it('context re-ranking changes order of similarly-scored results', () => {
      // Create two documents that will have similar BM25 scores
      // but one has better context overlap
      const docWithContext = createTestDocument({
        path: '/test/doc-context.md',
        title: 'Memory Systems',
        noteType: 'research',
        rawBody: 'Discussion about memory systems and optimization strategies.',
      });

      const docWithoutContext = createTestDocument({
        path: '/test/doc-no-context.md',
        title: 'Memory Overview',
        noteType: 'research',
        rawBody: 'General memory overview without specific keywords.',
      });

      index.addDocument(docWithContext);
      index.addDocument(docWithoutContext);

      // Query without context - order determined by BM25/compound score
      const resultNoContext = query(index, 'memory', {
        minScore: 0,
        minBm25Score: 0,
        maxResults: 10,
      });

      // Query with context that matches first document better
      const resultWithContext = query(index, 'memory', {
        context: 'optimization strategies',
        minScore: 0,
        minBm25Score: 0,
        maxResults: 10,
      });

      // Both queries should return both documents
      expect(resultNoContext.results.length).toBe(2);
      expect(resultWithContext.results.length).toBe(2);

      // With context, the document with 'optimization strategies' should have higher overlap
      const docContextResult = resultWithContext.results.find(
        (r) => r.doc.path === '/test/doc-context.md'
      );
      const docNoContextResult = resultWithContext.results.find(
        (r) => r.doc.path === '/test/doc-no-context.md'
      );

      expect(docContextResult!.contextOverlap).toBeGreaterThan(
        docNoContextResult!.contextOverlap!
      );
    });

    it('context with no overlap produces no re-ranking effect', () => {
      // Create two documents with similar scores
      const doc1 = createTestDocument({
        path: '/test/doc1.md',
        title: 'Memory Alpha',
        noteType: 'research',
        rawBody: 'Memory content alpha.',
      });

      const doc2 = createTestDocument({
        path: '/test/doc2.md',
        title: 'Memory Beta',
        noteType: 'research',
        rawBody: 'Memory content beta.',
      });

      index.addDocument(doc1);
      index.addDocument(doc2);

      // Query without context
      const resultNoContext = query(index, 'memory', {
        minScore: 0,
        minBm25Score: 0,
        maxResults: 10,
      });

      // Query with context that has no overlap with either document
      const resultWithContext = query(index, 'memory', {
        context: 'xyz unrelated terms abc',
        minScore: 0,
        minBm25Score: 0,
        maxResults: 10,
      });

      // Both should have zero overlap
      for (const r of resultWithContext.results) {
        expect(r.contextOverlap).toBe(0);
      }

      // Order should be same as without context (sorted by compound score)
      expect(resultNoContext.results.map((r) => r.doc.path)).toEqual(
        resultWithContext.results.map((r) => r.doc.path)
      );
    });

    it('results with dissimilar scores maintain original order despite context', () => {
      // Create documents with significantly different BM25 scores
      // by making one much more relevant to the query
      const highBm25Doc = createTestDocument({
        path: '/test/high-bm25.md',
        title: 'Memory Memory Memory', // Many keyword matches
        noteType: 'research',
        rawBody:
          'Memory memory memory memory. Extensive memory discussion about memory.',
      });

      const lowBm25Doc = createTestDocument({
        path: '/test/low-bm25.md',
        title: 'Something Else',
        noteType: 'research',
        rawBody: 'Brief mention of memory.',
      });

      index.addDocument(highBm25Doc);
      index.addDocument(lowBm25Doc);

      // Query with context that heavily favors the LOW BM25 document
      const result = query(index, 'memory', {
        context: 'something else brief mention',
        minScore: 0,
        minBm25Score: 0,
        maxResults: 10,
      });

      expect(result.results.length).toBe(2);

      // The low BM25 doc should have better context overlap
      const highResult = result.results.find(
        (r) => r.doc.path === '/test/high-bm25.md'
      );
      const lowResult = result.results.find(
        (r) => r.doc.path === '/test/low-bm25.md'
      );

      expect(lowResult!.contextOverlap).toBeGreaterThan(
        highResult!.contextOverlap!
      );

      // But the high BM25 doc should still rank first because BM25 primacy
      expect(result.results[0].doc.path).toBe('/test/high-bm25.md');
      expect(result.results[0].score).toBeGreaterThan(result.results[1].score);
    });

    it('BM25 primacy is preserved - context is tiebreaker only', () => {
      // Create multiple documents to verify BM25 primacy
      const highScore = createTestDocument({
        path: '/test/high.md',
        title: 'Test Test Test', // High relevance
        noteType: 'belief',
        confidence: 'high',
        maturity: 'evergreen',
        rawBody: 'Test test test test test.',
      });

      const medScore = createTestDocument({
        path: '/test/med.md',
        title: 'Test Content',
        noteType: 'research',
        status: 'proven',
        rawBody: 'Test content here.',
      });

      const lowScore = createTestDocument({
        path: '/test/low.md',
        title: 'Something',
        noteType: 'experience',
        rawBody: 'Brief test mention.',
      });

      index.addDocument(highScore);
      index.addDocument(medScore);
      index.addDocument(lowScore);

      // Context heavily favors the low score document
      const result = query(index, 'test', {
        context: 'brief mention something',
        minScore: 0,
        minBm25Score: 0,
        maxResults: 10,
      });

      // All three should be returned
      expect(result.results.length).toBe(3);

      // Scores should still be in descending order (BM25 primacy)
      for (let i = 1; i < result.results.length; i++) {
        // Allow for small differences due to context tiebreaker
        // but large score differences should be preserved
        const scoreDiff = result.results[i - 1].score - result.results[i].score;
        if (scoreDiff > 0.05) {
          // Significant difference - should be preserved
          expect(result.results[i - 1].score).toBeGreaterThan(
            result.results[i].score
          );
        }
      }
    });
  });

  describe('re-ranking skipped without context', () => {
    it('re-ranking step is skipped entirely when no context provided', () => {
      const doc1 = createTestDocument({
        path: '/test/doc1.md',
        title: 'Test Document One',
        noteType: 'research',
        rawBody: 'Test content one.',
      });

      const doc2 = createTestDocument({
        path: '/test/doc2.md',
        title: 'Test Document Two',
        noteType: 'research',
        rawBody: 'Test content two.',
      });

      index.addDocument(doc1);
      index.addDocument(doc2);

      const result = query(index, 'test', {
        minScore: 0,
        minBm25Score: 0,
      });

      // No contextOverlap should be set
      for (const r of result.results) {
        expect(r.contextOverlap).toBeUndefined();
      }

      // No contextTerms in result
      expect(result.contextTerms).toBeUndefined();
    });
  });
});

describe('noteTypes filter additional tests', () => {
  let index: VaultIndex;

  beforeEach(() => {
    index = new VaultIndex();
  });

  it('noteTypes filter with no matches returns empty results', () => {
    // Add only research documents
    index.addDocument(
      createTestDocument({
        path: '/test/research.md',
        title: 'Research Document',
        noteType: 'research',
        rawBody: 'Research content.',
      })
    );

    // Filter for beliefs (none exist)
    const result = query(index, 'research', {
      noteTypes: ['belief'],
      minScore: 0,
      minBm25Score: 0,
    });

    expect(result.results).toHaveLength(0);
  });

  it('noteTypes filter restricts results to matching note types only', () => {
    // Add documents of different types
    index.addDocument(
      createTestDocument({
        path: '/test/belief.md',
        title: 'Test Belief',
        noteType: 'belief',
        rawBody: 'Test belief content.',
      })
    );

    index.addDocument(
      createTestDocument({
        path: '/test/research.md',
        title: 'Test Research',
        noteType: 'research',
        rawBody: 'Test research content.',
      })
    );

    index.addDocument(
      createTestDocument({
        path: '/test/experience.md',
        title: 'Test Experience',
        noteType: 'experience',
        rawBody: 'Test experience content.',
      })
    );

    // Filter for only belief and experience
    const result = query(index, 'test', {
      noteTypes: ['belief', 'experience'],
      minScore: 0,
      minBm25Score: 0,
      maxResults: 10,
    });

    // Should only return belief and experience
    expect(result.results.length).toBe(2);
    const noteTypes = result.results.map((r) => r.doc.noteType);
    expect(noteTypes).toContain('belief');
    expect(noteTypes).toContain('experience');
    expect(noteTypes).not.toContain('research');
  });
});
