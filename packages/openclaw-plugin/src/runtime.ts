import { stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve } from 'node:path';

import type { QueryResult, VaultIndex } from '@ghostwater/vault-engine';
import { query, rebuildIndex } from '@ghostwater/vault-engine';

interface Logger {
  warn?: (message: string) => void;
}

interface InjectionConfig {
  maxResults: number;
  maxTokens: number;
  minScore: number;
  minBm25Score: number;
}

interface ScopeConfig {
  allowSessionKeys: string[];
  denySessionKeys: string[];
}

export type VaultMode = 'passive' | 'query-only';

export interface VaultConfig {
  name: string;
  description: string;
  vaultPath: string;
  mode: VaultMode;
  scope: ScopeConfig;
}

export interface PluginConfig {
  vaults: VaultConfig[];
  injection: InjectionConfig;
}

export interface ReadyVaultEngine {
  vault: VaultConfig;
  index: VaultIndex;
}

export interface HookMessage {
  role?: string;
  content?: unknown;
}

type EngineState =
  | { status: 'idle' }
  | { status: 'initializing'; promise: Promise<void> }
  | { status: 'ready'; vaults: ReadyVaultEngine[] }
  | { status: 'disabled'; reason: string };

const DEFAULT_INJECTION_CONFIG: InjectionConfig = {
  maxResults: 3,
  maxTokens: 1500,
  minScore: 0.3,
  minBm25Score: 0.1,
};

const DEFAULT_SCOPE_CONFIG: ScopeConfig = {
  allowSessionKeys: [],
  denySessionKeys: [],
};

const FIXED_QUERY_MAX_RESULTS = 3;
const LEGACY_DEFAULT_VAULT_NAME = 'default';
const LEGACY_DEFAULT_VAULT_DESCRIPTION = 'Legacy single-vault config';

const warnedKeys = new Set<string>();
let engineState: EngineState = { status: 'idle' };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function toFiniteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function toPatternList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const values: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') {
      continue;
    }

    const normalized = item.trim();
    if (!normalized) {
      continue;
    }

    values.push(normalized);
  }

  return values;
}

function normalizePath(vaultPath: string): string {
  if (vaultPath === '~') {
    return homedir();
  }

  if (vaultPath.startsWith('~/')) {
    return resolve(homedir(), vaultPath.slice(2));
  }

  return resolve(vaultPath);
}

function warnOnce(logger: Logger | undefined, key: string, message: string): void {
  if (warnedKeys.has(key)) {
    return;
  }

  warnedKeys.add(key);

  if (logger?.warn) {
    logger.warn(message);
    return;
  }

  console.warn(message);
}

function resolveConfigInput(input: unknown): unknown {
  if (!isRecord(input)) {
    return input;
  }

  if ('vaults' in input || 'vaultPath' in input || 'injection' in input || 'scope' in input) {
    return input;
  }

  const entries = input.plugins;
  if (!isRecord(entries)) {
    return input;
  }

  const pluginEntries = entries.entries;
  if (!isRecord(pluginEntries)) {
    return input;
  }

  const knownKeys = ['vault-engine', '@ghostwater/vault-engine-openclaw'];
  for (const key of knownKeys) {
    const entry = pluginEntries[key];
    if (!isRecord(entry)) {
      continue;
    }

    const config = entry.config;
    if (isRecord(config)) {
      return config;
    }
  }

  return input;
}

function normalizeScopeConfig(input: unknown): ScopeConfig {
  const scopeInput = isRecord(input) ? input : {};
  return {
    allowSessionKeys: toPatternList(scopeInput.allowSessionKeys ?? DEFAULT_SCOPE_CONFIG.allowSessionKeys),
    denySessionKeys: toPatternList(scopeInput.denySessionKeys ?? DEFAULT_SCOPE_CONFIG.denySessionKeys),
  };
}

function asNonEmptyTrimmedString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function parseVaultEntry(value: unknown): VaultConfig | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const name = asNonEmptyTrimmedString(value.name);
  const description = asNonEmptyTrimmedString(value.description);
  const rawVaultPath = asNonEmptyTrimmedString(value.vaultPath);
  const mode = value.mode;
  if (!name || !description || !rawVaultPath || (mode !== 'passive' && mode !== 'query-only')) {
    return undefined;
  }

  return {
    name,
    description,
    vaultPath: normalizePath(rawVaultPath),
    mode,
    scope: normalizeScopeConfig(value.scope),
  };
}

function parseLegacySingleVaultConfig(value: Record<string, unknown>): VaultConfig | undefined {
  const rawVaultPath = asNonEmptyTrimmedString(value.vaultPath);
  if (!rawVaultPath) {
    return undefined;
  }

  return {
    name: LEGACY_DEFAULT_VAULT_NAME,
    description: LEGACY_DEFAULT_VAULT_DESCRIPTION,
    vaultPath: normalizePath(rawVaultPath),
    mode: 'passive',
    scope: normalizeScopeConfig(value.scope),
  };
}

export function parseConfig(input: unknown): PluginConfig | undefined {
  const resolved = resolveConfigInput(input);
  if (!isRecord(resolved)) {
    return undefined;
  }

  const injectionInput = isRecord(resolved.injection) ? resolved.injection : {};

  let vaults: VaultConfig[] | undefined;
  if (Array.isArray(resolved.vaults)) {
    if (resolved.vaults.length === 0) {
      return undefined;
    }

    const parsedVaults: VaultConfig[] = [];
    const seenVaultNames = new Set<string>();
    for (const rawVault of resolved.vaults) {
      const parsedVault = parseVaultEntry(rawVault);
      if (!parsedVault) {
        return undefined;
      }
      if (seenVaultNames.has(parsedVault.name)) {
        return undefined;
      }
      seenVaultNames.add(parsedVault.name);
      parsedVaults.push(parsedVault);
    }

    vaults = parsedVaults;
  } else {
    const legacyVault = parseLegacySingleVaultConfig(resolved);
    if (!legacyVault) {
      return undefined;
    }
    vaults = [legacyVault];
  }

  return {
    vaults,
    injection: {
      maxResults: Math.max(1, Math.floor(toFiniteNumber(injectionInput.maxResults, DEFAULT_INJECTION_CONFIG.maxResults))),
      maxTokens: Math.max(1, Math.floor(toFiniteNumber(injectionInput.maxTokens, DEFAULT_INJECTION_CONFIG.maxTokens))),
      minScore: toFiniteNumber(injectionInput.minScore, DEFAULT_INJECTION_CONFIG.minScore),
      minBm25Score: toFiniteNumber(injectionInput.minBm25Score, DEFAULT_INJECTION_CONFIG.minBm25Score),
    },
  };
}

function globToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`);
}

function findMatchingPattern(patterns: string[], sessionKey: string): string | undefined {
  for (const pattern of patterns) {
    if (globToRegExp(pattern).test(sessionKey)) {
      return pattern;
    }
  }

  return undefined;
}

export type SessionScopeDecision =
  | { inScope: true; reason: 'no-scope-rules' | 'allowed-by-rule' | 'default-allow-no-allowlist'; matchedPattern?: string }
  | { inScope: false; reason: 'missing-session-key' | 'denied-by-rule' | 'default-deny-allowlist'; matchedPattern?: string };

export function evaluateSessionKeyScope(scope: ScopeConfig, sessionKey: string | undefined): SessionScopeDecision {
  const hasAllowRules = scope.allowSessionKeys.length > 0;
  const hasDenyRules = scope.denySessionKeys.length > 0;
  if (!hasAllowRules && !hasDenyRules) {
    return { inScope: true, reason: 'no-scope-rules' };
  }

  if (!sessionKey) {
    return { inScope: false, reason: 'missing-session-key' };
  }

  const denyMatch = findMatchingPattern(scope.denySessionKeys, sessionKey);
  if (denyMatch) {
    return { inScope: false, reason: 'denied-by-rule', matchedPattern: denyMatch };
  }

  if (hasAllowRules) {
    const allowMatch = findMatchingPattern(scope.allowSessionKeys, sessionKey);
    if (!allowMatch) {
      return { inScope: false, reason: 'default-deny-allowlist' };
    }
    return { inScope: true, reason: 'allowed-by-rule', matchedPattern: allowMatch };
  }

  return { inScope: true, reason: 'default-allow-no-allowlist' };
}

function asNonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

export function resolveSessionKey(input: unknown): string | undefined {
  if (!isRecord(input)) {
    return undefined;
  }

  const directSessionKey = asNonEmptyString(input.sessionKey);
  if (directSessionKey) {
    return directSessionKey;
  }

  const session = input.session;
  if (isRecord(session)) {
    const sessionKey = asNonEmptyString(session.key);
    if (sessionKey) {
      return sessionKey;
    }
  }

  const runtime = input.runtime;
  if (isRecord(runtime)) {
    const runtimeSessionKey = asNonEmptyString(runtime.sessionKey);
    if (runtimeSessionKey) {
      return runtimeSessionKey;
    }
  }

  return undefined;
}

function messageContentToText(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }

  if (!Array.isArray(content)) {
    return '';
  }

  const parts: string[] = [];
  for (const part of content) {
    if (typeof part === 'string') {
      parts.push(part);
      continue;
    }

    if (!isRecord(part)) {
      continue;
    }

    const text = part.text;
    if (typeof text === 'string') {
      parts.push(text);
    }
  }

  return parts.join('\n');
}

export function getUserMessages(messages: HookMessage[] | undefined): string[] {
  if (!messages || messages.length === 0) {
    return [];
  }

  const userMessages: string[] = [];
  for (const message of messages) {
    if (message.role !== 'user') {
      continue;
    }

    const text = messageContentToText(message.content).trim();
    if (!text) {
      continue;
    }

    userMessages.push(text);
  }

  return userMessages;
}

async function initializeEngine(config: PluginConfig, logger: Logger | undefined): Promise<void> {
  const readyVaults: ReadyVaultEngine[] = [];

  for (const vault of config.vaults) {
    try {
      const stats = await stat(vault.vaultPath);
      if (!stats.isDirectory()) {
        throw new Error('vaultPath is not a directory');
      }
    } catch {
      warnOnce(
        logger,
        `invalid-vault-path:${vault.vaultPath}`,
        `[vault-engine] invalid vaultPath for vault "${vault.name}": "${vault.vaultPath}". Skipping this vault.`
      );
      continue;
    }

    try {
      const index = await rebuildIndex(vault.vaultPath);
      const stats = index.getStats();
      if (stats.documentCount === 0) {
        warnOnce(
          logger,
          `empty-vault:${vault.vaultPath}`,
          `[vault-engine] no markdown notes were indexed from vault "${vault.name}" at "${vault.vaultPath}". It will stay enabled but return no results until notes are available.`
        );
      }

      readyVaults.push({ vault, index });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      warnOnce(
        logger,
        `engine-init-failed:${vault.vaultPath}`,
        `[vault-engine] failed to initialize vault "${vault.name}" (${reason}). Skipping this vault.`
      );
    }
  }

  if (readyVaults.length === 0) {
    engineState = { status: 'disabled', reason: 'no-ready-vaults' };
    return;
  }

  engineState = { status: 'ready', vaults: readyVaults };
}

function startInitialization(config: PluginConfig, logger: Logger | undefined): void {
  if (engineState.status !== 'idle') {
    return;
  }

  const promise = initializeEngine(config, logger);
  engineState = { status: 'initializing', promise };
}

export function disableForMissingConfig(logger: Logger | undefined): void {
  warnOnce(
    logger,
    'missing-vault-config',
    '[vault-engine] missing or invalid config.vaults (or legacy config.vaultPath). Skipping vault context/tool for this call.'
  );
}

export function beginEngineInitialization(config: PluginConfig, logger: Logger | undefined): void {
  startInitialization(config, logger);
}

export function getReadyEngineVaults(): ReadyVaultEngine[] | undefined {
  if (engineState.status !== 'ready') {
    return undefined;
  }

  return engineState.vaults;
}

export async function ensureEngineReady(
  config: PluginConfig,
  logger: Logger | undefined
): Promise<ReadyVaultEngine[] | undefined> {
  if (engineState.status === 'disabled') {
    return undefined;
  }

  if (engineState.status === 'idle') {
    startInitialization(config, logger);
  }

  if (engineState.status === 'initializing') {
    await engineState.promise;
  }

  if (engineState.status !== 'ready') {
    return undefined;
  }

  return engineState.vaults;
}

function mergeQueryResults(queryText: string, results: QueryResult[], maxResults: number): QueryResult {
  const merged = results
    .flatMap((result) => result.results)
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(1, Math.floor(maxResults)));

  const tier = results.length > 0 ? Math.min(...results.map((result) => result.tier)) : 0;
  const latencyMs = results.reduce((total, result) => total + result.latencyMs, 0);

  return {
    results: merged,
    tier,
    latencyMs,
    query: queryText,
  };
}

function filterEligibleVaults(
  readyVaults: ReadyVaultEngine[],
  sessionKey: string | undefined,
  options?: { mode?: VaultMode; name?: string }
): ReadyVaultEngine[] {
  return readyVaults.filter((readyVault) => {
    if (options?.mode && readyVault.vault.mode !== options.mode) {
      return false;
    }

    if (options?.name && readyVault.vault.name !== options.name) {
      return false;
    }

    const scopeDecision = evaluateSessionKeyScope(readyVault.vault.scope, sessionKey);
    return scopeDecision.inScope;
  });
}

export function runPassiveQuery(
  readyVaults: ReadyVaultEngine[],
  userMessages: string[],
  config: PluginConfig,
  sessionKey: string | undefined
): QueryResult {
  const queryText = userMessages[userMessages.length - 1];
  const context = userMessages.slice(-3).join('\n\n');
  const passiveVaults = filterEligibleVaults(readyVaults, sessionKey, { mode: 'passive' });

  if (passiveVaults.length === 0) {
    return {
      results: [],
      tier: 0,
      latencyMs: 0,
      query: queryText,
    };
  }

  const results = passiveVaults.map((readyVault) =>
    query(readyVault.index, queryText, {
      maxResults: FIXED_QUERY_MAX_RESULTS,
      minScore: config.injection.minScore,
      minBm25Score: config.injection.minBm25Score,
      context,
    })
  );

  return mergeQueryResults(queryText, results, config.injection.maxResults);
}

interface ToolQueryInput {
  query: string;
  maxResults?: number;
  noteTypes?: string[];
  context?: string;
  vault?: string;
}

export function getEligibleVaultsForTool(
  readyVaults: ReadyVaultEngine[],
  sessionKey: string | undefined,
  requestedVaultName?: string
): { vaults: ReadyVaultEngine[]; reason?: SessionScopeDecision['reason'] | 'vault-not-found' } {
  const normalizedName = requestedVaultName?.trim();
  if (normalizedName) {
    const matchingVault = readyVaults.find((readyVault) => readyVault.vault.name === normalizedName);
    if (!matchingVault) {
      return { vaults: [], reason: 'vault-not-found' };
    }

    const decision = evaluateSessionKeyScope(matchingVault.vault.scope, sessionKey);
    if (!decision.inScope) {
      return { vaults: [], reason: decision.reason };
    }

    return { vaults: [matchingVault] };
  }

  const eligibleVaults = filterEligibleVaults(readyVaults, sessionKey);
  if (eligibleVaults.length > 0) {
    return { vaults: eligibleVaults };
  }

  const hadScopeRules = readyVaults.some(
    (readyVault) =>
      readyVault.vault.scope.allowSessionKeys.length > 0 || readyVault.vault.scope.denySessionKeys.length > 0
  );

  if (!hadScopeRules) {
    return { vaults: [] };
  }

  if (!sessionKey) {
    return { vaults: [], reason: 'missing-session-key' };
  }

  return { vaults: [], reason: 'default-deny-allowlist' };
}

export function runToolQuery(readyVaults: ReadyVaultEngine[], input: ToolQueryInput): QueryResult {
  const results = readyVaults.map((readyVault) =>
    query(readyVault.index, input.query, {
      maxResults: input.maxResults,
      noteTypes: input.noteTypes as import('@ghostwater/vault-engine').NoteType[] | undefined,
      context: input.context,
    })
  );

  return mergeQueryResults(input.query, results, input.maxResults ?? FIXED_QUERY_MAX_RESULTS);
}

export const __testing = {
  resetState(): void {
    engineState = { status: 'idle' };
    warnedKeys.clear();
  },
  getState(): EngineState['status'] {
    return engineState.status;
  },
};
