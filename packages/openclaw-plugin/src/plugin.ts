import { stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve } from 'node:path';

import type { QueryResult, VaultIndex } from '@ghostwater/vault-engine';
import { query, rebuildIndex } from '@ghostwater/vault-engine';
import { definePluginEntry } from 'openclaw/plugin-sdk/plugin-entry';

import { formatAppendSystemContext } from './formatter.js';

interface Logger {
  warn?: (message: string) => void;
}

interface HookMessage {
  role?: string;
  content?: unknown;
}

interface BeforePromptBuildArgs {
  messages?: HookMessage[];
  config?: unknown;
  logger?: Logger;
}

interface HookResult {
  appendSystemContext?: string;
}

interface InjectionConfig {
  maxResults: number;
  maxTokens: number;
  minScore: number;
  minBm25Score: number;
}

interface PluginConfig {
  vaultPath: string;
  injection: InjectionConfig;
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

function parseConfig(input: unknown): PluginConfig | undefined {
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

function getUserMessages(messages: HookMessage[] | undefined): string[] {
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

function runQuery(index: VaultIndex, userMessages: string[], config: PluginConfig): QueryResult {
  const queryText = userMessages[userMessages.length - 1];
  const context = userMessages.slice(-3).join('\n\n');

  return query(index, queryText, {
    maxResults: FIXED_QUERY_MAX_RESULTS,
    minScore: config.injection.minScore,
    minBm25Score: config.injection.minBm25Score,
    context,
  });
}

async function beforePromptBuild(args: BeforePromptBuildArgs): Promise<HookResult | void> {
  const config = parseConfig(args.config);
  if (!config) {
    engineState = { status: 'disabled', reason: 'missing-vault-path' };
    warnOnce(
      args.logger,
      'missing-vault-path',
      '[vault-engine] missing or invalid config.vaultPath. Disabling plugin.'
    );
    return;
  }

  if (engineState.status === 'disabled') {
    return;
  }

  if (engineState.status === 'idle') {
    startInitialization(config, args.logger);
    return;
  }

  if (engineState.status === 'initializing') {
    return;
  }

  const userMessages = getUserMessages(args.messages);
  if (userMessages.length === 0) {
    return;
  }

  const result = runQuery(engineState.index, userMessages, config);
  const appendSystemContext = formatAppendSystemContext(result, {
    maxTokens: config.injection.maxTokens,
  });

  if (!appendSystemContext) {
    return;
  }

  return { appendSystemContext };
}

const configSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    vaultPath: { type: 'string', minLength: 1 },
    injection: {
      type: 'object',
      additionalProperties: false,
      properties: {
        maxResults: { type: 'integer', minimum: 1 },
        maxTokens: { type: 'integer', minimum: 1 },
        minScore: { type: 'number' },
        minBm25Score: { type: 'number' },
      },
    },
  },
} as const;

export const plugin = definePluginEntry({
  manifest: {
    name: 'vault-engine',
    version: '0.1.0',
    description: 'Injects vault retrieval context via before_prompt_build.',
    configSchema,
  },
  hooks: {
    before_prompt_build: beforePromptBuild,
  },
});

export const __testing = {
  resetState(): void {
    engineState = { status: 'idle' };
    warnedKeys.clear();
  },
  getState(): EngineState['status'] {
    return engineState.status;
  },
  getUserMessages,
  parseConfig,
};

export default plugin;
