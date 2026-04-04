import { describe, it, expect } from 'vitest';
import type { NoteType, BodySection, VaultDocument } from './types.js';

describe('types', () => {
  describe('NoteType', () => {
    it('accepts all valid note types', () => {
      const validTypes: NoteType[] = [
        'experience',
        'research',
        'belief',
        'entity',
        'bet',
        'question',
        'topic',
      ];

      expect(validTypes).toHaveLength(7);
      validTypes.forEach((noteType) => {
        // Type assertion - this would fail to compile if noteType wasn't valid
        const _assigned: NoteType = noteType;
        expect(typeof _assigned).toBe('string');
      });
    });

    it('rejects invalid note types at compile time', () => {
      // @ts-expect-error - 'invalid' is not a valid NoteType
      const _invalid: NoteType = 'invalid';

      // @ts-expect-error - numbers are not valid NoteTypes
      const _number: NoteType = 123;

      // Test passes if compilation succeeds with the @ts-expect-error comments
      expect(true).toBe(true);
    });
  });

  describe('BodySection', () => {
    it('accepts valid body sections', () => {
      const section: BodySection = {
        name: 'Summary',
        content: 'This is the summary content.',
      };

      expect(section.name).toBe('Summary');
      expect(section.content).toBe('This is the summary content.');
    });

    it('requires both name and content fields', () => {
      // @ts-expect-error - missing 'content' field
      const _missingContent: BodySection = { name: 'Summary' };

      // @ts-expect-error - missing 'name' field
      const _missingName: BodySection = { content: 'Content' };

      expect(true).toBe(true);
    });
  });

  describe('VaultDocument', () => {
    it('accepts a minimal valid document with required fields only', () => {
      const doc: VaultDocument = {
        path: '/vault/beliefs/memory-systems.md',
        slug: 'beliefs-memory-systems',
        noteType: 'belief',
        title: 'Memory Systems',
        bodySections: [],
        rawBody: '',
      };

      expect(doc.path).toBe('/vault/beliefs/memory-systems.md');
      expect(doc.slug).toBe('beliefs-memory-systems');
      expect(doc.noteType).toBe('belief');
      expect(doc.title).toBe('Memory Systems');
      expect(doc.bodySections).toEqual([]);
      expect(doc.rawBody).toBe('');
    });

    it('accepts a fully populated document with all optional fields', () => {
      const doc: VaultDocument = {
        path: '/vault/beliefs/memory-systems.md',
        slug: 'beliefs-memory-systems',
        noteType: 'belief',
        title: 'Memory Systems',
        description: 'Our understanding of how memory systems work.',
        topics: ['memory', 'architecture', 'ai'],
        status: 'active',
        confidence: 'high',
        maturity: 'evergreen',
        provenance: 'internal-research',
        date: '2026-01-15',
        updatedAt: '2026-04-01',
        connections: ['retrieval-patterns', 'vector-search', 'bm25'],
        bodySections: [
          { name: 'Summary', content: 'Memory systems are...' },
          { name: 'Key Claims', content: '1. BM25 is effective...' },
        ],
        rawBody: '## Summary\n\nMemory systems are...',
      };

      expect(doc.description).toBe('Our understanding of how memory systems work.');
      expect(doc.topics).toEqual(['memory', 'architecture', 'ai']);
      expect(doc.status).toBe('active');
      expect(doc.confidence).toBe('high');
      expect(doc.maturity).toBe('evergreen');
      expect(doc.provenance).toBe('internal-research');
      expect(doc.date).toBe('2026-01-15');
      expect(doc.updatedAt).toBe('2026-04-01');
      expect(doc.connections).toEqual(['retrieval-patterns', 'vector-search', 'bm25']);
      expect(doc.bodySections).toHaveLength(2);
    });

    it('requires path, slug, noteType, title, bodySections, and rawBody', () => {
      // @ts-expect-error - missing required fields
      const _missingPath: VaultDocument = {
        slug: 'test',
        noteType: 'belief',
        title: 'Test',
        bodySections: [],
        rawBody: '',
      };

      // @ts-expect-error - missing required fields
      const _missingSlug: VaultDocument = {
        path: '/test.md',
        noteType: 'belief',
        title: 'Test',
        bodySections: [],
        rawBody: '',
      };

      // @ts-expect-error - missing required fields
      const _missingNoteType: VaultDocument = {
        path: '/test.md',
        slug: 'test',
        title: 'Test',
        bodySections: [],
        rawBody: '',
      };

      // @ts-expect-error - missing required fields
      const _missingTitle: VaultDocument = {
        path: '/test.md',
        slug: 'test',
        noteType: 'belief',
        bodySections: [],
        rawBody: '',
      };

      // @ts-expect-error - missing required fields
      const _missingBodySections: VaultDocument = {
        path: '/test.md',
        slug: 'test',
        noteType: 'belief',
        title: 'Test',
        rawBody: '',
      };

      // @ts-expect-error - missing required fields
      const _missingRawBody: VaultDocument = {
        path: '/test.md',
        slug: 'test',
        noteType: 'belief',
        title: 'Test',
        bodySections: [],
      };

      expect(true).toBe(true);
    });

    it('enforces NoteType constraint on noteType field', () => {
      // @ts-expect-error - 'invalid' is not a valid NoteType
      const _invalidType: VaultDocument = {
        path: '/test.md',
        slug: 'test',
        noteType: 'invalid',
        title: 'Test',
        bodySections: [],
        rawBody: '',
      };

      expect(true).toBe(true);
    });

    it('enforces BodySection type in bodySections array', () => {
      // @ts-expect-error - bodySections must contain BodySection objects
      const _invalidSections: VaultDocument = {
        path: '/test.md',
        slug: 'test',
        noteType: 'belief',
        title: 'Test',
        bodySections: [{ invalid: 'structure' }],
        rawBody: '',
      };

      expect(true).toBe(true);
    });

    it('allows each note type in the noteType field', () => {
      const noteTypes: NoteType[] = [
        'experience',
        'research',
        'belief',
        'entity',
        'bet',
        'question',
        'topic',
      ];

      noteTypes.forEach((noteType) => {
        const doc: VaultDocument = {
          path: `/vault/${noteType}s/test.md`,
          slug: `${noteType}s-test`,
          noteType,
          title: `Test ${noteType}`,
          bodySections: [],
          rawBody: '',
        };

        expect(doc.noteType).toBe(noteType);
      });
    });
  });
});
