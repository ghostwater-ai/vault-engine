import type { QueryResult, ScoredDocument } from '@ghostwater/vault-engine';
import { describe, expect, it } from 'vitest';

import { formatAppendSystemContext } from './formatter.js';
import type { VaultMode } from './runtime.js';

function estimateTokenCount(text: string): number {
  return Math.ceil(text.length / 4);
}

function createScoredDocument(
  title: string,
  description?: string,
  score = 1,
  overrides: Partial<ScoredDocument['doc']> = {},
  vaultName?: string
): ScoredDocument {
  const result = {
    doc: {
      path: `/vault/${title}.md`,
      slug: title.toLowerCase(),
      noteType: 'belief',
      title,
      description,
      status: 'proven',
      confidence: 'high',
      bodySections: [],
      rawBody: '',
      ...overrides,
    },
    score,
    bm25Raw: 1,
    bm25Normalized: 1,
    typeBoost: 0.1,
    confidenceModifier: 0.1,
    matchedFields: ['title'],
    explanation: 'test',
  };

  return vaultName ? Object.assign(result, { vaultName }) : result;
}

function createQueryResult(results: ScoredDocument[]): QueryResult {
  return {
    results,
    tier: 0,
    latencyMs: 1,
    query: 'test',
  };
}

const defaultAvailableVaults: Array<{ name: string; description: string; mode: VaultMode }> = [
  { name: 'Team', description: 'Primary team memory', mode: 'passive' },
];

describe('formatAppendSystemContext', () => {
  it('formats output with explanation, available vaults, and grouped vault headings', () => {
    const result = createQueryResult([
      createScoredDocument('Belief A', 'Frontmatter description', 0.9, {}, 'Team'),
      createScoredDocument('Belief B', undefined, 0.8, {}, 'Team'),
    ]);

    expect(formatAppendSystemContext(result, { maxTokens: 1500, availableVaults: defaultAvailableVaults })).toBe(
      '## Vault Context\n\nVaults are curated knowledge bases. Use `vault_query` when you need deeper or targeted retrieval.\n\nAvailable vaults:\n- Team: Primary team memory\n\n### Team\n\n[belief|high] Belief A\nFrontmatter description\n\n[belief|high] Belief B'
    );
  });

  it('lists query-only vaults but excludes them from grouped passive results', () => {
    const result = createQueryResult([
      createScoredDocument('Passive A', 'a', 0.9, {}, 'Team'),
      createScoredDocument('Passive B', 'b', 0.8, {}, 'Team'),
    ]);

    const output = formatAppendSystemContext(result, {
      maxTokens: 1500,
      availableVaults: [
        { name: 'Team', description: 'Primary team memory', mode: 'passive' },
        { name: 'Archive', description: 'Deep archive', mode: 'query-only' },
      ],
    });
    expect(output).toContain('Available vaults:\n- Team: Primary team memory\n- Archive (query-only): Deep archive');
    expect(output).toContain('### Team');
    expect(output).not.toContain('### Archive');
  });

  it('limits output to top 3 results before grouping', () => {
    const result = createQueryResult([
      createScoredDocument('A', 'a', 1, {}, 'Vault 1'),
      createScoredDocument('B', 'b', 1, {}, 'Vault 1'),
      createScoredDocument('C', 'c', 1, {}, 'Vault 2'),
      createScoredDocument('D', 'd', 1, {}, 'Vault 2'),
    ]);

    const output = formatAppendSystemContext(result, { maxTokens: 1500, availableVaults: defaultAvailableVaults });
    expect(output).toBeDefined();
    expect(output).toContain('[belief|high] A');
    expect(output).toContain('[belief|high] B');
    expect(output).toContain('[belief|high] C');
    expect(output).not.toContain('[belief|high] D');
  });

  it('enforces per-result 400-token cap and total budget within 1500', () => {
    const longDescription = 'x'.repeat(5000);
    const result = createQueryResult([
      createScoredDocument('A', longDescription, 1, {}, 'Vault 1'),
      createScoredDocument('B', longDescription, 1, {}, 'Vault 1'),
      createScoredDocument('C', longDescription, 1, {}, 'Vault 2'),
    ]);

    const output = formatAppendSystemContext(result, { maxTokens: 99999, availableVaults: defaultAvailableVaults });
    expect(output).toBeDefined();
    const blocks = output!
      .split('\n\n')
      .filter((block) => block.startsWith('['));
    expect(blocks).toHaveLength(3);

    for (const block of blocks) {
      expect(estimateTokenCount(block)).toBeLessThanOrEqual(400);
    }
    expect(estimateTokenCount(output!)).toBeLessThanOrEqual(1500);
  });

  it('drops weakest results first when budget is exceeded', () => {
    const mediumDescription = 'y'.repeat(900);
    const result = createQueryResult([
      createScoredDocument('Strongest', mediumDescription, 0.9, {}, 'Vault 1'),
      createScoredDocument('Middle', mediumDescription, 0.6, {}, 'Vault 2'),
      createScoredDocument('Weakest', mediumDescription, 0.3, {}, 'Vault 3'),
    ]);

    const output = formatAppendSystemContext(result, { maxTokens: 700, availableVaults: defaultAvailableVaults });
    expect(output).toBeDefined();
    expect(output).toContain('[belief|high] Strongest');
    expect(output).toContain('[belief|high] Middle');
    expect(output).not.toContain('[belief|high] Weakest');
  });

  it('uses note-type-aware secondary metadata and omits it when missing', () => {
    const result = createQueryResult([
      createScoredDocument('Belief Confidence', undefined, 1, {
        noteType: 'belief',
        confidence: 'high',
        maturity: 'seedling',
        status: 'proven',
      }, 'Team'),
      createScoredDocument('Belief Maturity', undefined, 1, {
        noteType: 'belief',
        confidence: undefined,
        maturity: 'evergreen',
        status: 'proven',
      }, 'Team'),
      createScoredDocument('Belief Bare', undefined, 1, {
        noteType: 'belief',
        confidence: undefined,
        maturity: undefined,
        status: undefined,
      }, 'Team'),
    ]);

    const output = formatAppendSystemContext(result, { maxTokens: 1500, availableVaults: defaultAvailableVaults });
    expect(output).toContain('[belief|high] Belief Confidence');
    expect(output).not.toContain('[belief|unknown] Belief Confidence');
    expect(output).toContain('[belief|evergreen] Belief Maturity');
    expect(output).toContain('[belief] Belief Bare');
  });

  it('formats research and other note types with sensible existing secondary metadata', () => {
    const result = createQueryResult([
      createScoredDocument('Research Proven', undefined, 1, {
        noteType: 'research',
        status: 'proven',
      }, 'Team'),
      createScoredDocument('Research Bare', undefined, 1, {
        noteType: 'research',
        status: undefined,
      }, 'Team'),
      createScoredDocument('Experience Completed', undefined, 1, {
        noteType: 'experience',
        status: 'completed',
      }, 'Team'),
    ]);

    const output = formatAppendSystemContext(result, { maxTokens: 1500, availableVaults: defaultAvailableVaults });
    expect(output).toContain('[research|proven] Research Proven');
    expect(output).toContain('[research] Research Bare');
    expect(output).toContain('[experience|completed] Experience Completed');
  });

  it('renders [noteType] only for non-belief/non-research notes without secondary metadata', () => {
    const result = createQueryResult([
      createScoredDocument('Entity Bare', undefined, 1, {
        noteType: 'entity',
        status: undefined,
        provenance: undefined,
        date: undefined,
        updatedAt: undefined,
      }, 'Team'),
    ]);

    const output = formatAppendSystemContext(result, { maxTokens: 1500, availableVaults: defaultAvailableVaults });
    expect(output).toContain('[entity] Entity Bare');
    expect(output).not.toContain('[entity|');
  });

  it('returns undefined when there are no results', () => {
    expect(
      formatAppendSystemContext(createQueryResult([]), { maxTokens: 1500, availableVaults: defaultAvailableVaults })
    ).toBeUndefined();
  });
});
