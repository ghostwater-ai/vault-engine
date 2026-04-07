import type { QueryResult, ScoredDocument, VaultDocument, VaultIndex } from '@ghostwater/vault-engine';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { queryMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
}));
vi.mock('@ghostwater/vault-engine', () => ({
  query: queryMock,
  rebuildIndex: vi.fn(),
}));

import type { PluginConfig, ReadyVaultEngine, VaultConfig, VaultMode } from './runtime.js';
import { evaluateSessionKeyScope, parseConfig, runPassiveQuery } from './runtime.js';

function createDoc(title: string): VaultDocument {
  return {
    path: `/tmp/${title}.md`,
    slug: title.toLowerCase(),
    noteType: 'belief',
    title,
    description: `${title} description`,
    status: 'proven',
    confidence: 'high',
    bodySections: [],
    rawBody: '',
  };
}

function createScored(title: string, score: number): ScoredDocument {
  return {
    doc: createDoc(title),
    score,
    bm25Raw: 1,
    bm25Normalized: 0.5,
    typeBoost: 0.1,
    confidenceModifier: 0.1,
    matchedFields: ['title'],
    explanation: 'test',
  };
}

function createQueryResult(results: ScoredDocument[]): QueryResult {
  return {
    results,
    tier: 0,
    latencyMs: 1,
    query: 'q',
  };
}

function createReadyVault(name: string, mode: VaultMode, description: string): ReadyVaultEngine {
  return {
    vault: {
      name,
      mode,
      description,
      vaultPath: `/tmp/${name}`,
      scope: {
        allowSessionKeys: [],
        denySessionKeys: [],
      },
    } satisfies VaultConfig,
    index: { getStats: () => ({ documentCount: 1 }) } as unknown as VaultIndex,
  };
}

function createPassiveConfig(maxResults = 3): PluginConfig {
  return {
    vaults: [],
    injection: {
      maxResults,
      maxTokens: 1500,
      minScore: 0.3,
      minBm25Score: 0.1,
    },
  };
}

describe('session-key scope rules', () => {
  it('supports exact allow', () => {
    const decision = evaluateSessionKeyScope(
      { allowSessionKeys: ['agent:cpto:slack:prod'], denySessionKeys: [] },
      'agent:cpto:slack:prod'
    );

    expect(decision).toMatchObject({ inScope: true, reason: 'allowed-by-rule' });
  });

  it('supports exact deny', () => {
    const decision = evaluateSessionKeyScope(
      { allowSessionKeys: [], denySessionKeys: ['agent:cpto:slack:prod'] },
      'agent:cpto:slack:prod'
    );

    expect(decision).toMatchObject({ inScope: false, reason: 'denied-by-rule' });
  });

  it('supports glob allow', () => {
    const decision = evaluateSessionKeyScope(
      { allowSessionKeys: ['agent:cpto:*'], denySessionKeys: [] },
      'agent:cpto:slack:prod'
    );

    expect(decision).toMatchObject({ inScope: true, reason: 'allowed-by-rule' });
  });

  it('supports glob deny', () => {
    const decision = evaluateSessionKeyScope(
      { allowSessionKeys: [], denySessionKeys: ['agent:cpto:*'] },
      'agent:cpto:slack:prod'
    );

    expect(decision).toMatchObject({ inScope: false, reason: 'denied-by-rule' });
  });

  it('enforces deny-overrides-allow', () => {
    const decision = evaluateSessionKeyScope(
      {
        allowSessionKeys: ['agent:cpto:*'],
        denySessionKeys: ['agent:cpto:slack:*'],
      },
      'agent:cpto:slack:prod'
    );

    expect(decision).toMatchObject({ inScope: false, reason: 'denied-by-rule' });
  });

  it('switches default to deny when allowlist exists', () => {
    const decision = evaluateSessionKeyScope(
      {
        allowSessionKeys: ['agent:cpto:*'],
        denySessionKeys: [],
      },
      'agent:research:slack:prod'
    );

    expect(decision).toMatchObject({ inScope: false, reason: 'default-deny-allowlist' });
  });

  it('keeps default allow when allowlist does not exist', () => {
    const decision = evaluateSessionKeyScope(
      {
        allowSessionKeys: [],
        denySessionKeys: ['agent:blocked:*'],
      },
      'agent:research:slack:prod'
    );

    expect(decision).toMatchObject({ inScope: true, reason: 'default-allow-no-allowlist' });
  });

  it('returns explicit missing-session-key decision when scope rules are configured', () => {
    const decision = evaluateSessionKeyScope(
      {
        allowSessionKeys: ['agent:cpto:*'],
        denySessionKeys: [],
      },
      undefined
    );

    expect(decision).toMatchObject({ inScope: false, reason: 'missing-session-key' });
  });

  it('parses scope rules from nested plugin config input', () => {
    const parsed = parseConfig({
      plugins: {
        entries: {
          'vault-engine': {
            config: {
              vaults: [
                {
                  name: 'Main',
                  description: 'Primary vault',
                  vaultPath: '/tmp',
                  mode: 'passive',
                  scope: {
                    allowSessionKeys: ['agent:cpto:*'],
                    denySessionKeys: ['agent:cpto:slack:*'],
                  },
                },
              ],
            },
          },
        },
      },
    });

    expect(parsed?.vaults[0]?.scope).toEqual({
      allowSessionKeys: ['agent:cpto:*'],
      denySessionKeys: ['agent:cpto:slack:*'],
    });
  });

  it('parses mixed exact + glob session-key scope values', () => {
    const parsed = parseConfig({
      plugins: {
        entries: {
          'vault-engine': {
            config: {
              vaults: [
                {
                  name: 'Main',
                  description: 'Primary vault',
                  vaultPath: '/tmp',
                  mode: 'passive',
                  scope: {
                    allowSessionKeys: [' agent:cpto:slack:prod ', 'agent:cpto:*'],
                    denySessionKeys: [' agent:cpto:slack:sandbox:* '],
                  },
                },
              ],
            },
          },
        },
      },
    });

    expect(parsed?.vaults[0]?.scope).toEqual({
      allowSessionKeys: ['agent:cpto:slack:prod', 'agent:cpto:*'],
      denySessionKeys: ['agent:cpto:slack:sandbox:*'],
    });
  });

  it('parses valid multi-vault config with normalized values', () => {
    const parsed = parseConfig({
      injection: {
        maxResults: 2.9,
      },
      vaults: [
        {
          name: ' Team Vault ',
          description: ' Team memory ',
          vaultPath: '~/vault/team',
          mode: 'passive',
          scope: {
            allowSessionKeys: [' agent:cpto:* '],
            denySessionKeys: [' agent:cpto:sandbox:* '],
          },
        },
        {
          name: ' Deep Archive ',
          description: ' Query only archive ',
          vaultPath: '/tmp/archive',
          mode: 'query-only',
        },
      ],
    });

    expect(parsed).toMatchObject({
      injection: {
        maxResults: 2,
      },
      vaults: [
        {
          name: 'Team Vault',
          description: 'Team memory',
          mode: 'passive',
          scope: {
            allowSessionKeys: ['agent:cpto:*'],
            denySessionKeys: ['agent:cpto:sandbox:*'],
          },
        },
        {
          name: 'Deep Archive',
          description: 'Query only archive',
          mode: 'query-only',
          scope: {
            allowSessionKeys: [],
            denySessionKeys: [],
          },
        },
      ],
    });
  });

  it('rejects vault entries with invalid mode', () => {
    const parsed = parseConfig({
      vaults: [
        {
          name: 'Main',
          description: 'Primary vault',
          vaultPath: '/tmp',
          mode: 'active',
        },
      ],
    });

    expect(parsed).toBeUndefined();
  });

  it('rejects vault entries with missing required fields', () => {
    const parsed = parseConfig({
      vaults: [
        {
          description: 'Primary vault',
          vaultPath: '/tmp',
          mode: 'passive',
        },
      ],
    });

    expect(parsed).toBeUndefined();
  });

  it('rejects multi-vault config with duplicate vault names', () => {
    const parsed = parseConfig({
      vaults: [
        {
          name: 'Main',
          description: 'Primary vault',
          vaultPath: '/tmp/main',
          mode: 'passive',
        },
        {
          name: 'Main',
          description: 'Duplicate name vault',
          vaultPath: '/tmp/other',
          mode: 'query-only',
        },
      ],
    });

    expect(parsed).toBeUndefined();
  });

  it('maps legacy single-vault config to one passive vault entry', () => {
    const parsed = parseConfig({
      vaultPath: '/tmp',
      scope: {
        allowSessionKeys: ['agent:cpto:*'],
      },
    });

    expect(parsed).toMatchObject({
      vaults: [
        {
          name: 'default',
          description: 'Legacy single-vault config',
          mode: 'passive',
          scope: {
            allowSessionKeys: ['agent:cpto:*'],
            denySessionKeys: [],
          },
        },
      ],
    });
  });
});

describe('runPassiveQuery multi-vault passive selection', () => {
  beforeEach(() => {
    queryMock.mockReset();
  });

  it('ranks passive winners globally across vaults and records vault metadata per result', () => {
    const passiveA = createReadyVault('primary', 'passive', 'Primary vault');
    const passiveB = createReadyVault('secondary', 'passive', 'Secondary vault');

    queryMock.mockImplementation((index: VaultIndex) => {
      if (index === passiveA.index) {
        return createQueryResult([
          createScored('Primary Mid', 0.65),
          createScored('Primary Low', 0.4),
        ]);
      }
      return createQueryResult([
        createScored('Secondary Top', 0.9),
        createScored('Secondary Low', 0.2),
      ]);
    });

    const result = runPassiveQuery(
      [passiveA, passiveB],
      ['user asks for memory'],
      createPassiveConfig(3),
      'agent:any'
    );

    expect(queryMock).toHaveBeenCalledTimes(2);
    expect(result.results.map((item) => item.doc.title)).toEqual([
      'Secondary Top',
      'Primary Mid',
      'Primary Low',
    ]);
    expect(result.results[0]).toMatchObject({
      vaultName: 'secondary',
      vaultDescription: 'Secondary vault',
    });
    expect(result.results[1]).toMatchObject({
      vaultName: 'primary',
      vaultDescription: 'Primary vault',
    });
  });

  it('excludes query-only vaults from passive candidate generation and budget consumption', () => {
    const passive = createReadyVault('primary', 'passive', 'Primary vault');
    const queryOnly = createReadyVault('archive', 'query-only', 'Archive vault');

    queryMock.mockImplementation((index: VaultIndex) => {
      if (index === passive.index) {
        return createQueryResult([createScored('Passive Winner', 0.55)]);
      }
      return createQueryResult([createScored('Query-Only Should Not Appear', 0.99)]);
    });

    const result = runPassiveQuery(
      [passive, queryOnly],
      ['user asks for memory'],
      createPassiveConfig(1),
      undefined
    );

    expect(queryMock).toHaveBeenCalledTimes(1);
    expect(queryMock).toHaveBeenCalledWith(passive.index, 'user asks for memory', expect.any(Object));
    expect(result.results).toHaveLength(1);
    expect(result.results[0]?.doc.title).toBe('Passive Winner');
  });
});
