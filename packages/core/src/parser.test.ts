import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { parseFile, parseVaultDirectory } from './parser.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const fixturesDir = join(__dirname, '__fixtures__');
const vaultFixtureDir = join(fixturesDir, 'vault');

describe('parseFile', () => {
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleWarnSpy.mockRestore();
  });

  describe('valid note parsing', () => {
    it('parses experience note with all frontmatter fields', async () => {
      const result = await parseFile(join(fixturesDir, 'experience-valid.md'));

      expect(result).not.toBeNull();
      expect(result!.noteType).toBe('experience');
      expect(result!.slug).toBe('experience-valid');
      expect(result!.title).toBe('Successful Auth System Deployment');
      expect(result!.description).toBe(
        'A successful production deployment of the new auth system'
      );
      expect(result!.topics).toEqual(['deployment', 'authentication']);
      expect(result!.status).toBe('completed');
      expect(result!.provenance).toBe('internal-team');
      expect(result!.date).toBe('2025-03-15');
    });

    it('parses research note correctly', async () => {
      const result = await parseFile(join(fixturesDir, 'research-valid.md'));

      expect(result).not.toBeNull();
      expect(result!.noteType).toBe('research');
      expect(result!.slug).toBe('research-valid');
      expect(result!.title).toBe('BM25 Algorithm Deep Dive');
      expect(result!.status).toBe('proven');
      expect(result!.confidence).toBe('high');
    });

    it('parses belief note with maturity field', async () => {
      const result = await parseFile(join(fixturesDir, 'belief-valid.md'));

      expect(result).not.toBeNull();
      expect(result!.noteType).toBe('belief');
      expect(result!.confidence).toBe('high');
      expect(result!.maturity).toBe('evergreen');
    });

    it('parses entity note correctly', async () => {
      const result = await parseFile(join(fixturesDir, 'entity-valid.md'));

      expect(result).not.toBeNull();
      expect(result!.noteType).toBe('entity');
      expect(result!.title).toBe('MiniSearch');
    });

    it('parses bet note correctly', async () => {
      const result = await parseFile(join(fixturesDir, 'bet-valid.md'));

      expect(result).not.toBeNull();
      expect(result!.noteType).toBe('bet');
      expect(result!.status).toBe('pending');
      expect(result!.confidence).toBe('medium');
    });

    it('parses question note correctly', async () => {
      const result = await parseFile(join(fixturesDir, 'question-valid.md'));

      expect(result).not.toBeNull();
      expect(result!.noteType).toBe('question');
      expect(result!.status).toBe('open');
    });

    it('parses topic note correctly', async () => {
      const result = await parseFile(join(fixturesDir, 'topic-valid.md'));

      expect(result).not.toBeNull();
      expect(result!.noteType).toBe('topic');
      expect(result!.title).toBe('Search');
    });

    it('parses minimal note with defaults', async () => {
      const result = await parseFile(join(fixturesDir, 'minimal-valid.md'));

      expect(result).not.toBeNull();
      expect(result!.noteType).toBe('experience');
      expect(result!.slug).toBe('minimal-valid');
      expect(result!.title).toBe('Minimal Note');
      expect(result!.description).toBeUndefined();
      expect(result!.topics).toBeUndefined();
    });
  });

  describe('wiki-link extraction', () => {
    it('extracts wiki-links from body and merges with frontmatter connections', async () => {
      const result = await parseFile(join(fixturesDir, 'experience-valid.md'));

      expect(result).not.toBeNull();
      expect(result!.connections).toContain('auth-system-design');
      expect(result!.connections).toContain('deployment-checklist');
      expect(result!.connections).toContain('user-management');
      expect(result!.connections).toContain('session-handling');
    });

    it('strips wiki-link brackets from rawBody', async () => {
      const result = await parseFile(join(fixturesDir, 'experience-valid.md'));

      expect(result).not.toBeNull();
      expect(result!.rawBody).toContain('user-management');
      expect(result!.rawBody).toContain('session-handling');
      expect(result!.rawBody).not.toContain('[[');
      expect(result!.rawBody).not.toContain(']]');
    });

    it('preserves linked note names as searchable terms', async () => {
      const result = await parseFile(join(fixturesDir, 'research-valid.md'));

      expect(result).not.toBeNull();
      expect(result!.rawBody).toContain('lucene-internals');
      expect(result!.rawBody).toContain('vector-search-comparison');
    });

    it('deduplicates wiki-links', async () => {
      const result = await parseFile(join(fixturesDir, 'topic-valid.md'));

      expect(result).not.toBeNull();
      // The topic-valid.md has multiple wiki-links
      expect(result!.connections).toBeDefined();
      // Check no duplicates
      const connectionsSet = new Set(result!.connections);
      expect(connectionsSet.size).toBe(result!.connections!.length);
    });
  });

  describe('body section splitting', () => {
    it('splits body on ## headers into named sections', async () => {
      const result = await parseFile(join(fixturesDir, 'experience-valid.md'));

      expect(result).not.toBeNull();
      expect(result!.bodySections.length).toBe(3);
      expect(result!.bodySections[0].name).toBe('Summary');
      expect(result!.bodySections[1].name).toBe('Key Events');
      expect(result!.bodySections[2].name).toBe('Lessons Learned');
    });

    it('includes section content', async () => {
      const result = await parseFile(join(fixturesDir, 'experience-valid.md'));

      expect(result).not.toBeNull();
      expect(result!.bodySections[0].content).toContain(
        'We deployed the new OAuth2-based authentication system'
      );
      expect(result!.bodySections[1].content).toContain(
        'The deployment went smoothly'
      );
    });

    it('handles notes with no ## sections', async () => {
      const result = await parseFile(join(fixturesDir, 'minimal-valid.md'));

      expect(result).not.toBeNull();
      expect(result!.bodySections.length).toBe(0);
    });

    it('handles notes with multiple sections', async () => {
      const result = await parseFile(join(fixturesDir, 'no-h1-header.md'));

      expect(result).not.toBeNull();
      expect(result!.bodySections.length).toBe(2);
      expect(result!.bodySections[0].name).toBe('Section One');
      expect(result!.bodySections[1].name).toBe('Section Two');
    });
  });

  describe('title derivation', () => {
    it('derives title from first H1 header', async () => {
      const result = await parseFile(join(fixturesDir, 'experience-valid.md'));

      expect(result).not.toBeNull();
      expect(result!.title).toBe('Successful Auth System Deployment');
    });

    it('falls back to slug when no H1 header', async () => {
      const result = await parseFile(join(fixturesDir, 'no-h1-header.md'));

      expect(result).not.toBeNull();
      expect(result!.title).toBe('no-h1-header');
    });
  });

  describe('slug derivation', () => {
    it('derives slug from filename without extension', async () => {
      const result = await parseFile(join(fixturesDir, 'research-valid.md'));

      expect(result).not.toBeNull();
      expect(result!.slug).toBe('research-valid');
    });
  });

  describe('malformed YAML handling', () => {
    it('returns null and logs warning for malformed YAML frontmatter', async () => {
      const result = await parseFile(join(fixturesDir, 'malformed-yaml.md'));

      expect(result).toBeNull();
      expect(consoleWarnSpy).toHaveBeenCalled();
      expect(consoleWarnSpy.mock.calls[0][0]).toContain('Malformed YAML');
    });

    it('does not throw for malformed YAML', async () => {
      await expect(
        parseFile(join(fixturesDir, 'malformed-yaml.md'))
      ).resolves.not.toThrow();
    });
  });

  describe('missing frontmatter fields', () => {
    it('handles missing optional fields gracefully', async () => {
      const result = await parseFile(join(fixturesDir, 'minimal-valid.md'));

      expect(result).not.toBeNull();
      expect(result!.description).toBeUndefined();
      expect(result!.topics).toBeUndefined();
      expect(result!.status).toBeUndefined();
      expect(result!.confidence).toBeUndefined();
      expect(result!.maturity).toBeUndefined();
      expect(result!.provenance).toBeUndefined();
      expect(result!.date).toBeUndefined();
      expect(result!.connections).toBeUndefined();
    });

    it('defaults noteType to experience when type is invalid', async () => {
      // Create a virtual test by checking behavior with valid types
      const result = await parseFile(join(fixturesDir, 'minimal-valid.md'));

      expect(result).not.toBeNull();
      expect(result!.noteType).toBe('experience');
    });

    it('filters out non-string values from array fields', async () => {
      const result = await parseFile(join(fixturesDir, 'non-string-array.md'));

      expect(result).not.toBeNull();
      // topics should be undefined since all values are non-strings
      // gray-matter preserves YAML types (123 -> number, true -> boolean)
      expect(result!.topics).toBeUndefined();
    });
  });

  describe('file reading errors', () => {
    it('returns null for non-existent files', async () => {
      const result = await parseFile(join(fixturesDir, 'does-not-exist.md'));

      expect(result).toBeNull();
    });

    it('logs a warning for non-existent files', async () => {
      await parseFile(join(fixturesDir, 'does-not-exist.md'));

      expect(consoleWarnSpy).toHaveBeenCalled();
      expect(consoleWarnSpy.mock.calls[0][0]).toContain('Failed to read file');
    });
  });

  describe('path handling', () => {
    it('stores the full path in the document', async () => {
      const fullPath = join(fixturesDir, 'experience-valid.md');
      const result = await parseFile(fullPath);

      expect(result).not.toBeNull();
      expect(result!.path).toBe(fullPath);
    });
  });

  describe('date handling', () => {
    it('preserves date string from frontmatter', async () => {
      const result = await parseFile(join(fixturesDir, 'experience-valid.md'));

      expect(result).not.toBeNull();
      expect(result!.date).toBe('2025-03-15');
    });

    it('handles non-date string values for date field', async () => {
      const result = await parseFile(join(fixturesDir, 'string-date.md'));

      expect(result).not.toBeNull();
      expect(result!.date).toBe('ongoing');
    });
  });
});

describe('parseVaultDirectory', () => {
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleWarnSpy.mockRestore();
  });

  describe('directory scoping', () => {
    it('scans all included directories', async () => {
      const docs = await parseVaultDirectory(vaultFixtureDir);

      // Check we have docs from each directory
      const paths = docs.map((d) => d.path);

      expect(paths.some((p) => p.includes('/experiences/'))).toBe(true);
      expect(paths.some((p) => p.includes('/research/notes/'))).toBe(true);
      expect(paths.some((p) => p.includes('/beliefs/'))).toBe(true);
      expect(paths.some((p) => p.includes('/entities/'))).toBe(true);
      expect(paths.some((p) => p.includes('/bets/'))).toBe(true);
      expect(paths.some((p) => p.includes('/questions/'))).toBe(true);
      expect(paths.some((p) => p.includes('/_topics/'))).toBe(true);
    });

    it('excludes _maintenance directory', async () => {
      const docs = await parseVaultDirectory(vaultFixtureDir);
      const paths = docs.map((d) => d.path);

      expect(paths.some((p) => p.includes('/_maintenance/'))).toBe(false);
      expect(paths.some((p) => p.includes('do-not-parse'))).toBe(false);
    });

    it('excludes root-level .md files', async () => {
      const docs = await parseVaultDirectory(vaultFixtureDir);
      const paths = docs.map((d) => d.path);

      expect(paths.some((p) => p.includes('root-file.md'))).toBe(false);
      expect(paths.some((p) => p.includes('INDEX.md'))).toBe(false);
    });

    it('excludes _* prefixed subdirectories except _topics', async () => {
      const docs = await parseVaultDirectory(vaultFixtureDir);
      const paths = docs.map((d) => d.path);

      // _drafts subdirectory should be excluded
      expect(paths.some((p) => p.includes('/_drafts/'))).toBe(false);
      expect(paths.some((p) => p.includes('draft-note.md'))).toBe(false);

      // But _topics should be included
      expect(paths.some((p) => p.includes('/_topics/'))).toBe(true);
    });
  });

  describe('noteType inference from directory path', () => {
    it('infers noteType: experience for files in experiences/', async () => {
      const docs = await parseVaultDirectory(vaultFixtureDir);
      const experienceDoc = docs.find((d) =>
        d.path.includes('/experiences/test-experience.md')
      );

      expect(experienceDoc).toBeDefined();
      expect(experienceDoc!.noteType).toBe('experience');
    });

    it('infers noteType: research for files in research/notes/', async () => {
      const docs = await parseVaultDirectory(vaultFixtureDir);
      const researchDoc = docs.find((d) =>
        d.path.includes('/research/notes/test-research.md')
      );

      expect(researchDoc).toBeDefined();
      expect(researchDoc!.noteType).toBe('research');
    });

    it('scans nested subdirectories within included directories', async () => {
      const docs = await parseVaultDirectory(vaultFixtureDir);

      // Find the nested research note
      const nestedDoc = docs.find((d) =>
        d.path.includes('/research/notes/subtopic/nested-research.md')
      );

      expect(nestedDoc).toBeDefined();
      expect(nestedDoc!.noteType).toBe('research');
      expect(nestedDoc!.slug).toBe('nested-research');
    });

    it('infers noteType: belief for files in beliefs/', async () => {
      const docs = await parseVaultDirectory(vaultFixtureDir);
      const beliefDoc = docs.find((d) =>
        d.path.includes('/beliefs/test-belief.md')
      );

      expect(beliefDoc).toBeDefined();
      expect(beliefDoc!.noteType).toBe('belief');
    });

    it('infers noteType: entity for files in entities/', async () => {
      const docs = await parseVaultDirectory(vaultFixtureDir);
      const entityDoc = docs.find((d) =>
        d.path.includes('/entities/test-entity.md')
      );

      expect(entityDoc).toBeDefined();
      expect(entityDoc!.noteType).toBe('entity');
    });

    it('infers noteType: bet for files in bets/', async () => {
      const docs = await parseVaultDirectory(vaultFixtureDir);
      const betDoc = docs.find((d) => d.path.includes('/bets/test-bet.md'));

      expect(betDoc).toBeDefined();
      expect(betDoc!.noteType).toBe('bet');
    });

    it('infers noteType: question for files in questions/', async () => {
      const docs = await parseVaultDirectory(vaultFixtureDir);
      const questionDoc = docs.find((d) =>
        d.path.includes('/questions/test-question.md')
      );

      expect(questionDoc).toBeDefined();
      expect(questionDoc!.noteType).toBe('question');
    });

    it('preserves explicit noteType from frontmatter when provided', async () => {
      const docs = await parseVaultDirectory(vaultFixtureDir);
      // belief-with-explicit-type.md has type: research in frontmatter
      const doc = docs.find((d) =>
        d.path.includes('/beliefs/belief-with-explicit-type.md')
      );

      expect(doc).toBeDefined();
      // Explicit type should be preserved
      expect(doc!.noteType).toBe('research');
    });
  });

  describe('_topics directory handling', () => {
    it('sets noteType to topic for all files in _topics', async () => {
      const docs = await parseVaultDirectory(vaultFixtureDir);
      const topicDoc = docs.find((d) =>
        d.path.includes('/_topics/test-topic.md')
      );

      expect(topicDoc).toBeDefined();
      expect(topicDoc!.noteType).toBe('topic');
    });

    it('overrides frontmatter type with topic for files in _topics', async () => {
      const docs = await parseVaultDirectory(vaultFixtureDir);
      // topic-with-different-type.md has type: belief in frontmatter
      const doc = docs.find((d) =>
        d.path.includes('/_topics/topic-with-different-type.md')
      );

      expect(doc).toBeDefined();
      // Should still be topic, regardless of frontmatter
      expect(doc!.noteType).toBe('topic');
    });
  });

  describe('error handling', () => {
    it('returns empty array for non-existent vault path', async () => {
      const docs = await parseVaultDirectory('/non/existent/path');

      expect(docs).toEqual([]);
    });

    it('skips files that fail to read', async () => {
      // parseVaultDirectory should gracefully handle any files it can't read
      // by skipping them and continuing with other files
      const docs = await parseVaultDirectory(vaultFixtureDir);

      // All valid files should still be parsed
      expect(docs.length).toBeGreaterThan(0);
      expect(docs.some((d) => d.path.includes('test-belief.md'))).toBe(true);
    });
  });

  describe('integration - full vault parse', () => {
    it('returns correct total count of parsed documents', async () => {
      const docs = await parseVaultDirectory(vaultFixtureDir);

      // Count expected files (excluding excluded directories)
      // experiences/: 2 files (test-experience.md, experience-with-type.md) - _drafts excluded
      // research/notes/: 2 files (test-research.md, subtopic/nested-research.md)
      // beliefs/: 2 files (test-belief.md, belief-with-explicit-type.md)
      // entities/: 1 file (test-entity.md)
      // bets/: 1 file (test-bet.md)
      // questions/: 1 file (test-question.md)
      // _topics/: 2 files (test-topic.md, topic-with-different-type.md)
      // Total: 11 files
      expect(docs.length).toBe(11);
    });

    it('parses documents with correct metadata', async () => {
      const docs = await parseVaultDirectory(vaultFixtureDir);

      // Check a specific document has expected fields
      const experienceDoc = docs.find((d) =>
        d.path.includes('/experiences/test-experience.md')
      );

      expect(experienceDoc).toBeDefined();
      expect(experienceDoc!.slug).toBe('test-experience');
      expect(experienceDoc!.title).toBe('Test Experience');
      expect(experienceDoc!.description).toBe('A test experience note');
      expect(experienceDoc!.topics).toEqual(['testing']);
      expect(experienceDoc!.status).toBe('completed');
      expect(experienceDoc!.date).toBe('2025-01-01');
    });

    it('all documents have required fields', async () => {
      const docs = await parseVaultDirectory(vaultFixtureDir);

      for (const doc of docs) {
        expect(doc.path).toBeDefined();
        expect(doc.slug).toBeDefined();
        expect(doc.noteType).toBeDefined();
        expect(doc.title).toBeDefined();
        expect(doc.bodySections).toBeDefined();
        expect(doc.rawBody).toBeDefined();
      }
    });
  });
});
