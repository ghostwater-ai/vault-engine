import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import type { QueryResult, ScoredDocument } from '@ghostwater/vault-engine';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const definePluginEntryMock = vi.fn(<T>(entry: T) => entry);
const rebuildIndexMock = vi.fn();
const queryMock = vi.fn();

interface RegisteredTool {
  name: string;
  description: string;
  inputSchema: {
    required?: string[];
    properties?: Record<string, unknown>;
  };
  execute: (requestId: string, input: Record<string, unknown>, context?: Record<string, unknown>) => Promise<unknown>;
}

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

function createPluginConfig(overrides?: Record<string, unknown>): Record<string, unknown> {
  return {
    injection: {
      maxResults: 3,
      maxTokens: 1500,
      minScore: 0.3,
      minBm25Score: 0.1,
    },
    vaults: [
      {
        name: 'default',
        description: 'Default vault',
        vaultPath: '/tmp',
        mode: 'passive',
      },
    ],
    ...overrides,
  };
}

describe('openclaw plugin runtime', () => {
  beforeEach(async () => {
    vi.resetAllMocks();
    definePluginEntryMock.mockImplementation(<T>(entry: T) => entry);
    const mod = await import('./plugin.js');
    mod.__testing.resetState();
  });

  it('exposes register + before_prompt_build hook and no slot kind', async () => {
    const mod = await import('./plugin.js');

    expect(definePluginEntryMock).toHaveBeenCalledTimes(1);
    expect(mod.plugin).not.toHaveProperty('kind');
    expect(mod.plugin).toHaveProperty('register');
    expect(mod.plugin).toHaveProperty('hooks.before_prompt_build');
    expect(Object.keys((mod.plugin as { hooks: Record<string, unknown> }).hooks)).toEqual([
      'before_prompt_build',
    ]);
  });

  it('registers vault_query tool with expected description and input schema', async () => {
    const mod = await import('./plugin.js');
    const registerTool = vi.fn();

    (mod.plugin as { register: (api: { registerTool: (tool: RegisteredTool) => void }) => void }).register({
      registerTool,
    });

    expect(registerTool).toHaveBeenCalledTimes(1);
    const tool = registerTool.mock.calls[0]?.[0] as RegisteredTool;
    expect(tool.name).toBe('vault_query');
    expect(tool.description).toBe(
      "Search the knowledge vault for specific information. Use when passive vault context isn't sufficient or you need to explore a topic in depth."
    );
    expect(tool.inputSchema.required).toEqual(['query']);
    expect(tool.inputSchema.properties).toEqual(
      expect.objectContaining({
        query: expect.any(Object),
        maxResults: expect.any(Object),
        noteTypes: expect.any(Object),
        context: expect.any(Object),
        vault: expect.any(Object),
      })
    );
  });

  it('exposes config schema with vault entry requirements, mode enum, and legacy compatibility', async () => {
    const mod = await import('./plugin.js');
    const schema = (mod.plugin as { manifest: { configSchema: Record<string, unknown> } }).manifest.configSchema as {
      anyOf?: Array<{ required?: string[] }>;
      properties?: Record<string, unknown>;
    };
    const vaults = schema.properties?.vaults as {
      type?: string;
      items?: { required?: string[]; properties?: Record<string, unknown> };
    };
    const mode = vaults.items?.properties?.mode as { enum?: string[] };

    expect(schema.anyOf).toEqual(expect.arrayContaining([{ required: ['vaults'] }, { required: ['vaultPath'] }]));
    expect(vaults.type).toBe('array');
    expect(vaults.items?.required).toEqual(['name', 'description', 'vaultPath', 'mode']);
    expect(mode.enum).toEqual(['passive', 'query-only']);
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

    const config = createPluginConfig();
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

  it('disables gracefully for missing or invalid vault config', async () => {
    const mod = await import('./plugin.js');
    const hook = (mod.plugin as { hooks: { before_prompt_build: (args: unknown) => Promise<unknown> } }).hooks
      .before_prompt_build;
    const logger = { warn: vi.fn() };

    await expect(hook({ config: {}, logger })).resolves.toBeUndefined();
    await expect(hook({ config: { vaults: 'bad' }, logger })).resolves.toBeUndefined();

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
          config: createPluginConfig({
            vaults: [
              {
                name: 'default',
                description: 'Default vault',
                vaultPath: emptyVaultPath,
                mode: 'passive',
              },
            ],
          }),
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
          config: createPluginConfig({
            vaults: [
              {
                name: 'default',
                description: 'Default vault',
                vaultPath: emptyVaultPath,
                mode: 'passive',
              },
            ],
          }),
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

    const config = createPluginConfig();
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
      ...createPluginConfig(),
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
              vaults: [
                {
                  name: 'default',
                  description: 'Default vault',
                  vaultPath: '/tmp',
                  mode: 'passive',
                },
              ],
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

  it('before_prompt_build only queries passive vaults', async () => {
    const passivePath = await mkdtemp(join(tmpdir(), 'vault-passive-'));
    const queryOnlyPath = await mkdtemp(join(tmpdir(), 'vault-query-only-'));
    const passiveIndex = createMockIndex();
    const queryOnlyIndex = createMockIndex();
    rebuildIndexMock.mockResolvedValueOnce(passiveIndex).mockResolvedValueOnce(queryOnlyIndex);
    queryMock.mockReturnValue(createQueryResult({ query: 'only-passive' }));

    const mod = await import('./plugin.js');
    const hook = (mod.plugin as { hooks: { before_prompt_build: (args: unknown) => Promise<unknown> } }).hooks
      .before_prompt_build;

    try {
      const config = createPluginConfig({
        vaults: [
          {
            name: 'primary',
            description: 'Primary passive vault',
            vaultPath: passivePath,
            mode: 'passive',
          },
          {
            name: 'archive',
            description: 'Archive query-only vault',
            vaultPath: queryOnlyPath,
            mode: 'query-only',
          },
        ],
      });
      const messages = [{ role: 'user', content: 'passive query' }];

      await hook({ config, messages });
      await vi.waitFor(() => expect(mod.__testing.getState()).toBe('ready'));
      const result = await hook({ config, messages });

      expect(queryMock).toHaveBeenCalledTimes(1);
      expect(queryMock).toHaveBeenCalledWith(
        passiveIndex,
        'passive query',
        expect.objectContaining({ maxResults: 3 })
      );
      expect(result).toEqual({
        appendSystemContext: expect.stringContaining('Available vaults:'),
      });
      const appendSystemContext = (result as { appendSystemContext?: string }).appendSystemContext;
      expect(appendSystemContext).toContain('- primary: Primary passive vault');
      expect(appendSystemContext).toContain('- archive (query-only): Archive query-only vault');
      expect(appendSystemContext).toContain('### primary');
      expect(appendSystemContext).not.toContain('### archive');
    } finally {
      await rm(passivePath, { recursive: true, force: true });
      await rm(queryOnlyPath, { recursive: true, force: true });
    }
  });

  it('before_prompt_build applies session-key scope per passive vault', async () => {
    const primaryPath = await mkdtemp(join(tmpdir(), 'vault-passive-primary-'));
    const scopedPath = await mkdtemp(join(tmpdir(), 'vault-passive-scoped-'));
    const primaryIndex = createMockIndex();
    const scopedIndex = createMockIndex();
    rebuildIndexMock.mockResolvedValueOnce(primaryIndex).mockResolvedValueOnce(scopedIndex);
    queryMock.mockReturnValue(createQueryResult({ query: 'scoped passive query' }));

    const mod = await import('./plugin.js');
    const hook = (mod.plugin as { hooks: { before_prompt_build: (args: unknown) => Promise<unknown> } }).hooks
      .before_prompt_build;
    const config = createPluginConfig({
      vaults: [
        {
          name: 'primary',
          description: 'Primary passive vault',
          vaultPath: primaryPath,
          mode: 'passive',
        },
        {
          name: 'scoped',
          description: 'Scoped passive vault',
          vaultPath: scopedPath,
          mode: 'passive',
          scope: {
            allowSessionKeys: ['agent:cpto:*'],
          },
        },
      ],
    });
    const messages = [{ role: 'user', content: 'scoped passive query' }];

    try {
      await hook({
        config,
        messages,
        sessionKey: 'agent:finance:slack:prod',
      });
      await vi.waitFor(() => expect(mod.__testing.getState()).toBe('ready'));
      await hook({
        config,
        messages,
        sessionKey: 'agent:finance:slack:prod',
      });

      expect(queryMock).toHaveBeenCalledTimes(1);
      expect(queryMock).toHaveBeenCalledWith(primaryIndex, 'scoped passive query', expect.any(Object));
      expect(queryMock).not.toHaveBeenCalledWith(scopedIndex, expect.any(String), expect.any(Object));
    } finally {
      await rm(primaryPath, { recursive: true, force: true });
      await rm(scopedPath, { recursive: true, force: true });
    }
  });

  it('before_prompt_build emits nothing when no passive vault is eligible', async () => {
    rebuildIndexMock.mockResolvedValue(createMockIndex());
    queryMock.mockReturnValue(createQueryResult());

    const mod = await import('./plugin.js');
    const hook = (mod.plugin as { hooks: { before_prompt_build: (args: unknown) => Promise<unknown> } }).hooks
      .before_prompt_build;
    const config = createPluginConfig({
      vaults: [
        {
          name: 'archive',
          description: 'Archive query-only vault',
          vaultPath: '/tmp',
          mode: 'query-only',
        },
      ],
    });

    await hook({ config, messages: [{ role: 'user', content: 'no passive match' }] });
    await vi.waitFor(() => expect(mod.__testing.getState()).toBe('ready'));
    const result = await hook({ config, messages: [{ role: 'user', content: 'no passive match' }] });

    expect(result).toBeUndefined();
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('before_prompt_build emits nothing when passive candidates do not survive query filtering', async () => {
    rebuildIndexMock.mockResolvedValue(createMockIndex());
    queryMock.mockReturnValue(createQueryResult({ results: [] }));

    const mod = await import('./plugin.js');
    const hook = (mod.plugin as { hooks: { before_prompt_build: (args: unknown) => Promise<unknown> } }).hooks
      .before_prompt_build;
    const config = createPluginConfig({
      vaults: [
        {
          name: 'primary',
          description: 'Primary passive vault',
          vaultPath: '/tmp',
          mode: 'passive',
        },
      ],
    });
    const messages = [{ role: 'user', content: 'strict thresholds' }];

    await hook({ config, messages });
    await vi.waitFor(() => expect(mod.__testing.getState()).toBe('ready'));
    const result = await hook({ config, messages });

    expect(queryMock).toHaveBeenCalledTimes(1);
    expect(result).toBeUndefined();
  });

  it('vault_query forwards input and returns QueryResult without transformation', async () => {
    rebuildIndexMock.mockResolvedValue(createMockIndex());
    const queryResult = createQueryResult({ query: 'memory systems' });
    queryMock.mockReturnValue(queryResult);

    const mod = await import('./plugin.js');
    const registerTool = vi.fn();
    (mod.plugin as { register: (api: { registerTool: (tool: RegisteredTool) => void }) => void }).register({
      registerTool,
    });
    const tool = registerTool.mock.calls[0]?.[0] as RegisteredTool;

    const result = await tool.execute(
      'req-1',
      {
        query: 'memory systems',
        maxResults: 7,
        noteTypes: ['belief', 'research'],
        context: 'recall systems',
      },
      {
        config: createPluginConfig(),
      }
    );

    expect(result).toEqual(
      expect.objectContaining({
        query: 'memory systems',
        results: queryResult.results,
      })
    );
    expect(rebuildIndexMock).toHaveBeenCalledTimes(1);
    expect(queryMock).toHaveBeenCalledWith(
      expect.anything(),
      'memory systems',
      {
        maxResults: 7,
        noteTypes: ['belief', 'research'],
        context: 'recall systems',
      }
    );
  });

  it('tool initializes shared singleton when called first, and hook reuses ready engine', async () => {
    rebuildIndexMock.mockResolvedValue(createMockIndex());
    queryMock
      .mockReturnValueOnce(createQueryResult({ query: 'from tool' }))
      .mockReturnValueOnce(createQueryResult({ query: 'from hook' }));

    const mod = await import('./plugin.js');
    const registerTool = vi.fn();
    (mod.plugin as { register: (api: { registerTool: (tool: RegisteredTool) => void }) => void }).register({
      registerTool,
    });
    const tool = registerTool.mock.calls[0]?.[0] as RegisteredTool;
    const hook = (mod.plugin as { hooks: { before_prompt_build: (args: unknown) => Promise<unknown> } }).hooks
      .before_prompt_build;

    await tool.execute(
      'req-tool-first',
      {
        query: 'tool-first query',
      },
      {
        config: createPluginConfig(),
      }
    );

    expect(mod.__testing.getState()).toBe('ready');
    expect(rebuildIndexMock).toHaveBeenCalledTimes(1);

    await hook({
      config: createPluginConfig(),
      messages: [{ role: 'user', content: 'hook query' }],
    });

    expect(rebuildIndexMock).toHaveBeenCalledTimes(1);
    expect(queryMock).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      'tool-first query',
      {
        maxResults: undefined,
        noteTypes: undefined,
        context: undefined,
      }
    );
    expect(queryMock).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      'hook query',
      expect.objectContaining({
        maxResults: 3,
        context: 'hook query',
      })
    );
  });

  it('before_prompt_build enforces session-key scope and no-ops when unresolved', async () => {
    rebuildIndexMock.mockResolvedValue(createMockIndex());
    queryMock.mockReturnValue(createQueryResult());

    const mod = await import('./plugin.js');
    const hook = (mod.plugin as { hooks: { before_prompt_build: (args: unknown) => Promise<unknown> } }).hooks
      .before_prompt_build;
    const config = {
      vaults: [
        {
          name: 'default',
          description: 'Default vault',
          vaultPath: '/tmp',
          mode: 'passive',
          scope: {
            allowSessionKeys: ['agent:cpto:*'],
          },
        },
      ],
    };
    const messages = [{ role: 'user', content: 'scope query' }];

    await hook({
      config,
      messages,
      sessionKey: 'agent:cpto:slack:prod',
    });
    await vi.waitFor(() => expect(mod.__testing.getState()).toBe('ready'));
    await hook({
      config,
      messages,
      sessionKey: 'agent:cpto:slack:prod',
    });

    expect(queryMock).toHaveBeenCalledTimes(1);

    await expect(
      hook({
        config,
        messages,
        sessionKey: 'agent:finance:slack:prod',
      })
    ).resolves.toBeUndefined();
    await expect(
      hook({
        config,
        messages,
      })
    ).resolves.toBeUndefined();

    expect(queryMock).toHaveBeenCalledTimes(1);
  });

  it('vault_query refuses when session is out of scope', async () => {
    rebuildIndexMock.mockResolvedValue(createMockIndex());
    const mod = await import('./plugin.js');
    const registerTool = vi.fn();
    (mod.plugin as { register: (api: { registerTool: (tool: RegisteredTool) => void }) => void }).register({
      registerTool,
    });
    const tool = registerTool.mock.calls[0]?.[0] as RegisteredTool;

    await expect(
      tool.execute(
        'req-out-of-scope',
        {
          query: 'should fail',
        },
        {
          config: {
            vaults: [
              {
                name: 'default',
                description: 'Default vault',
                vaultPath: '/tmp',
                mode: 'passive',
                scope: {
                  allowSessionKeys: ['agent:cpto:*'],
                },
              },
            ],
          },
          sessionKey: 'agent:finance:slack:prod',
        }
      )
    ).rejects.toThrow('vault_query unavailable: current session is out of scope');

    expect(rebuildIndexMock).toHaveBeenCalledTimes(1);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('vault_query refuses when session key cannot be resolved and scope rules exist', async () => {
    rebuildIndexMock.mockResolvedValue(createMockIndex());
    const mod = await import('./plugin.js');
    const registerTool = vi.fn();
    (mod.plugin as { register: (api: { registerTool: (tool: RegisteredTool) => void }) => void }).register({
      registerTool,
    });
    const tool = registerTool.mock.calls[0]?.[0] as RegisteredTool;

    await expect(
      tool.execute(
        'req-missing-session',
        {
          query: 'should fail',
        },
        {
          config: {
            vaults: [
              {
                name: 'default',
                description: 'Default vault',
                vaultPath: '/tmp',
                mode: 'passive',
                scope: {
                  allowSessionKeys: ['agent:cpto:*'],
                },
              },
            ],
          },
        }
      )
    ).rejects.toThrow('vault_query unavailable: session key is required when scope rules are configured');

    expect(rebuildIndexMock).toHaveBeenCalledTimes(1);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('vault_query searches all eligible vaults by default and supports explicit vault targeting', async () => {
    const passivePath = await mkdtemp(join(tmpdir(), 'vault-tool-passive-'));
    const queryOnlyPath = await mkdtemp(join(tmpdir(), 'vault-tool-query-only-'));
    const passiveIndex = createMockIndex();
    const queryOnlyIndex = createMockIndex();
    rebuildIndexMock.mockResolvedValueOnce(passiveIndex).mockResolvedValueOnce(queryOnlyIndex);
    queryMock.mockReturnValue(createQueryResult({ query: 'distributed query' }));

    const mod = await import('./plugin.js');
    const registerTool = vi.fn();
    (mod.plugin as { register: (api: { registerTool: (tool: RegisteredTool) => void }) => void }).register({
      registerTool,
    });
    const tool = registerTool.mock.calls[0]?.[0] as RegisteredTool;
    const config = createPluginConfig({
      vaults: [
        {
          name: 'primary',
          description: 'Primary passive vault',
          vaultPath: passivePath,
          mode: 'passive',
        },
        {
          name: 'archive',
          description: 'Archive query-only vault',
          vaultPath: queryOnlyPath,
          mode: 'query-only',
          scope: {
            allowSessionKeys: ['agent:cpto:*'],
          },
        },
      ],
    });

    try {
      await tool.execute(
        'req-all-vaults',
        {
          query: 'distributed query',
        },
        {
          config,
          sessionKey: 'agent:cpto:slack:prod',
        }
      );

      expect(queryMock).toHaveBeenCalledTimes(2);
      expect(queryMock).toHaveBeenNthCalledWith(1, passiveIndex, 'distributed query', expect.any(Object));
      expect(queryMock).toHaveBeenNthCalledWith(2, queryOnlyIndex, 'distributed query', expect.any(Object));

      queryMock.mockClear();

      await tool.execute(
        'req-specific-vault',
        {
          query: 'archive only',
          vault: 'archive',
        },
        {
          config,
          sessionKey: 'agent:cpto:slack:prod',
        }
      );

      expect(queryMock).toHaveBeenCalledTimes(1);
      expect(queryMock).toHaveBeenCalledWith(queryOnlyIndex, 'archive only', expect.any(Object));
    } finally {
      await rm(passivePath, { recursive: true, force: true });
      await rm(queryOnlyPath, { recursive: true, force: true });
    }
  });

  it('vault_query excludes out-of-scope vaults by default and rejects explicit out-of-scope vault', async () => {
    const primaryPath = await mkdtemp(join(tmpdir(), 'vault-tool-primary-'));
    const scopedPath = await mkdtemp(join(tmpdir(), 'vault-tool-scoped-'));
    const primaryIndex = createMockIndex();
    const scopedIndex = createMockIndex();
    rebuildIndexMock.mockResolvedValueOnce(primaryIndex).mockResolvedValueOnce(scopedIndex);
    queryMock.mockReturnValue(createQueryResult({ query: 'scope constrained' }));

    const mod = await import('./plugin.js');
    const registerTool = vi.fn();
    (mod.plugin as { register: (api: { registerTool: (tool: RegisteredTool) => void }) => void }).register({
      registerTool,
    });
    const tool = registerTool.mock.calls[0]?.[0] as RegisteredTool;
    const config = createPluginConfig({
      vaults: [
        {
          name: 'primary',
          description: 'Primary vault',
          vaultPath: primaryPath,
          mode: 'passive',
        },
        {
          name: 'scoped',
          description: 'Scoped vault',
          vaultPath: scopedPath,
          mode: 'query-only',
          scope: {
            allowSessionKeys: ['agent:cpto:*'],
          },
        },
      ],
    });

    try {
      await tool.execute(
        'req-default-eligible-only',
        {
          query: 'scope constrained',
        },
        {
          config,
          sessionKey: 'agent:finance:slack:prod',
        }
      );

      expect(queryMock).toHaveBeenCalledTimes(1);
      expect(queryMock).toHaveBeenCalledWith(primaryIndex, 'scope constrained', expect.any(Object));
      expect(queryMock).not.toHaveBeenCalledWith(scopedIndex, expect.any(String), expect.any(Object));

      queryMock.mockClear();

      await expect(
        tool.execute(
          'req-explicit-oos',
          {
            query: 'scope constrained',
            vault: 'scoped',
          },
          {
            config,
            sessionKey: 'agent:finance:slack:prod',
          }
        )
      ).rejects.toThrow('vault_query unavailable: current session is out of scope');

      expect(queryMock).not.toHaveBeenCalled();
    } finally {
      await rm(primaryPath, { recursive: true, force: true });
      await rm(scopedPath, { recursive: true, force: true });
    }
  });

  it('vault_query rejects explicit unknown vault names', async () => {
    const primaryPath = await mkdtemp(join(tmpdir(), 'vault-tool-unknown-'));
    const primaryIndex = createMockIndex();
    rebuildIndexMock.mockResolvedValueOnce(primaryIndex);
    queryMock.mockReturnValue(createQueryResult({ query: 'unknown vault' }));

    const mod = await import('./plugin.js');
    const registerTool = vi.fn();
    (mod.plugin as { register: (api: { registerTool: (tool: RegisteredTool) => void }) => void }).register({
      registerTool,
    });
    const tool = registerTool.mock.calls[0]?.[0] as RegisteredTool;
    const config = createPluginConfig({
      vaults: [
        {
          name: 'primary',
          description: 'Primary vault',
          vaultPath: primaryPath,
          mode: 'passive',
        },
      ],
    });

    try {
      await expect(
        tool.execute(
          'req-unknown-vault',
          {
            query: 'unknown vault',
            vault: 'does-not-exist',
          },
          {
            config,
          }
        )
      ).rejects.toThrow('vault_query unavailable: unknown vault "does-not-exist"');

      expect(queryMock).not.toHaveBeenCalled();
    } finally {
      await rm(primaryPath, { recursive: true, force: true });
    }
  });

  it('vault_query rejects whitespace-only explicit vault targeting', async () => {
    const primaryPath = await mkdtemp(join(tmpdir(), 'vault-tool-whitespace-'));
    const primaryIndex = createMockIndex();
    rebuildIndexMock.mockResolvedValueOnce(primaryIndex);
    queryMock.mockReturnValue(createQueryResult({ query: 'whitespace vault' }));

    const mod = await import('./plugin.js');
    const registerTool = vi.fn();
    (mod.plugin as { register: (api: { registerTool: (tool: RegisteredTool) => void }) => void }).register({
      registerTool,
    });
    const tool = registerTool.mock.calls[0]?.[0] as RegisteredTool;
    const config = createPluginConfig({
      vaults: [
        {
          name: 'primary',
          description: 'Primary vault',
          vaultPath: primaryPath,
          mode: 'passive',
        },
      ],
    });

    try {
      await expect(
        tool.execute(
          'req-whitespace-vault',
          {
            query: 'whitespace vault',
            vault: '   ',
          },
          {
            config,
          }
        )
      ).rejects.toThrow('vault_query unavailable: unknown vault "   "');

      expect(queryMock).not.toHaveBeenCalled();
    } finally {
      await rm(primaryPath, { recursive: true, force: true });
    }
  });

  it('missing config call does not permanently disable later valid tool initialization', async () => {
    rebuildIndexMock.mockResolvedValue(createMockIndex());
    const queryResult = createQueryResult({ query: 'recovered' });
    queryMock.mockReturnValue(queryResult);

    const mod = await import('./plugin.js');
    const hook = (mod.plugin as { hooks: { before_prompt_build: (args: unknown) => Promise<unknown> } }).hooks
      .before_prompt_build;
    const registerTool = vi.fn();
    (mod.plugin as { register: (api: { registerTool: (tool: RegisteredTool) => void }) => void }).register({
      registerTool,
    });
    const tool = registerTool.mock.calls[0]?.[0] as RegisteredTool;

    await expect(hook({ config: {}, logger: { warn: vi.fn() } })).resolves.toBeUndefined();
    expect(mod.__testing.getState()).toBe('idle');

    const result = await tool.execute(
      'req-recover',
      {
        query: 'recovered',
      },
      {
        config: createPluginConfig(),
      }
    );

    expect(result).toEqual(
      expect.objectContaining({
        query: 'recovered',
        results: queryResult.results,
      })
    );
    expect(rebuildIndexMock).toHaveBeenCalledTimes(1);
    expect(mod.__testing.getState()).toBe('ready');
  });
});
