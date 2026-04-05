import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { join } from 'node:path';
import { mkdir, writeFile, rm, unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { VaultWatcher } from './watcher.js';
import { VaultIndex } from './indexer.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Use a temp directory for watcher tests
const tempDir = join(__dirname, '__fixtures__', '.watcher-test-temp');

/**
 * Helper to create a test vault structure.
 */
async function createTestVault(): Promise<void> {
  // Create the scoped directories
  await mkdir(join(tempDir, 'experiences'), { recursive: true });
  await mkdir(join(tempDir, 'research', 'notes'), { recursive: true });
  await mkdir(join(tempDir, 'beliefs'), { recursive: true });
  await mkdir(join(tempDir, 'entities'), { recursive: true });
  await mkdir(join(tempDir, 'bets'), { recursive: true });
  await mkdir(join(tempDir, 'questions'), { recursive: true });
  await mkdir(join(tempDir, '_topics'), { recursive: true });
}

/**
 * Helper to clean up the test vault.
 */
async function cleanupTestVault(): Promise<void> {
  try {
    await rm(tempDir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
}

/**
 * Creates a valid markdown file with frontmatter.
 */
function createMarkdownContent(title: string, body: string): string {
  return `---
type: experience
---

# ${title}

${body}
`;
}

/**
 * Wait for a specified number of milliseconds.
 */
function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('VaultWatcher', () => {
  let index: VaultIndex;
  let watcher: VaultWatcher;

  beforeEach(async () => {
    await cleanupTestVault();
    await createTestVault();
    index = new VaultIndex();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    if (watcher) {
      await watcher.stop();
    }
    await cleanupTestVault();
  });

  describe('constructor', () => {
    it('accepts vaultPath and VaultIndex instance', () => {
      watcher = new VaultWatcher(tempDir, index);
      expect(watcher).toBeInstanceOf(VaultWatcher);
    });
  });

  describe('start and stop', () => {
    it('start() does not force polling in default chokidar options', async () => {
      vi.resetModules();
      const onMock = vi.fn();
      const closeMock = vi.fn().mockResolvedValue(undefined);
      const fakeWatcher = { on: onMock, close: closeMock } as any;
      onMock.mockImplementation((event: string, cb: () => void) => {
        if (event === 'ready') {
          cb();
        }
        return fakeWatcher;
      });
      const watchMock = vi.fn(() => fakeWatcher);

      vi.doMock('chokidar', () => ({ watch: watchMock }));
      const { VaultWatcher: MockedVaultWatcher } = await import('./watcher.js');

      const isolatedWatcher = new MockedVaultWatcher(tempDir, index);
      await isolatedWatcher.start();

      const options = watchMock.mock.calls[0]?.[1];
      expect(options?.usePolling).not.toBe(true);
      await isolatedWatcher.stop();

      vi.doUnmock('chokidar');
      vi.resetModules();
    });

    it('start() begins watching without errors', async () => {
      watcher = new VaultWatcher(tempDir, index);
      await expect(watcher.start()).resolves.not.toThrow();
    });

    it('stop() stops watching and cleans up', async () => {
      watcher = new VaultWatcher(tempDir, index);
      await watcher.start();
      await expect(watcher.stop()).resolves.not.toThrow();
    });

    it('start() is idempotent - multiple calls do not create multiple watchers', async () => {
      watcher = new VaultWatcher(tempDir, index);
      await watcher.start();
      await watcher.start(); // Second call should be no-op
      await expect(watcher.start()).resolves.not.toThrow();
    });

    it('stop() can be called multiple times safely', async () => {
      watcher = new VaultWatcher(tempDir, index);
      await watcher.start();
      await watcher.stop();
      await expect(watcher.stop()).resolves.not.toThrow();
    });
  });

  describe('file addition detection', () => {
    it('detects new .md file additions and adds to index', async () => {
      watcher = new VaultWatcher(tempDir, index);
      await watcher.start();

      // Create a new markdown file
      const filePath = join(tempDir, 'experiences', 'new-note.md');
      await writeFile(filePath, createMarkdownContent('New Note', 'Test body'));

      // Wait for debounce (2s) + processing time + polling interval
      await wait(3000);

      // Verify document was added to index
      const doc = index.getDocument(filePath);
      expect(doc).toBeDefined();
      expect(doc?.title).toBe('New Note');
    });
  });

  describe('file modification detection', () => {
    it('detects file modifications and updates index', async () => {
      // First add a file to the index manually
      const filePath = join(tempDir, 'experiences', 'modify-test.md');
      await writeFile(
        filePath,
        createMarkdownContent('Original Title', 'Original body')
      );

      // Build index with initial content
      await index.buildIndex(tempDir);
      expect(index.getDocument(filePath)?.title).toBe('Original Title');

      // Start watcher
      watcher = new VaultWatcher(tempDir, index);
      await watcher.start();

      // Modify the file
      await writeFile(
        filePath,
        createMarkdownContent('Modified Title', 'Modified body')
      );

      // Wait for debounce + processing + polling
      await wait(3000);

      // Verify document was updated
      const doc = index.getDocument(filePath);
      expect(doc).toBeDefined();
      expect(doc?.title).toBe('Modified Title');
    });
  });

  describe('file deletion detection', () => {
    it('detects file deletions and removes from index', async () => {
      // First create and index a file
      const filePath = join(tempDir, 'experiences', 'delete-test.md');
      await writeFile(
        filePath,
        createMarkdownContent('Delete Test', 'Will be deleted')
      );

      // Build index
      await index.buildIndex(tempDir);
      expect(index.getDocument(filePath)).toBeDefined();

      // Start watcher
      watcher = new VaultWatcher(tempDir, index);
      await watcher.start();

      // Delete the file
      await unlink(filePath);

      // Wait for debounce + processing + polling
      await wait(3000);

      // Verify document was removed
      expect(index.getDocument(filePath)).toBeUndefined();
    });
  });

  describe('debounce behavior', () => {
    it('batches rapid changes within 2s window into single update', async () => {
      watcher = new VaultWatcher(tempDir, index);
      await watcher.start();

      // Spy on addDocument
      const addSpy = vi.spyOn(index, 'addDocument');

      // Create multiple files rapidly
      const file1 = join(tempDir, 'experiences', 'rapid-1.md');
      const file2 = join(tempDir, 'experiences', 'rapid-2.md');
      const file3 = join(tempDir, 'experiences', 'rapid-3.md');

      await writeFile(file1, createMarkdownContent('Rapid 1', 'Body 1'));
      await wait(100);
      await writeFile(file2, createMarkdownContent('Rapid 2', 'Body 2'));
      await wait(100);
      await writeFile(file3, createMarkdownContent('Rapid 3', 'Body 3'));

      // At this point, no processing should have happened yet (within debounce)
      // Note: with polling we need to wait a bit for events to be detected
      await wait(500);
      expect(addSpy).not.toHaveBeenCalled();

      // Wait for debounce to complete (2s) + processing
      await wait(3000);

      // All three documents should now be in the index
      expect(index.getDocument(file1)).toBeDefined();
      expect(index.getDocument(file2)).toBeDefined();
      expect(index.getDocument(file3)).toBeDefined();
    });

    it('resets debounce timer on each new change', async () => {
      watcher = new VaultWatcher(tempDir, index);
      await watcher.start();

      const file1 = join(tempDir, 'experiences', 'reset-timer-1.md');
      const file2 = join(tempDir, 'experiences', 'reset-timer-2.md');

      // Create first file
      await writeFile(file1, createMarkdownContent('Timer 1', 'Body'));

      // Wait 1.5s (within debounce window)
      await wait(1500);

      // First file should not be processed yet
      expect(index.getDocument(file1)).toBeUndefined();

      // Create second file, resetting the timer
      await writeFile(file2, createMarkdownContent('Timer 2', 'Body'));

      // Wait another 1s (still within debounce from second file)
      await wait(1000);

      // Still waiting for debounce - files should not be processed yet
      expect(index.getDocument(file1)).toBeUndefined();
      expect(index.getDocument(file2)).toBeUndefined();

      // Wait for full debounce from second file to complete
      await wait(2000);

      // Now both should be in index
      expect(index.getDocument(file1)).toBeDefined();
      expect(index.getDocument(file2)).toBeDefined();
    });
  });

  describe('file type filtering', () => {
    it('ignores non-.md files', async () => {
      watcher = new VaultWatcher(tempDir, index);
      await watcher.start();

      // Create various non-md files
      await writeFile(join(tempDir, 'experiences', 'test.txt'), 'text file');
      await writeFile(join(tempDir, 'experiences', 'test.json'), '{}');
      await writeFile(join(tempDir, 'experiences', 'test.js'), 'code');

      // Wait for debounce + processing
      await wait(3000);

      // No documents should be added
      expect(index.getStats().documentCount).toBe(0);
    });

    it('processes only .md files', async () => {
      watcher = new VaultWatcher(tempDir, index);
      await watcher.start();

      // Create a mix of files
      await writeFile(
        join(tempDir, 'experiences', 'valid.md'),
        createMarkdownContent('Valid', 'Body')
      );
      await writeFile(join(tempDir, 'experiences', 'invalid.txt'), 'text');

      // Wait for debounce + processing
      await wait(3000);

      // Only the .md file should be indexed
      expect(index.getStats().documentCount).toBe(1);
      expect(
        index.getDocument(join(tempDir, 'experiences', 'valid.md'))
      ).toBeDefined();
    });
  });

  describe('scoped directory watching', () => {
    it('watches experiences directory', async () => {
      watcher = new VaultWatcher(tempDir, index);
      await watcher.start();

      const filePath = join(tempDir, 'experiences', 'exp.md');
      await writeFile(filePath, createMarkdownContent('Experience', 'Body'));

      await wait(3000);
      expect(index.getDocument(filePath)).toBeDefined();
    });

    it('watches research/notes directory', async () => {
      watcher = new VaultWatcher(tempDir, index);
      await watcher.start();

      const filePath = join(tempDir, 'research', 'notes', 'research.md');
      await writeFile(filePath, createMarkdownContent('Research', 'Body'));

      await wait(3000);
      expect(index.getDocument(filePath)).toBeDefined();
    });

    it('watches beliefs directory', async () => {
      watcher = new VaultWatcher(tempDir, index);
      await watcher.start();

      const filePath = join(tempDir, 'beliefs', 'belief.md');
      await writeFile(filePath, createMarkdownContent('Belief', 'Body'));

      await wait(3000);
      expect(index.getDocument(filePath)).toBeDefined();
    });

    it('watches entities directory', async () => {
      watcher = new VaultWatcher(tempDir, index);
      await watcher.start();

      const filePath = join(tempDir, 'entities', 'entity.md');
      await writeFile(filePath, createMarkdownContent('Entity', 'Body'));

      await wait(3000);
      expect(index.getDocument(filePath)).toBeDefined();
    });

    it('watches bets directory', async () => {
      watcher = new VaultWatcher(tempDir, index);
      await watcher.start();

      const filePath = join(tempDir, 'bets', 'bet.md');
      await writeFile(filePath, createMarkdownContent('Bet', 'Body'));

      await wait(3000);
      expect(index.getDocument(filePath)).toBeDefined();
    });

    it('watches questions directory', async () => {
      watcher = new VaultWatcher(tempDir, index);
      await watcher.start();

      const filePath = join(tempDir, 'questions', 'question.md');
      await writeFile(filePath, createMarkdownContent('Question', 'Body'));

      await wait(3000);
      expect(index.getDocument(filePath)).toBeDefined();
    });

    it('watches _topics directory', async () => {
      watcher = new VaultWatcher(tempDir, index);
      await watcher.start();

      const filePath = join(tempDir, '_topics', 'topic.md');
      await writeFile(filePath, createMarkdownContent('Topic', 'Body'));

      await wait(3000);
      expect(index.getDocument(filePath)).toBeDefined();
    });
  });

  describe('error handling', () => {
    it('continues processing remaining queued changes when one change throws', async () => {
      watcher = new VaultWatcher(tempDir, index);
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const failingPath = join(tempDir, 'experiences', 'failing.md');
      const successPath = join(tempDir, 'experiences', 'success.md');

      const processChangeSpy = vi
        .spyOn(watcher as any, 'processChange')
        .mockImplementation(async (change: { path: string }) => {
          if (change.path === failingPath) {
            throw new Error('simulated change failure');
          }

          index.addDocument({
            path: successPath,
            slug: 'success',
            noteType: 'experience',
            title: 'Success',
            bodySections: [],
            rawBody: 'success body',
          });
        });

      (watcher as any).pendingChanges.set(failingPath, {
        type: 'add',
        path: failingPath,
      });
      (watcher as any).pendingChanges.set(successPath, {
        type: 'add',
        path: successPath,
      });

      await (watcher as any).processPendingChanges();

      expect(processChangeSpy).toHaveBeenCalledTimes(2);
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0]?.[0]).toContain(failingPath);
      expect(index.getDocument(successPath)?.title).toBe('Success');
    });

    it('warns on unexpected add-path indexing errors', async () => {
      watcher = new VaultWatcher(tempDir, index);
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const filePath = join(tempDir, 'experiences', 'warn-on-add-error.md');
      await writeFile(filePath, createMarkdownContent('Warn', 'Body'));

      vi.spyOn(index, 'addDocument').mockImplementation(() => {
        throw new Error('unexpected add failure');
      });

      await (watcher as any).processChange({ type: 'add', path: filePath });

      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0]?.[0]).toContain(filePath);
    });

    it('tolerates duplicate-document add races without warning', async () => {
      watcher = new VaultWatcher(tempDir, index);
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const filePath = join(tempDir, 'experiences', 'duplicate-race.md');
      await writeFile(filePath, createMarkdownContent('Duplicate', 'Body'));

      await index.buildIndex(tempDir);
      expect(index.getDocument(filePath)).toBeDefined();

      await expect(
        (watcher as any).processChange({ type: 'add', path: filePath })
      ).resolves.not.toThrow();
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('warns on unexpected change-path addDocument errors', async () => {
      watcher = new VaultWatcher(tempDir, index);
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const filePath = join(tempDir, 'experiences', 'warn-on-change-add.md');
      await writeFile(filePath, createMarkdownContent('Warn', 'Body'));

      vi.spyOn(index, 'getDocument').mockReturnValue(undefined);
      vi.spyOn(index, 'addDocument').mockImplementation(() => {
        throw new Error('unexpected change add failure');
      });

      await (watcher as any).processChange({ type: 'change', path: filePath });

      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0]?.[0]).toContain(filePath);
    });

    it('tolerates duplicate-document races in change fallback add without warning', async () => {
      watcher = new VaultWatcher(tempDir, index);
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const filePath = join(
        tempDir,
        'experiences',
        'duplicate-race-change.md'
      );
      await writeFile(filePath, createMarkdownContent('Duplicate', 'Body'));

      vi.spyOn(index, 'getDocument').mockReturnValue(undefined);
      vi.spyOn(index, 'addDocument').mockImplementation(() => {
        throw new Error(`Document already exists: ${filePath}`);
      });

      await expect(
        (watcher as any).processChange({ type: 'change', path: filePath })
      ).resolves.not.toThrow();
      expect(warnSpy).not.toHaveBeenCalled();
    });
  });
});
