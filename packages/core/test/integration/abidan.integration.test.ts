import { constants } from 'node:fs';
import { access, mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { execSync, spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, type TestContext } from 'vitest';

import { query, rebuildIndex } from '../../src/index.js';
import { formatAppendSystemContext } from '../../../openclaw-plugin/src/formatter.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = resolve(__dirname, '../../../../');
const distBinPath = join(rootDir, 'dist', 'bin', 'vault.js');
const ABIDAN_VAULT_PATH = resolve(homedir(), 'projects/abidan-vault');
const MIN_BM25_SCORE = 0.1;
const MIN_COMPOUND_SCORE = 0.3;
const TOKEN_BUDGET = 1500;

let cliBuilt = false;
let availabilityPromise: Promise<{ available: boolean; reason: string }> | undefined;
let abidanIndexPromise: Promise<Awaited<ReturnType<typeof rebuildIndex>>> | undefined;

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function splitArgs(args: string): string[] {
  return args.match(/(?:[^\s"]+|"[^"]*")+/g)?.map((token) => token.replace(/^"|"$/g, '')) ?? [];
}

function runCli(args: string): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync('node', [distBinPath, ...splitArgs(args)], {
    cwd: rootDir,
    encoding: 'utf-8',
    env: process.env,
  });

  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function toSearchableText(input: { title: string; description?: string; path: string; rawBody?: string }): string {
  return `${input.title} ${input.description ?? ''} ${input.path} ${input.rawBody ?? ''}`.toLowerCase();
}

function assertScoringInvariants(result: ReturnType<typeof query>): void {
  expect(result.results.length).toBeGreaterThan(0);

  for (const item of result.results) {
    expect(item.explanation.trim().length).toBeGreaterThan(0);
    expect(item.bm25Normalized).toBeGreaterThanOrEqual(MIN_BM25_SCORE);
    expect(item.score).toBeGreaterThanOrEqual(MIN_COMPOUND_SCORE);
  }
}

function ensureCliBuilt(): void {
  if (cliBuilt) {
    return;
  }

  execSync('pnpm build', {
    cwd: rootDir,
    encoding: 'utf-8',
    stdio: 'pipe',
  });
  cliBuilt = true;
}

async function getAbidanVaultAvailability(): Promise<{ available: boolean; reason: string }> {
  if (!availabilityPromise) {
    availabilityPromise = (async () => {
      try {
        const metadata = await stat(ABIDAN_VAULT_PATH);
        if (!metadata.isDirectory()) {
          return {
            available: false,
            reason: `integration requires a directory at ${ABIDAN_VAULT_PATH}; found a non-directory path`,
          };
        }

        await access(ABIDAN_VAULT_PATH, constants.R_OK);
        return { available: true, reason: '' };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          available: false,
          reason: `integration requires readable Abidan vault at ${ABIDAN_VAULT_PATH}; skipping: ${message}`,
        };
      }
    })();
  }

  return availabilityPromise;
}

async function skipIfNoAbidanVault(context: TestContext): Promise<void> {
  const availability = await getAbidanVaultAvailability();
  if (!availability.available) {
    context.skip(availability.reason);
  }
}

async function getAbidanIndex(context: TestContext): Promise<Awaited<ReturnType<typeof rebuildIndex>>> {
  await skipIfNoAbidanVault(context);
  if (!abidanIndexPromise) {
    abidanIndexPromise = rebuildIndex(ABIDAN_VAULT_PATH);
  }

  return abidanIndexPromise;
}

describe('integration: Abidan vault retrieval and CLI', () => {
  it('integration: known query "memory systems" returns memory-focused belief/research results with scoring invariants', async (context) => {
    const index = await getAbidanIndex(context);
    const result = query(index, 'memory systems');
    assertScoringInvariants(result);

    expect(result.results.some((item) => item.doc.noteType === 'belief' || item.doc.noteType === 'research')).toBe(true);
    expect(result.results.some((item) => toSearchableText(item.doc).includes('memory'))).toBe(true);
  });

  it('integration: known query "what do we think about retrieval" returns retrieval-focused belief/research results', async (context) => {
    const index = await getAbidanIndex(context);
    const result = query(index, 'what do we think about retrieval');
    assertScoringInvariants(result);

    expect(result.results.some((item) => item.doc.noteType === 'belief' || item.doc.noteType === 'research')).toBe(true);
    expect(result.results.some((item) => toSearchableText(item.doc).includes('retrieval'))).toBe(true);
  });

  it('integration: known query "byterover" returns ByteRover research result', async (context) => {
    const index = await getAbidanIndex(context);
    const result = query(index, 'byterover');
    assertScoringInvariants(result);

    expect(result.results.some((item) => item.doc.noteType === 'research')).toBe(true);
    expect(result.results.some((item) => toSearchableText(item.doc).includes('byterover'))).toBe(true);
  });

  it('integration: known query marketing/GTM surfaces topic page(s)', async (context) => {
    const index = await getAbidanIndex(context);
    const marketing = query(index, 'marketing', { noteTypes: ['topic'] });
    const gtm = query(index, 'GTM', { noteTypes: ['topic'] });

    const combined = [...marketing.results, ...gtm.results];
    expect(combined.length).toBeGreaterThan(0);
    for (const item of combined) {
      expect(item.explanation.trim().length).toBeGreaterThan(0);
      expect(item.bm25Normalized).toBeGreaterThanOrEqual(MIN_BM25_SCORE);
      expect(item.score).toBeGreaterThanOrEqual(MIN_COMPOUND_SCORE);
    }

    expect(combined.every((item) => item.doc.noteType === 'topic')).toBe(true);
    expect(combined.some((item) => /marketing|gtm/i.test(toSearchableText(item.doc)))).toBe(true);
  });

  it('integration: unrelated query "quantum physics" returns no results', async (context) => {
    const index = await getAbidanIndex(context);
    const result = query(index, 'quantum physics', { minScore: 1.0 });
    expect(result.results).toHaveLength(0);
  });

  it('integration: formatted injection output is within 1500-token budget', async (context) => {
    const index = await getAbidanIndex(context);
    const result = query(index, 'memory systems');
    assertScoringInvariants(result);

    const formatted = formatAppendSystemContext(result, { maxTokens: TOKEN_BUDGET });
    expect(formatted).toBeTypeOf('string');
    expect(formatted).toContain('## Vault Context');
    expect(estimateTokens(formatted ?? '')).toBeLessThanOrEqual(TOKEN_BUDGET);
  });

  it('integration: deterministic ordering keeps belief above experience for controlled near-tie BM25 matches', async (context) => {
    await skipIfNoAbidanVault(context);

    const tempVault = await mkdtemp(join(tmpdir(), 'vault-engine-integration-'));
    await mkdir(join(tempVault, 'beliefs'), { recursive: true });
    await mkdir(join(tempVault, 'experiences'), { recursive: true });

    const body = '# retrieval memory tie\n\nretrieval architecture memory system tie breaker.';

    await writeFile(
      join(tempVault, 'beliefs', 'tie-belief.md'),
      `---\ntype: belief\nstatus: stable\n---\n${body}\n`,
      'utf-8'
    );

    await writeFile(
      join(tempVault, 'experiences', 'tie-experience.md'),
      `---\ntype: experience\nstatus: completed\n---\n${body}\n`,
      'utf-8'
    );

    try {
      const index = await rebuildIndex(tempVault);
      const result = query(index, 'retrieval memory tie', {
        maxResults: 2,
        minScore: 0,
        minBm25Score: 0,
      });

      expect(result.results.length).toBeGreaterThanOrEqual(2);
      expect(result.results[0]?.doc.noteType).toBe('belief');
      expect(result.results[1]?.doc.noteType).toBe('experience');
      expect(result.results[0]?.bm25Normalized).toBeGreaterThanOrEqual(result.results[1]?.bm25Normalized ?? 0);
      expect(result.results[0]?.score).toBeGreaterThan(result.results[1]?.score ?? 0);
    } finally {
      await rm(tempVault, { recursive: true, force: true });
    }
  });

  it('integration: CLI e2e query --explain works against Abidan vault', async (context) => {
    await skipIfNoAbidanVault(context);
    ensureCliBuilt();

    const explain = runCli(`query "memory systems" --vault-path "${ABIDAN_VAULT_PATH}" --explain`);
    expect(explain.status).toBe(0);
    expect(explain.stdout).toContain('Query: memory systems');
    expect(explain.stdout).toContain('raw BM25:');
    expect(explain.stdout).toContain('normalized BM25:');
    expect(explain.stdout).toContain('explanation:');
  });

  it('integration: CLI e2e query --json works against Abidan vault', async (context) => {
    await skipIfNoAbidanVault(context);
    ensureCliBuilt();

    const json = runCli(`query "byterover" --vault-path "${ABIDAN_VAULT_PATH}" --json`);
    expect(json.status).toBe(0);

    const parsed = JSON.parse(json.stdout) as Array<{
      score: number;
      bm25Normalized: number;
      explanation: string;
      doc: { title: string; description?: string; noteType: string };
    }>;

    expect(parsed.length).toBeGreaterThan(0);
    expect(parsed.some((item) => item.doc.noteType === 'research')).toBe(true);
    expect(parsed.some((item) => /byterover/i.test(`${item.doc.title} ${item.doc.description ?? ''}`))).toBe(true);
    for (const item of parsed) {
      expect(item.explanation.trim().length).toBeGreaterThan(0);
      expect(item.bm25Normalized).toBeGreaterThanOrEqual(MIN_BM25_SCORE);
      expect(item.score).toBeGreaterThanOrEqual(MIN_COMPOUND_SCORE);
    }
  });
});
