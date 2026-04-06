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
              vaultPath: '/tmp',
              scope: {
                allowSessionKeys: ['agent:cpto:*'],
                denySessionKeys: ['agent:cpto:slack:*'],
              },
            },
          },
        },
      },
    });

    expect(parsed?.scope).toEqual({
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
              vaultPath: '/tmp',
              scope: {
                allowSessionKeys: [' agent:cpto:slack:prod ', 'agent:cpto:*'],
                denySessionKeys: [' agent:cpto:slack:sandbox:* '],
              },
            },
          },
        },
      },
    });

    expect(parsed?.scope).toEqual({
      allowSessionKeys: ['agent:cpto:slack:prod', 'agent:cpto:*'],
      denySessionKeys: ['agent:cpto:slack:sandbox:*'],
    });
  });
});
