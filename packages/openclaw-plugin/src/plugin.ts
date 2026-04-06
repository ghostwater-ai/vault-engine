import { definePluginEntry } from 'openclaw/plugin-sdk/plugin-entry';

import { formatAppendSystemContext } from './formatter.js';
import {
  __testing as runtimeTesting,
  beginEngineInitialization,
  disableForMissingConfig,
  evaluateSessionKeyScope,
  getReadyEngineIndex,
  getUserMessages,
  parseConfig,
  resolveSessionKey,
  runPassiveQuery,
} from './runtime.js';
import { registerVaultQueryTool } from './tool.js';

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
  sessionKey?: string;
  session?: { key?: string };
  runtime?: { sessionKey?: string };
}

interface HookResult {
  appendSystemContext?: string;
}

async function beforePromptBuild(args: BeforePromptBuildArgs): Promise<HookResult | void> {
  const config = parseConfig(args.config);
  if (!config) {
    disableForMissingConfig(args.logger);
    return;
  }

  const sessionScopeDecision = evaluateSessionKeyScope(config.scope, resolveSessionKey(args));
  if (!sessionScopeDecision.inScope) {
    return;
  }

  const state = runtimeTesting.getState();
  if (state === 'disabled') {
    return;
  }

  if (state === 'idle') {
    beginEngineInitialization(config, args.logger);
    return;
  }

  if (state === 'initializing') {
    return;
  }

  const readyIndex = getReadyEngineIndex();
  if (!readyIndex) {
    return;
  }

  const userMessages = getUserMessages(args.messages);
  if (userMessages.length === 0) {
    return;
  }

  const result = runPassiveQuery(readyIndex, userMessages, config);
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
    scope: {
      type: 'object',
      additionalProperties: false,
      properties: {
        allowSessionKeys: {
          type: 'array',
          items: { type: 'string', minLength: 1 },
        },
        denySessionKeys: {
          type: 'array',
          items: { type: 'string', minLength: 1 },
        },
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
  register(api: { registerTool: (tool: unknown) => void }): void {
    registerVaultQueryTool(api);
  },
  hooks: {
    before_prompt_build: beforePromptBuild,
  },
});

export const __testing = {
  resetState(): void {
    runtimeTesting.resetState();
  },
  getState() {
    return runtimeTesting.getState();
  },
  getUserMessages,
  parseConfig,
};

export default plugin;
