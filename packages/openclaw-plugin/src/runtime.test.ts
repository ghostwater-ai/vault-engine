import { describe, expect, it } from 'vitest';

import { evaluateSessionKeyScope, parseConfig } from './runtime.js';

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
