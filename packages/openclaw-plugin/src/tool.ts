import type { QueryResult } from '@ghostwater/vault-engine';

import {
  ensureEngineReady,
  getEligibleVaultsForTool,
  parseConfig,
  resolveSessionKey,
  runToolQuery,
  disableForMissingConfig,
} from './runtime.js';

interface Logger {
  warn?: (message: string) => void;
}

interface VaultQueryToolInput {
  query: string;
  maxResults?: number;
  noteTypes?: string[];
  context?: string;
  vault?: string;
}

interface ToolExecutionContext {
  config?: unknown;
  logger?: Logger;
  sessionKey?: string;
  session?: { key?: string };
  runtime?: { sessionKey?: string };
}

interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: unknown;
  execute: (requestId: string, input: VaultQueryToolInput, context?: ToolExecutionContext) => Promise<QueryResult>;
}

interface ToolRegisterApi {
  registerTool: (tool: ToolDefinition) => void;
}

export const VAULT_QUERY_TOOL_DESCRIPTION =
  "Search the knowledge vault for specific information. Use when passive vault context isn't sufficient or you need to explore a topic in depth.";

export function registerVaultQueryTool(api: ToolRegisterApi): void {
  api.registerTool({
    name: 'vault_query',
    description: VAULT_QUERY_TOOL_DESCRIPTION,
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['query'],
      properties: {
        query: { type: 'string', minLength: 1 },
        maxResults: { type: 'integer', minimum: 1 },
        noteTypes: {
          type: 'array',
          items: { type: 'string' },
        },
        context: { type: 'string' },
        vault: { type: 'string', minLength: 1 },
      },
    },
    async execute(_requestId: string, input: VaultQueryToolInput, context?: ToolExecutionContext): Promise<QueryResult> {
      const config = parseConfig(context?.config);
      if (!config) {
        disableForMissingConfig(context?.logger);
        throw new Error('vault_query requires a valid plugin config with vaults');
      }

      const readyVaults = await ensureEngineReady(config, context?.logger);
      if (!readyVaults) {
        throw new Error('vault_query unavailable: vault engine is disabled or failed to initialize');
      }

      const sessionKey = resolveSessionKey(context);
      const eligible = getEligibleVaultsForTool(readyVaults, sessionKey, input.vault);
      if (eligible.vaults.length === 0) {
        if (eligible.reason === 'vault-not-found') {
          throw new Error(`vault_query unavailable: unknown vault "${input.vault}"`);
        }
        if (eligible.reason === 'missing-session-key') {
          throw new Error('vault_query unavailable: session key is required when scope rules are configured');
        }
        throw new Error('vault_query unavailable: current session is out of scope');
      }

      return runToolQuery(eligible.vaults, input);
    },
  });
}
