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

export interface PluginConfig {
  vaultPath: string;
  injection: InjectionConfig;
}

export interface HookMessage {
  role?: string;
  content?: unknown;
}

type EngineState =
  | { status: 'idle' }
  | { status: 'initializing'; promise: Promise<void> }
  | { status: 'ready'; index: VaultIndex }
  | { status: 'disabled'; reason: string };

const DEFAULT_INJECTION_CONFIG: InjectionConfig = {
  maxResults: 3,
  maxTokens: 1500,
  minScore: 0.3,
  minBm25Score: 0.1,
};

const FIXED_QUERY_MAX_RESULTS = 3;

const warnedKeys = new Set<string>();
let engineState: EngineState = { status: 'idle' };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function toFiniteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
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

  if ('vaultPath' in input || 'injection' in input) {
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

export function parseConfig(input: unknown): PluginConfig | undefined {
  const resolved = resolveConfigInput(input);
  if (!isRecord(resolved)) {
    return undefined;
  }

  const rawVaultPath = resolved.vaultPath;
  if (typeof rawVaultPath !== 'string' || rawVaultPath.trim() === '') {
    return undefined;
  }

  const injectionInput = isRecord(resolved.injection) ? resolved.injection : {};
  const config: PluginConfig = {
    vaultPath: normalizePath(rawVaultPath.trim()),
    injection: {
      maxResults: Math.max(1, Math.floor(toFiniteNumber(injectionInput.maxResults, DEFAULT_INJECTION_CONFIG.maxResults))),
      maxTokens: Math.max(1, Math.floor(toFiniteNumber(injectionInput.maxTokens, DEFAULT_INJECTION_CONFIG.maxTokens))),
      minScore: toFiniteNumber(injectionInput.minScore, DEFAULT_INJECTION_CONFIG.minScore),
      minBm25Score: toFiniteNumber(injectionInput.minBm25Score, DEFAULT_INJECTION_CONFIG.minBm25Score),
    },
  };

  return config;
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
  try {
    const stats = await stat(config.vaultPath);
    if (!stats.isDirectory()) {
      throw new Error('vaultPath is not a directory');
    }
  } catch {
    engineState = { status: 'disabled', reason: 'invalid-vault-path' };
    warnOnce(
      logger,
      'invalid-vault-path',
      `[vault-engine] invalid vaultPath "${config.vaultPath}". Disabling plugin.`
    );
    return;
  }

  try {
    const index = await rebuildIndex(config.vaultPath);
    const stats = index.getStats();
    if (stats.documentCount === 0) {
      warnOnce(
        logger,
        `empty-vault:${config.vaultPath}`,
        `[vault-engine] no markdown notes were indexed from "${config.vaultPath}". Plugin will stay enabled but inject no context until notes are available.`
      );
    }
    engineState = { status: 'ready', index };
  } catch (error) {
    engineState = { status: 'disabled', reason: 'engine-init-failed' };
    const reason = error instanceof Error ? error.message : String(error);
    warnOnce(
      logger,
      'engine-init-failed',
      `[vault-engine] failed to initialize vault engine (${reason}). Disabling plugin.`
    );
  }
}

function startInitialization(config: PluginConfig, logger: Logger | undefined): void {
  if (engineState.status !== 'idle') {
    return;
  }

  const promise = initializeEngine(config, logger);
  engineState = { status: 'initializing', promise };
}

export function disableForMissingConfig(logger: Logger | undefined): void {
  engineState = { status: 'disabled', reason: 'missing-vault-path' };
  warnOnce(
    logger,
    'missing-vault-path',
    '[vault-engine] missing or invalid config.vaultPath. Disabling plugin.'
  );
}

export function beginEngineInitialization(config: PluginConfig, logger: Logger | undefined): void {
  startInitialization(config, logger);
}

export function getReadyEngineIndex(): VaultIndex | undefined {
  if (engineState.status !== 'ready') {
    return undefined;
  }

  return engineState.index;
}

export async function ensureEngineReady(
  config: PluginConfig,
  logger: Logger | undefined
): Promise<VaultIndex | undefined> {
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

  return engineState.index;
}

export function runPassiveQuery(index: VaultIndex, userMessages: string[], config: PluginConfig): QueryResult {
  const queryText = userMessages[userMessages.length - 1];
  const context = userMessages.slice(-3).join('\n\n');

  return query(index, queryText, {
    maxResults: FIXED_QUERY_MAX_RESULTS,
    minScore: config.injection.minScore,
    minBm25Score: config.injection.minBm25Score,
    context,
  });
}

interface ToolQueryInput {
  query: string;
  maxResults?: number;
  noteTypes?: string[];
  context?: string;
}

export function runToolQuery(index: VaultIndex, input: ToolQueryInput): QueryResult {
  return query(index, input.query, {
    maxResults: input.maxResults,
    noteTypes: input.noteTypes as import('@ghostwater/vault-engine').NoteType[] | undefined,
    context: input.context,
  });
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
