/**
 * VaultWatcher: File watcher for incremental index updates.
 *
 * Monitors the 7 scoped vault directories for file changes (add/modify/delete)
 * and updates the index incrementally. Uses chokidar for cross-platform file
 * watching with 2-second debounce after last detected change.
 */

import { watch, type FSWatcher } from 'chokidar';
import { join } from 'node:path';
import { parseFile } from './parser.js';
import type { VaultIndex } from './indexer.js';

/**
 * Directories to watch within a vault path.
 * These are the only directories where vault notes live.
 */
const WATCHED_DIRECTORIES = [
  'experiences',
  'research/notes',
  'beliefs',
  'entities',
  'bets',
  'questions',
  '_topics',
];

/**
 * Debounce delay in milliseconds.
 * Waits this long after the last change before processing the batch.
 */
const DEBOUNCE_MS = 2000;

/**
 * Types of file changes that can occur.
 */
type ChangeType = 'add' | 'change' | 'unlink';

/**
 * Represents a pending file change to be processed.
 */
interface PendingChange {
  type: ChangeType;
  path: string;
}

function isDuplicateDocumentError(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.startsWith('Document already exists:')
  );
}

/**
 * VaultWatcher monitors vault directories for file changes and updates the index.
 *
 * Features:
 * - Watches the 7 scoped directories (experiences, research/notes, beliefs, etc.)
 * - Only processes .md files, ignores other file types
 * - 2-second debounce: waits for 2s after last change before processing
 * - Batches multiple rapid changes into a single update operation
 * - Provides start() and stop() methods for lifecycle management
 */
export class VaultWatcher {
  private vaultPath: string;
  private index: VaultIndex;
  private watcher: FSWatcher | null = null;
  private pendingChanges: Map<string, PendingChange> = new Map();
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Creates a new VaultWatcher instance.
   *
   * @param vaultPath - Absolute path to the vault root directory
   * @param index - The VaultIndex instance to update on file changes
   */
  constructor(vaultPath: string, index: VaultIndex) {
    this.vaultPath = vaultPath;
    this.index = index;
  }

  /**
   * Starts watching the vault directories for file changes.
   * Only one watcher can be active at a time.
   * Returns a promise that resolves when the watcher is ready.
   */
  start(): Promise<void> {
    if (this.watcher) {
      return Promise.resolve(); // Already watching
    }

    // Build paths to watch
    const watchPaths = WATCHED_DIRECTORIES.map((dir) =>
      join(this.vaultPath, dir)
    );

    // Create chokidar watcher
    this.watcher = watch(watchPaths, {
      // Don't emit events for initial directory scan
      ignoreInitial: true,
      // Use polling for better cross-platform compatibility
      usePolling: true,
      interval: 100,
      // Follow symlinks
      followSymlinks: true,
      // Wait for write to finish
      awaitWriteFinish: {
        stabilityThreshold: 100,
        pollInterval: 50,
      },
    });

    // Register event handlers
    this.watcher.on('add', (path: string) => {
      if (path.endsWith('.md')) {
        this.queueChange('add', path);
      }
    });
    this.watcher.on('change', (path: string) => {
      if (path.endsWith('.md')) {
        this.queueChange('change', path);
      }
    });
    this.watcher.on('unlink', (path: string) => {
      if (path.endsWith('.md')) {
        this.queueChange('unlink', path);
      }
    });

    // Return a promise that resolves when the watcher is ready
    return new Promise<void>((resolve) => {
      this.watcher!.on('ready', () => {
        resolve();
      });
    });
  }

  /**
   * Stops watching and cleans up resources.
   */
  async stop(): Promise<void> {
    // Clear any pending debounce timer
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    // Clear pending changes
    this.pendingChanges.clear();

    // Close the watcher
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }
  }

  /**
   * Queues a file change for processing with debounce.
   * If the same file has multiple changes within the debounce window,
   * only the last change type is kept.
   */
  private queueChange(type: ChangeType, path: string): void {
    // Store the change (overwrites previous change for same path)
    this.pendingChanges.set(path, { type, path });

    // Reset the debounce timer
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(() => {
      this.processPendingChanges();
    }, DEBOUNCE_MS);
  }

  /**
   * Processes all pending changes in a single batch.
   * Each change is processed independently - if one fails, others continue.
   */
  private async processPendingChanges(): Promise<void> {
    // Get all pending changes and clear the queue
    const changes = Array.from(this.pendingChanges.values());
    this.pendingChanges.clear();
    this.debounceTimer = null;

    // Process each change independently - catch errors to ensure all changes are attempted
    for (const change of changes) {
      try {
        await this.processChange(change);
      } catch (error) {
        console.warn(
          `Failed to process watcher change batch item: ${change.path}`,
          error
        );
        // Continue processing remaining changes even if one fails
      }
    }
  }

  /**
   * Processes a single file change and updates the index.
   */
  private async processChange(change: PendingChange): Promise<void> {
    const { type, path } = change;

    switch (type) {
      case 'add': {
        // Parse the new file and add to index
        const doc = await parseFile(path);
        if (doc) {
          try {
            this.index.addDocument(doc);
          } catch (error) {
            if (!isDuplicateDocumentError(error)) {
              console.warn(
                `Failed to add document from watcher change: ${path}`,
                error
              );
            }
          }
        }
        break;
      }

      case 'change': {
        // Parse the new file first - only update index if parsing succeeds
        // This ensures we don't lose the old document on parse failure
        const doc = await parseFile(path);
        if (doc) {
          // Check if document exists in index
          const existingDoc = this.index.getDocument(path);
          if (existingDoc) {
            // Use updateDocument for atomic remove+add
            try {
              this.index.updateDocument(doc);
            } catch {
              // Handle edge cases
            }
          } else {
            // Document doesn't exist yet, add it
            try {
              this.index.addDocument(doc);
            } catch (error) {
              if (!isDuplicateDocumentError(error)) {
                console.warn(
                  `Failed to add document from watcher change: ${path}`,
                  error
                );
              }
            }
          }
        }
        // If parsing fails (doc is null), retain the original document in index
        break;
      }

      case 'unlink': {
        // Remove the document from the index
        try {
          this.index.removeDocument(path);
        } catch {
          // Document might not exist if it was never indexed
        }
        break;
      }
    }
  }
}
