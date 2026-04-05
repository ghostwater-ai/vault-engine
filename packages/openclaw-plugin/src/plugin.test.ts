import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import type { QueryResult, ScoredDocument } from '@ghostwater/vault-engine';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const definePluginEntryMock = vi.fn(<T>(entry: T) => entry);
const rebuildIndexMock = vi.fn();
const queryMock = vi.fn();

vi.mock('openclaw/plugin-sdk/plugin-entry', () => ({
  definePluginEntry: definePluginEntryMock,
}), { virtual: true });

vi.mock('@ghostwater/vault-engine', () => ({
  rebuildIndex: rebuildIndexMock,
  query: queryMock,
}));

function createQueryResult(overrides?: Partial<QueryResult>): QueryResult {
  const scored: ScoredDocument = {
    doc: {
      path: '/tmp/test.md',
      slug: 'test',
      noteType: 'belief',
      title: 'Test Result',
      description: 'A matched vault note.',
      status: 'proven',
      bodySections: [],
      rawBody: '',
    },
    score: 0.9,
    bm25Raw: 1,
    bm25Normalized: 0.5,
    typeBoost: 0.1,
    confidenceModifier: 0.1,
    matchedFields: ['title'],
    explanation: 'test',
  };

  return {
    results: [scored],
    tier: 0,
    latencyMs: 1,
    query: 'q',
    ...overrides,
  };
}

function createMockIndex(documentCount = 1): { getStats: () => { documentCount: number } } {
  return {
    getStats: () => ({ documentCount }),
  };
}

describe('openclaw plugin runtime', () => {
  beforeEach(async () => {
    vi.resetAllMocks();
    definePluginEntryMock.mockImplementation(<T>(entry: T) => entry);
    const mod = await import('./plugin.js');
    mod.__testing.resetState();
  });

  it('registers only before_prompt_build hook and no slot kind', async () => {
    const mod = await import('./plugin.js');

    expect(definePluginEntryMock).toHaveBeenCalledTimes(1);
    expect(mod.plugin).not.toHaveProperty('kind');
    expect(mod.plugin).toHaveProperty('hooks.before_prompt_build');
    expect(Object.keys((mod.plugin as { hooks: Record<string, unknown> }).hooks)).toEqual([
      'before_prompt_build',
    ]);
  });

  it('initializes once, skips while initializing, then reuses singleton', async () => {
    const mod = await import('./plugin.js');
    const hook = (mod.plugin as { hooks: { before_prompt_build: (args: unknown) => Promise<unknown> } }).hooks
      .before_prompt_build;

    let resolveInit: ((value: unknown) => void) | undefined;
    rebuildIndexMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveInit = resolve;
        })
    );
    queryMock.mockReturnValue(createQueryResult());

    const config = { vaultPath: '/tmp' };
    const messages = [{ role: 'user', content: 'where are my notes?' }];

    await expect(hook({ config, messages })).resolves.toBeUndefined();
    await expect(hook({ config, messages })).resolves.toBeUndefined();
    await vi.waitFor(() => expect(rebuildIndexMock).toHaveBeenCalledTimes(1));

    resolveInit?.(createMockIndex());
    await vi.waitFor(() => expect(mod.__testing.getState()).toBe('ready'));

    const result = await hook({ config, messages });
    expect(result).toEqual({
      appendSystemContext: expect.stringContaining('## Vault Context'),
    });
    expect(result).not.toHaveProperty('systemPrompt');
    expect(result).not.toHaveProperty('prependContext');
    expect(queryMock).toHaveBeenCalledTimes(1);
  });

  it('disables gracefully for missing or invalid vaultPath', async () => {
    const mod = await import('./plugin.js');
    const hook = (mod.plugin as { hooks: { before_prompt_build: (args: unknown) => Promise<unknown> } }).hooks
      .before_prompt_build;
    const logger = { warn: vi.fn() };

    await expect(hook({ config: {}, logger })).resolves.toBeUndefined();
    await expect(hook({ config: { vaultPath: 123 }, logger })).resolves.toBeUndefined();

    expect(rebuildIndexMock).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it('returns no injection for empty vault and logs once', async () => {
    rebuildIndexMock.mockResolvedValue(createMockIndex(0));
    queryMock.mockReturnValue(createQueryResult({ results: [] }));

    const mod = await import('./plugin.js');
    const hook = (mod.plugin as { hooks: { before_prompt_build: (args: unknown) => Promise<unknown> } }).hooks
      .before_prompt_build;

    const logger = { warn: vi.fn() };
    const emptyVaultPath = await mkdtemp(join(tmpdir(), 'vault-empty-'));
    try {
      await expect(
        hook({
          config: { vaultPath: emptyVaultPath },
          messages: [{ role: 'user', content: 'test query' }],
          logger,
        })
      ).resolves.toBeUndefined();

      await vi.waitFor(() => expect(mod.__testing.getState()).toBe('ready'));
      expect(logger.warn).toHaveBeenCalledTimes(1);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('no markdown notes were indexed')
      );

      await expect(
        hook({
          config: { vaultPath: emptyVaultPath },
          messages: [{ role: 'user', content: 'test query' }],
          logger,
        })
      ).resolves.toBeUndefined();
      expect(logger.warn).toHaveBeenCalledTimes(1);
    } finally {
      await rm(emptyVaultPath, { recursive: true, force: true });
    }
  });

  it('uses latest user message as query and last 3 user messages as context', async () => {
    rebuildIndexMock.mockResolvedValue(createMockIndex());
    queryMock.mockReturnValue(createQueryResult());

    const mod = await import('./plugin.js');
    const hook = (mod.plugin as { hooks: { before_prompt_build: (args: unknown) => Promise<unknown> } }).hooks
      .before_prompt_build;

    const config = { vaultPath: '/tmp' };
    const messages = [
      { role: 'user', content: 'first user' },
      { role: 'assistant', content: 'assistant response' },
      { role: 'user', content: 'second user' },
      { role: 'user', content: 'third user' },
      { role: 'user', content: 'fourth user' },
    ];

    await hook({ config, messages });
    await vi.waitFor(() => expect(mod.__testing.getState()).toBe('ready'));
    await hook({ config, messages });

    expect(queryMock).toHaveBeenCalledTimes(1);
    expect(queryMock).toHaveBeenCalledWith(
      expect.anything(),
      'fourth user',
      expect.objectContaining({
        maxResults: 3,
        context: 'second user\n\nthird user\n\nfourth user',
      })
    );
  });

  it('forwards minScore and minBm25Score to query options', async () => {
    rebuildIndexMock.mockResolvedValue(createMockIndex());
    queryMock.mockReturnValue(createQueryResult());

    const mod = await import('./plugin.js');
    const hook = (mod.plugin as { hooks: { before_prompt_build: (args: unknown) => Promise<unknown> } }).hooks
      .before_prompt_build;

    const config = {
      vaultPath: '/tmp',
      injection: {
        minScore: 0.77,
        minBm25Score: 0.22,
      },
    };
    const messages = [{ role: 'user', content: 'score filters' }];

    await hook({ config, messages });
    await vi.waitFor(() => expect(mod.__testing.getState()).toBe('ready'));
    await hook({ config, messages });

    expect(queryMock).toHaveBeenCalledWith(
      expect.anything(),
      'score filters',
      expect.objectContaining({
        minScore: 0.77,
        minBm25Score: 0.22,
      })
    );
  });

  it('reads config from plugins.entries.vault-engine.config', async () => {
    rebuildIndexMock.mockResolvedValue(createMockIndex());
    queryMock.mockReturnValue(createQueryResult());

    const mod = await import('./plugin.js');
    const hook = (mod.plugin as { hooks: { before_prompt_build: (args: unknown) => Promise<unknown> } }).hooks
      .before_prompt_build;

    const config = {
      plugins: {
        entries: {
          'vault-engine': {
            config: {
              vaultPath: '/tmp',
            },
          },
        },
      },
    };
    const messages = [{ role: 'user', content: 'nested config' }];

    await hook({ config, messages });
    await vi.waitFor(() => expect(mod.__testing.getState()).toBe('ready'));
    await hook({ config, messages });

    expect(rebuildIndexMock).toHaveBeenCalledWith('/tmp');
  });
});
