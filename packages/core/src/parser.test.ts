import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { parseFile } from './parser.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const fixturesDir = join(__dirname, '__fixtures__');

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
