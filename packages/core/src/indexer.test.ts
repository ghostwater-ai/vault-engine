import { describe, it, expect, beforeEach } from 'vitest';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { VaultIndex, rebuildIndex } from './indexer.js';
import type { VaultDocument } from './types.js';

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

describe('VaultIndex', () => {
  let index: VaultIndex;

  beforeEach(() => {
    index = new VaultIndex();
  });

  describe('constructor', () => {
    it('creates an empty index', () => {
      const stats = index.getStats();
      expect(stats.documentCount).toBe(0);
      expect(stats.lastBuildTime).toBe('');
    });
  });

  describe('addDocument', () => {
    it('adds a document to the index', () => {
      const doc = createTestDocument({
        path: '/test/doc1.md',
        title: 'Test Title',
        description: 'Test description',
      });

      index.addDocument(doc);

      expect(index.getStats().documentCount).toBe(1);
      expect(index.getDocument('/test/doc1.md')).toEqual(doc);
    });

    it('throws error when adding duplicate document', () => {
      const doc = createTestDocument({ path: '/test/doc1.md' });

      index.addDocument(doc);

      expect(() => index.addDocument(doc)).toThrow('Document already exists');
    });

    it('makes document searchable', () => {
      const doc = createTestDocument({
        path: '/test/doc1.md',
        title: 'Memory Systems',
        rawBody: 'This is about memory management.',
      });

      index.addDocument(doc);

      const results = index.search('memory');
      expect(results.length).toBe(1);
      expect(results[0].id).toBe('/test/doc1.md');
    });
  });

  describe('removeDocument', () => {
    it('removes a document from the index', () => {
      const doc = createTestDocument({ path: '/test/doc1.md' });
      index.addDocument(doc);

      index.removeDocument('/test/doc1.md');

      expect(index.getStats().documentCount).toBe(0);
      expect(index.getDocument('/test/doc1.md')).toBeUndefined();
    });

    it('throws error when removing non-existent document', () => {
      expect(() => index.removeDocument('/non/existent.md')).toThrow(
        'Document not found'
      );
    });

    it('removes document from search results', () => {
      const doc = createTestDocument({
        path: '/test/doc1.md',
        title: 'Unique Keyword',
      });
      index.addDocument(doc);

      index.removeDocument('/test/doc1.md');

      const results = index.search('unique');
      expect(results.length).toBe(0);
    });
  });

  describe('updateDocument', () => {
    it('updates an existing document', () => {
      const doc = createTestDocument({
        path: '/test/doc1.md',
        title: 'Original Title',
      });
      index.addDocument(doc);

      const updated = createTestDocument({
        path: '/test/doc1.md',
        title: 'Updated Title',
      });
      index.updateDocument(updated);

      expect(index.getDocument('/test/doc1.md')?.title).toBe('Updated Title');
    });

    it('throws error when updating non-existent document', () => {
      const doc = createTestDocument({ path: '/non/existent.md' });
      expect(() => index.updateDocument(doc)).toThrow('Document not found');
    });

    it('updates search results', () => {
      const doc = createTestDocument({
        path: '/test/doc1.md',
        title: 'Original Keyword',
      });
      index.addDocument(doc);

      const updated = createTestDocument({
        path: '/test/doc1.md',
        title: 'Modified Content',
      });
      index.updateDocument(updated);

      expect(index.search('original').length).toBe(0);
      expect(index.search('modified').length).toBe(1);
    });
  });

  describe('search', () => {
    beforeEach(() => {
      // Add test documents with different field content
      index.addDocument(
        createTestDocument({
          path: '/test/title-match.md',
          title: 'Memory Architecture',
          description: 'General system overview',
          rawBody: 'Details about general architecture patterns.',
        })
      );

      index.addDocument(
        createTestDocument({
          path: '/test/body-match.md',
          title: 'General Overview',
          description: 'System patterns',
          rawBody: 'The memory subsystem handles data storage.',
        })
      );

      index.addDocument(
        createTestDocument({
          path: '/test/description-match.md',
          title: 'System Design',
          description: 'Memory management overview',
          rawBody: 'General architecture discussion.',
        })
      );

      index.addDocument(
        createTestDocument({
          path: '/test/topics-match.md',
          title: 'System Guide',
          description: 'General guide',
          topics: ['memory', 'caching'],
          rawBody: 'Architecture patterns explained.',
        })
      );
    });

    it('returns results with BM25 scores', () => {
      const results = index.search('memory');

      expect(results.length).toBeGreaterThan(0);
      for (const result of results) {
        expect(result.score).toBeGreaterThan(0);
        expect(result.id).toBeDefined();
      }
    });

    it('field weighting: title matches rank higher than body matches', () => {
      const results = index.search('memory');

      // Find the title match and body match results
      const titleMatch = results.find((r) => r.id === '/test/title-match.md');
      const bodyMatch = results.find((r) => r.id === '/test/body-match.md');

      expect(titleMatch).toBeDefined();
      expect(bodyMatch).toBeDefined();
      expect(titleMatch!.score).toBeGreaterThan(bodyMatch!.score);
    });

    it('field weighting: title matches rank higher than description matches', () => {
      const results = index.search('memory');

      const titleMatch = results.find((r) => r.id === '/test/title-match.md');
      const descMatch = results.find(
        (r) => r.id === '/test/description-match.md'
      );

      expect(titleMatch).toBeDefined();
      expect(descMatch).toBeDefined();
      expect(titleMatch!.score).toBeGreaterThan(descMatch!.score);
    });

    it('field weighting: description matches rank higher than body matches', () => {
      const results = index.search('memory');

      const descMatch = results.find(
        (r) => r.id === '/test/description-match.md'
      );
      const bodyMatch = results.find((r) => r.id === '/test/body-match.md');

      expect(descMatch).toBeDefined();
      expect(bodyMatch).toBeDefined();
      expect(descMatch!.score).toBeGreaterThan(bodyMatch!.score);
    });

    it('field weighting: topics matches rank higher than body matches', () => {
      const results = index.search('memory');

      const topicsMatch = results.find((r) => r.id === '/test/topics-match.md');
      const bodyMatch = results.find((r) => r.id === '/test/body-match.md');

      expect(topicsMatch).toBeDefined();
      expect(bodyMatch).toBeDefined();
      expect(topicsMatch!.score).toBeGreaterThan(bodyMatch!.score);
    });
  });

  describe('fuzzy matching', () => {
    beforeEach(() => {
      index.addDocument(
        createTestDocument({
          path: '/test/memory.md',
          title: 'Memory Systems',
          rawBody: 'About memory management and allocation.',
        })
      );
    });

    it('matches with minor typos (fuzzy: 0.2)', () => {
      // "mem" should fuzzy match "memory"
      const results = index.search('mem');
      expect(results.length).toBeGreaterThan(0);
    });

    it('matches partial words via prefix search', () => {
      const results = index.search('memor');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].id).toBe('/test/memory.md');
    });

    it('fuzzy matches with character substitution', () => {
      // "memery" is a typo for "memory" - within fuzzy tolerance
      const results = index.search('memery');
      expect(results.length).toBeGreaterThan(0);
    });
  });

  describe('stemming', () => {
    beforeEach(() => {
      index.addDocument(
        createTestDocument({
          path: '/test/running.md',
          title: 'Running Applications',
          rawBody: 'Information about running and runs.',
        })
      );

      index.addDocument(
        createTestDocument({
          path: '/test/connection.md',
          title: 'Connection Management',
          rawBody: 'Handling connections and connecting services.',
        })
      );
    });

    it('stemming: "running" matches "run"', () => {
      const results = index.search('run');
      expect(results.length).toBeGreaterThan(0);
      expect(results.some((r) => r.id === '/test/running.md')).toBe(true);
    });

    it('stemming: "run" matches "running"', () => {
      const results = index.search('running');
      expect(results.length).toBeGreaterThan(0);
    });

    it('stemming: "connect" matches "connections"', () => {
      const results = index.search('connect');
      expect(results.length).toBeGreaterThan(0);
      expect(results.some((r) => r.id === '/test/connection.md')).toBe(true);
    });

    it('stemming: plural forms match singular', () => {
      const results = index.search('connection');
      expect(results.length).toBeGreaterThan(0);
      expect(results.some((r) => r.id === '/test/connection.md')).toBe(true);
    });
  });

  describe('stopword handling', () => {
    beforeEach(() => {
      index.addDocument(
        createTestDocument({
          path: '/test/stopwords.md',
          title: 'The Architecture',
          rawBody: 'This is a test of the system and it will be great.',
        })
      );

      index.addDocument(
        createTestDocument({
          path: '/test/architecture.md',
          title: 'Architecture Patterns',
          rawBody: 'Design patterns for building systems.',
        })
      );
    });

    it('stopwords like "the" do not inflate results', () => {
      // Searching for "the" alone should return few or no results
      // since "the" is a stopword that gets filtered out
      const results = index.search('the');
      // Stopwords are filtered, so this may return no results or very low scores
      // The key test is that it doesn't return high-scoring matches
      if (results.length > 0) {
        // If any results, they should have relatively low scores
        expect(results[0].score).toBeLessThan(10);
      }
    });

    it('stopwords like "is" do not affect search', () => {
      const results = index.search('is');
      // Should return few or no results since "is" is filtered
      if (results.length > 0) {
        expect(results[0].score).toBeLessThan(10);
      }
    });

    it('search with mixed stopwords focuses on content words', () => {
      // "the architecture" should match based on "architecture" only
      const results = index.search('the architecture');
      expect(results.length).toBeGreaterThan(0);
      // Both documents should be found based on "architecture"
      expect(results.some((r) => r.id === '/test/stopwords.md')).toBe(true);
      expect(results.some((r) => r.id === '/test/architecture.md')).toBe(true);
    });
  });

  describe('getStats', () => {
    it('returns correct document count', () => {
      index.addDocument(createTestDocument({ path: '/test/doc1.md' }));
      index.addDocument(createTestDocument({ path: '/test/doc2.md' }));

      const stats = index.getStats();
      expect(stats.documentCount).toBe(2);
    });

    it('returns correct type distribution', () => {
      index.addDocument(
        createTestDocument({ path: '/test/exp1.md', noteType: 'experience' })
      );
      index.addDocument(
        createTestDocument({ path: '/test/exp2.md', noteType: 'experience' })
      );
      index.addDocument(
        createTestDocument({ path: '/test/belief.md', noteType: 'belief' })
      );
      index.addDocument(
        createTestDocument({ path: '/test/research.md', noteType: 'research' })
      );

      const stats = index.getStats();
      expect(stats.typeDistribution.experience).toBe(2);
      expect(stats.typeDistribution.belief).toBe(1);
      expect(stats.typeDistribution.research).toBe(1);
      expect(stats.typeDistribution.entity).toBe(0);
    });

    it('returns estimated index size', () => {
      index.addDocument(createTestDocument({ path: '/test/doc1.md' }));

      const stats = index.getStats();
      expect(stats.indexSizeBytes).toBeGreaterThan(0);
    });

    it('returns empty string lastBuildTime when not built from vault', () => {
      index.addDocument(createTestDocument({ path: '/test/doc1.md' }));

      const stats = index.getStats();
      expect(stats.lastBuildTime).toBe('');
    });

    it('returns ISO timestamp string for lastBuildTime', async () => {
      await index.buildIndex(vaultFixtureDir);

      const stats = index.getStats();
      expect(stats.lastBuildTime).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
      );
      // Verify it can be parsed as a valid date
      const parsedDate = new Date(stats.lastBuildTime);
      expect(parsedDate.getTime()).not.toBeNaN();
    });
  });

  describe('clear', () => {
    it('removes all documents from the index', () => {
      index.addDocument(createTestDocument({ path: '/test/doc1.md' }));
      index.addDocument(createTestDocument({ path: '/test/doc2.md' }));

      index.clear();

      expect(index.getStats().documentCount).toBe(0);
    });

    it('clears search results', () => {
      index.addDocument(
        createTestDocument({
          path: '/test/doc1.md',
          title: 'Unique Content',
        })
      );

      index.clear();

      const results = index.search('unique');
      expect(results.length).toBe(0);
    });
  });

  describe('buildIndex', () => {
    it('builds index from vault directory', async () => {
      const count = await index.buildIndex(vaultFixtureDir);

      expect(count).toBe(11); // Based on parser tests
      expect(index.getStats().documentCount).toBe(11);
    });

    it('sets lastBuildTime after building', async () => {
      const before = new Date();
      await index.buildIndex(vaultFixtureDir);
      const after = new Date();

      const stats = index.getStats();
      expect(stats.lastBuildTime).not.toBe('');
      const buildTime = new Date(stats.lastBuildTime);
      expect(buildTime.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(buildTime.getTime()).toBeLessThanOrEqual(after.getTime());
    });

    it('clears existing index before building', async () => {
      index.addDocument(
        createTestDocument({
          path: '/manual/doc.md',
          title: 'Manual Document',
        })
      );

      await index.buildIndex(vaultFixtureDir);

      expect(index.getDocument('/manual/doc.md')).toBeUndefined();
    });

    it('documents are searchable after building', async () => {
      await index.buildIndex(vaultFixtureDir);

      // Search for content known to be in fixture files (test-experience.md)
      const results = index.search('test');
      expect(results.length).toBeGreaterThan(0);
    });

    it('returns 0 for non-existent vault path', async () => {
      const count = await index.buildIndex('/non/existent/path');

      expect(count).toBe(0);
      expect(index.getStats().documentCount).toBe(0);
    });

    it('indexes correct note type distribution', async () => {
      await index.buildIndex(vaultFixtureDir);

      const stats = index.getStats();
      // Based on vault fixture structure
      expect(stats.typeDistribution.experience).toBeGreaterThan(0);
      expect(stats.typeDistribution.research).toBeGreaterThan(0);
      expect(stats.typeDistribution.belief).toBeGreaterThan(0);
      expect(stats.typeDistribution.topic).toBeGreaterThan(0);
    });
  });
});

describe('rebuildIndex', () => {
  it('creates and builds a new VaultIndex', async () => {
    const index = await rebuildIndex(vaultFixtureDir);

    expect(index).toBeInstanceOf(VaultIndex);
    expect(index.getStats().documentCount).toBe(11);
    expect(index.getStats().lastBuildTime).not.toBe('');
  });

  it('returns VaultIndex with ISO timestamp lastBuildTime', async () => {
    const index = await rebuildIndex(vaultFixtureDir);

    const stats = index.getStats();
    // Verify it's a valid ISO timestamp
    expect(stats.lastBuildTime).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
    );
  });

  it('returns searchable index', async () => {
    const index = await rebuildIndex(vaultFixtureDir);

    const results = index.search('test');
    expect(results.length).toBeGreaterThan(0);
  });
});

describe('VaultIndex integration tests', () => {
  let index: VaultIndex;

  beforeEach(async () => {
    index = await rebuildIndex(vaultFixtureDir);
  });

  it('field weighting works with real vault documents', async () => {
    // Add a document with "BM25" in the title
    const titleDoc = createTestDocument({
      path: '/test/bm25-title.md',
      title: 'BM25 Algorithm',
      description: 'Some algorithm',
      rawBody: 'General text about algorithms.',
    });

    // Add a document with "BM25" in the body
    const bodyDoc = createTestDocument({
      path: '/test/bm25-body.md',
      title: 'Algorithm Overview',
      description: 'Some overview',
      rawBody: 'This discusses the BM25 algorithm in detail.',
    });

    index.addDocument(titleDoc);
    index.addDocument(bodyDoc);

    const results = index.search('BM25');

    const titleResult = results.find((r) => r.id === '/test/bm25-title.md');
    const bodyResult = results.find((r) => r.id === '/test/bm25-body.md');

    expect(titleResult).toBeDefined();
    expect(bodyResult).toBeDefined();
    // Title match should rank higher due to boost
    expect(titleResult!.score).toBeGreaterThan(bodyResult!.score);
  });

  it('searches across all indexed documents', async () => {
    // Search for a term that should be in multiple documents
    const results = index.search('test');

    // Should find documents from the vault fixture
    expect(results.length).toBeGreaterThan(1);
  });

  it('wiki-links are searchable as terms', async () => {
    // Vault fixtures include wiki-links that should be stripped and indexed
    // The parser already strips brackets, making the linked term searchable

    // Add a document with a known wiki-link term
    const doc = createTestDocument({
      path: '/test/wikilink.md',
      title: 'Document with Link',
      rawBody: 'This references the auth-system-design for more details.',
    });
    index.addDocument(doc);

    const results = index.search('auth-system-design');
    expect(results.some((r) => r.id === '/test/wikilink.md')).toBe(true);
  });
});
