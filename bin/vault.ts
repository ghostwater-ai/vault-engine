#!/usr/bin/env node

import { Command, InvalidArgumentError } from "commander";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import process from "node:process";
import {
  DEFAULT_QUERY_OPTIONS,
  rebuildIndex,
  query,
} from "@ghostwater/vault-engine";
import type { NoteType } from "@ghostwater/vault-engine";

const VERSION = "0.1.0";
const DRY_RUN_TOTAL_TOKEN_BUDGET = 1500;
const DRY_RUN_PER_RESULT_TOKEN_BUDGET = 400;
const DRY_RUN_MAX_RESULTS = 3;
const AVG_CHARS_PER_TOKEN = 4;
const OPENCLAW_PLUGIN_ENTRY_KEY = "vault-engine";
const DEFAULT_OPENCLAW_PLUGIN_PACKAGE = "@ghostwater/vault-engine-openclaw";
const DEFAULT_OPENCLAW_CONFIG_PATH = resolve(homedir(), ".openclaw", "openclaw.json");
const VALID_NOTE_TYPES = [
  "experience",
  "research",
  "belief",
  "entity",
  "bet",
  "question",
  "topic",
] as const;

function estimateTokens(text: string): number {
  return Math.ceil(text.length / AVG_CHARS_PER_TOKEN);
}

function parsePositiveInteger(value: string): number {
  const normalized = value.trim();
  if (!/^[1-9]\d*$/.test(normalized)) {
    throw new InvalidArgumentError(`Expected a positive integer, received: ${value}`);
  }

  const parsed = Number.parseInt(normalized, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new InvalidArgumentError(`Expected a positive integer, received: ${value}`);
  }
  return parsed;
}

function parseNonEmptyString(value: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new InvalidArgumentError("Expected a non-empty value.");
  }

  return normalized;
}

function collectStringValues(value: string, previous: string[]): string[] {
  return [...previous, parseNonEmptyString(value)];
}

function parseScore(value: string): number {
  const normalized = value.trim();
  if (!/^(\d+(\.\d+)?|\.\d+)$/.test(normalized)) {
    throw new InvalidArgumentError(`Expected a score between 0 and 1, received: ${value}`);
  }

  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    throw new InvalidArgumentError(`Expected a score between 0 and 1, received: ${value}`);
  }
  return parsed;
}

function normalizeNoteType(rawType: string): string | null {
  const normalized = rawType.trim().toLowerCase();
  if (!normalized) return null;

  const singular = normalized.endsWith("ies")
    ? `${normalized.slice(0, -3)}y`
    : normalized.endsWith("s")
      ? normalized.slice(0, -1)
      : normalized;
  if (VALID_NOTE_TYPES.includes(singular as (typeof VALID_NOTE_TYPES)[number])) {
    return singular;
  }

  return null;
}

function parseTypes(value: string): string[] {
  const parts = value.split(",");
  const parsed = new Set<string>();

  for (const part of parts) {
    const normalized = normalizeNoteType(part);
    if (!normalized) {
      throw new InvalidArgumentError(
        `Invalid note type: ${part.trim() || "(empty)"}. Valid types: ${VALID_NOTE_TYPES.join(", ")}`
      );
    }
    parsed.add(normalized);
  }

  return Array.from(parsed);
}

function resolveVaultPath(vaultPathOverride: string | undefined): string {
  const selectedPath = vaultPathOverride ?? process.env.VAULT_PATH;
  if (!selectedPath) {
    throw new Error(
      "Vault path is required. Provide --vault-path <path> or set VAULT_PATH in your environment."
    );
  }

  return resolve(selectedPath);
}

function resolveOpenClawConfigPath(configPathOverride: string | undefined): string {
  if (!configPathOverride) {
    return DEFAULT_OPENCLAW_CONFIG_PATH;
  }

  return resolve(configPathOverride);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function ensureRecord(parent: Record<string, unknown>, key: string): Record<string, unknown> {
  const existing = parent[key];
  if (isRecord(existing)) {
    return existing;
  }

  const next: Record<string, unknown> = {};
  parent[key] = next;
  return next;
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const normalized: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") {
      continue;
    }
    const trimmed = item.trim();
    if (!trimmed || normalized.includes(trimmed)) {
      continue;
    }
    normalized.push(trimmed);
  }

  return normalized;
}

function appendUnique(base: string[], values: string[]): string[] {
  const next = [...base];
  for (const value of values) {
    if (!next.includes(value)) {
      next.push(value);
    }
  }
  return next;
}

function renderJson(value: Record<string, unknown>): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

async function readOpenClawConfig(path: string): Promise<Record<string, unknown>> {
  try {
    const raw = await readFile(path, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) {
      throw new Error("OpenClaw config root must be a JSON object.");
    }
    return parsed;
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return {};
    }

    if (error instanceof Error) {
      throw new Error(`Failed to read OpenClaw config at ${path}: ${error.message}`);
    }
    throw error;
  }
}

function applyOpenClawPluginConfigUpdate(
  inputConfig: Record<string, unknown>,
  update: {
    packageName: string;
    vaultPath: string;
    allowSessionKeys: string[];
    denySessionKeys: string[];
  }
): Record<string, unknown> {
  const next = structuredClone(inputConfig);

  const plugins = ensureRecord(next, "plugins");
  const entries = ensureRecord(plugins, "entries");
  const entry = ensureRecord(entries, OPENCLAW_PLUGIN_ENTRY_KEY);
  entry.enabled = true;
  entry.package = update.packageName;

  const entryConfig = ensureRecord(entry, "config");
  entryConfig.vaultPath = update.vaultPath;

  const scope = ensureRecord(entryConfig, "scope");
  const allowSessionKeys = toStringArray(scope.allowSessionKeys);
  const denySessionKeys = toStringArray(scope.denySessionKeys);
  scope.allowSessionKeys = appendUnique(allowSessionKeys, update.allowSessionKeys);
  scope.denySessionKeys = appendUnique(denySessionKeys, update.denySessionKeys);

  return next;
}

function formatResultLine(result: (Awaited<ReturnType<typeof query>>) ["results"][number]): string {
  const status = result.doc.status ?? "unknown";
  const description = result.doc.description ? ` — ${result.doc.description}` : "";
  return `${result.score.toFixed(3)}  [${result.doc.noteType}|${status}] ${result.doc.title}${description}`;
}

function renderIndexStats(index: Awaited<ReturnType<typeof rebuildIndex>>): string {
  const stats = index.getStats();
  const typeEntries = Object.entries(stats.typeDistribution)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([type, count]) => `  - ${type}: ${count}`);

  const lines = [
    "Index stats:",
    `Document count: ${stats.documentCount}`,
    "Type distribution:",
    ...typeEntries,
    `Index size (bytes): ${stats.indexSizeBytes}`,
    `Last rebuild: ${stats.lastBuildTime || "unavailable"}`,
  ];

  return lines.join("\n");
}

function clampToTokenBudget(text: string, tokenBudget: number): string {
  if (estimateTokens(text) <= tokenBudget) {
    return text;
  }

  const maxChars = Math.max(0, tokenBudget * AVG_CHARS_PER_TOKEN - 3);
  return `${text.slice(0, maxChars).trimEnd()}...`;
}

function renderDryRun(results: (Awaited<ReturnType<typeof query>>) ["results"]): string {
  const blocks: string[] = [];
  let usedTokens = estimateTokens("## Vault Context\n");

  for (const result of results) {
    const status = result.doc.status ?? "unknown";
    const header = `[${result.doc.noteType}|${status}] ${result.doc.title}`;
    const rawDescription = result.doc.description ?? "";

    const maxDescriptionTokens = Math.max(
      0,
      DRY_RUN_PER_RESULT_TOKEN_BUDGET - estimateTokens(`${header}\n`)
    );
    const description = clampToTokenBudget(rawDescription, maxDescriptionTokens);
    const block = description ? `${header}\n${description}` : header;

    const blockTokens = estimateTokens(block);
    if (blockTokens > DRY_RUN_PER_RESULT_TOKEN_BUDGET) {
      continue;
    }

    if (usedTokens + blockTokens > DRY_RUN_TOTAL_TOKEN_BUDGET) {
      continue;
    }

    blocks.push(block);
    usedTokens += blockTokens;
  }

  if (blocks.length === 0) {
    return "";
  }

  const lines = ["## Vault Context", "", ...blocks.flatMap((block) => [block, ""])];
  lines.push(
    `Token estimate: ${usedTokens}/${DRY_RUN_TOTAL_TOKEN_BUDGET} (heuristic: ~1 token per ${AVG_CHARS_PER_TOKEN} chars)`
  );
  return lines.join("\n").trimEnd();
}

function renderExplainOutput(
  queryText: string,
  result: Awaited<ReturnType<typeof query>>,
  minScore: number,
  minBm25Score: number
): string {
  const lines: string[] = [];

  lines.push(`Query: ${queryText}`);
  lines.push(`Tier: ${result.tier}`);
  lines.push(`Latency: ${result.latencyMs.toFixed(2)}ms`);
  if (result.contextTerms && result.contextTerms.length > 0) {
    lines.push(`Context terms: ${result.contextTerms.join(", ")}`);
  }
  lines.push("");

  if (result.results.length === 0) {
    lines.push("No results passed threshold filters.");
    lines.push(`BM25 floor threshold: ${minBm25Score.toFixed(2)}`);
    lines.push(`Compound threshold: ${minScore.toFixed(2)}`);
    return lines.join("\n");
  }

  for (const [index, scored] of result.results.entries()) {
    lines.push(`${index + 1}. [${scored.doc.noteType}|${scored.doc.status ?? "unknown"}] ${scored.doc.title}`);
    lines.push(`   raw BM25: ${scored.bm25Raw.toFixed(4)}`);
    lines.push(`   normalized BM25: ${scored.bm25Normalized.toFixed(4)}`);
    lines.push(`   type boost: ${scored.typeBoost.toFixed(4)}`);
    lines.push(`   confidence modifier: ${scored.confidenceModifier.toFixed(4)}`);
    lines.push(`   context overlap: ${(scored.contextOverlap ?? 0).toFixed(4)}`);
    lines.push(`   BM25 floor status: passed (${scored.bm25Normalized.toFixed(4)} >= ${minBm25Score.toFixed(4)})`);
    lines.push(`   compound threshold status: passed (${scored.score.toFixed(4)} >= ${minScore.toFixed(4)})`);
    lines.push(`   final score: ${scored.score.toFixed(4)}`);
    lines.push(`   explanation: ${scored.explanation}`);
    lines.push("");
  }

  return lines.join("\n").trimEnd();
}

async function handleQuery(
  text: string,
  queryOptions: {
    json?: boolean;
    explain?: boolean;
    context?: string;
    types?: string[];
    maxResults?: number;
    minScore?: number;
    dryRun?: boolean;
  },
  command: Command
): Promise<void> {
  const globalOptions = command.parent?.opts<{ vaultPath?: string }>() ?? {};
  const opts = {
    ...queryOptions,
    ...globalOptions,
  } as {
    vaultPath?: string;
    json?: boolean;
    explain?: boolean;
    context?: string;
    types?: string[];
    maxResults?: number;
    minScore?: number;
    dryRun?: boolean;
  };

  const vaultPath = resolveVaultPath(opts.vaultPath);
  const index = await rebuildIndex(vaultPath);

  const minScore = opts.minScore ?? DEFAULT_QUERY_OPTIONS.minScore;
  const minBm25Score = DEFAULT_QUERY_OPTIONS.minBm25Score;
  const maxResults = opts.dryRun ? DRY_RUN_MAX_RESULTS : opts.maxResults;

  const result = query(index, text, {
    context: opts.context,
    maxResults,
    minScore: opts.minScore,
    noteTypes: opts.types as NoteType[] | undefined,
    minBm25Score,
  });

  if (opts.json) {
    console.log(JSON.stringify(result.results, null, 2));
    return;
  }

  if (opts.explain) {
    console.log(renderExplainOutput(text, result, minScore, minBm25Score));
    return;
  }

  if (opts.dryRun) {
    const output = renderDryRun(result.results);
    if (output) {
      console.log(output);
    }
    return;
  }

  console.log(`Query: ${result.query}`);
  console.log(`Tier: ${result.tier}`);
  console.log(`Latency: ${result.latencyMs.toFixed(2)}ms`);
  if (result.contextTerms && result.contextTerms.length > 0) {
    console.log(`Context terms: ${result.contextTerms.join(", ")}`);
  }
  console.log("");

  if (result.results.length === 0) {
    console.log("No results found.");
    return;
  }

  for (const scored of result.results) {
    console.log(formatResultLine(scored));
  }
}

async function handleIndexStats(command: Command): Promise<void> {
  const globalOptions = command.parent?.parent?.opts<{ vaultPath?: string }>() ?? {};
  const vaultPath = resolveVaultPath(globalOptions.vaultPath);
  const index = await rebuildIndex(vaultPath);
  console.log(renderIndexStats(index));
}

async function handleIndexRebuild(command: Command): Promise<void> {
  const globalOptions = command.parent?.parent?.opts<{ vaultPath?: string }>() ?? {};
  const vaultPath = resolveVaultPath(globalOptions.vaultPath);
  const index = await rebuildIndex(vaultPath);

  console.log("Rebuild complete.");
  console.log(renderIndexStats(index));
}

async function handleOpenClawInstall(
  options: {
    config?: string;
    vaultPath?: string;
    package?: string;
    allow: string[];
    deny: string[];
    dryRun?: boolean;
    print?: boolean;
  },
  command: Command
): Promise<void> {
  const globalOptions = command.parent?.parent?.opts<{ vaultPath?: string }>() ?? {};
  const resolvedVaultPath = options.vaultPath ?? globalOptions.vaultPath;
  if (!resolvedVaultPath) {
    throw new Error("OpenClaw vault path is required. Provide --vault-path <path>.");
  }

  const configPath = resolveOpenClawConfigPath(options.config);
  const currentConfig = await readOpenClawConfig(configPath);
  const nextConfig = applyOpenClawPluginConfigUpdate(currentConfig, {
    packageName: options.package ?? DEFAULT_OPENCLAW_PLUGIN_PACKAGE,
    vaultPath: parseNonEmptyString(resolvedVaultPath),
    allowSessionKeys: options.allow.map(parseNonEmptyString),
    denySessionKeys: options.deny.map(parseNonEmptyString),
  });

  const currentOutput = renderJson(currentConfig);
  const nextOutput = renderJson(nextConfig);
  const changed = currentOutput !== nextOutput;

  if (!options.dryRun && changed) {
    await mkdir(dirname(configPath), { recursive: true });
    await writeFile(configPath, nextOutput, "utf-8");
  }

  if (options.dryRun || options.print) {
    console.log(nextOutput.trimEnd());
    return;
  }

  console.log(changed ? `Updated ${configPath}` : `No changes needed: ${configPath}`);
}

async function main(): Promise<void> {
  const program = new Command();

  program
    .name("vault")
    .description("Retrieval engine for structured Markdown knowledge vaults")
    .version(VERSION)
    .option("--vault-path <path>", "Path to the vault directory (or use VAULT_PATH)");
  program.addHelpText(
    "after",
    `
Implemented query flags:
  --json
  --explain
  --context <text>
  --types <types>
  --max-results <count>
  --min-score <score>
  --dry-run

Implemented index subcommands:
  index stats
  index rebuild

Implemented OpenClaw subcommands:
  openclaw install --config <path> --vault-path <path> [--allow <session-key>] [--deny <session-key>] [--dry-run] [--print]`
  );

  program
    .command("query")
    .argument("<text>", "Search query text")
    .description("Search the vault for relevant documents")
    .option("--json", "Print raw structured JSON output")
    .option("--explain", "Print full scoring breakdown")
    .option("--context <text>", "Context string for tie-break reranking")
    .option("--types <types>", "Comma-separated note types", parseTypes)
    .option("--max-results <count>", "Maximum number of results", parsePositiveInteger)
    .option("--min-score <score>", "Minimum compound threshold (0..1)", parseScore)
    .option("--dry-run", "Render OpenClaw-style injection preview")
    .action((text, options, command) => handleQuery(text, options, command));

  const indexCommand = program.command("index").description("Index management commands");

  indexCommand
    .command("rebuild")
    .description("Force a full reindex of the vault")
    .action((_, command) => handleIndexRebuild(command));

  indexCommand
    .command("stats")
    .description("Show index statistics")
    .action((_, command) => handleIndexStats(command));

  const openClawCommand = program
    .command("openclaw")
    .description("OpenClaw plugin config bootstrap and update commands");

  openClawCommand
    .command("install")
    .description("Create or update OpenClaw plugin config for vault-engine")
    .option("--config <path>", "Path to openclaw.json", DEFAULT_OPENCLAW_CONFIG_PATH)
    .option("--vault-path <path>", "Vault path for plugins.entries.vault-engine.config.vaultPath")
    .option("--package <name>", "Plugin package name", DEFAULT_OPENCLAW_PLUGIN_PACKAGE)
    .option(
      "--allow <session-key>",
      "Append a session-key allow rule (repeat flag to add multiple)",
      collectStringValues,
      []
    )
    .option(
      "--deny <session-key>",
      "Append a session-key deny rule (repeat flag to add multiple)",
      collectStringValues,
      []
    )
    .option("--dry-run", "Print resulting config JSON without writing to disk")
    .option("--print", "Print resulting config JSON after applying changes")
    .action((options, command) => handleOpenClawInstall(options, command));

  try {
    await program.parseAsync(process.argv);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Error: ${message}`);
    process.exitCode = 1;
  }
}

void main();
