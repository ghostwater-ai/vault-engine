import type { QueryResult, ScoredDocument } from '@ghostwater/vault-engine';
import { describe, expect, it } from 'vitest';

import { formatAppendSystemContext } from './formatter.js';

function estimateTokenCount(text: string): number {
  return Math.ceil(text.length / 4);
}

function createScoredDocument(
  title: string,
  description?: string,
  score = 1
): ScoredDocument {
  return {
    doc: {
      path: `/vault/${title}.md`,
      slug: title.toLowerCase(),
      noteType: 'belief',
      title,
      description,
      status: 'proven',
      bodySections: [],
      rawBody: '',
    },
    score,
    bm25Raw: 1,
    bm25Normalized: 1,
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
    query: 'test',
  };
}

describe('formatAppendSystemContext', () => {
  it('formats output with header and frontmatter description only', () => {
    const result = createQueryResult([
      createScoredDocument('Belief A', 'Frontmatter description'),
      createScoredDocument('Belief B'),
    ]);

    expect(formatAppendSystemContext(result, { maxTokens: 1500 })).toBe(
      '## Vault Context\n\n[belief|proven] Belief A\nFrontmatter description\n\n[belief|proven] Belief B'
    );
  });

  it('limits output to top 3 results', () => {
    const result = createQueryResult([
      createScoredDocument('A', 'a'),
      createScoredDocument('B', 'b'),
      createScoredDocument('C', 'c'),
      createScoredDocument('D', 'd'),
    ]);

    const output = formatAppendSystemContext(result, { maxTokens: 1500 });
    expect(output).toBeDefined();
    expect(output).toContain('[belief|proven] A');
    expect(output).toContain('[belief|proven] B');
    expect(output).toContain('[belief|proven] C');
    expect(output).not.toContain('[belief|proven] D');
  });

  it('enforces per-result 400-token cap and total budget within 1500', () => {
    const longDescription = 'x'.repeat(5000);
    const result = createQueryResult([
      createScoredDocument('A', longDescription),
      createScoredDocument('B', longDescription),
      createScoredDocument('C', longDescription),
    ]);

    const output = formatAppendSystemContext(result, { maxTokens: 99999 });
    expect(output).toBeDefined();
    const blocks = output!.split('\n\n');
    expect(blocks).toHaveLength(4);

    for (const block of blocks.slice(1)) {
      expect(estimateTokenCount(block)).toBeLessThanOrEqual(400);
    }
    expect(estimateTokenCount(output!)).toBeLessThanOrEqual(1500);
  });

  it('drops weakest results first when budget is exceeded', () => {
    const mediumDescription = 'y'.repeat(900);
    const result = createQueryResult([
      createScoredDocument('Strongest', mediumDescription, 0.9),
      createScoredDocument('Middle', mediumDescription, 0.6),
      createScoredDocument('Weakest', mediumDescription, 0.3),
    ]);

    const output = formatAppendSystemContext(result, { maxTokens: 500 });
    expect(output).toBeDefined();
    expect(output).toContain('[belief|proven] Strongest');
    expect(output).toContain('[belief|proven] Middle');
    expect(output).not.toContain('[belief|proven] Weakest');
  });

  it('returns undefined when there are no results', () => {
    expect(formatAppendSystemContext(createQueryResult([]), { maxTokens: 1500 })).toBeUndefined();
  });
});
