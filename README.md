# Vault Engine

> **Under Construction**: This project is in early development. APIs and features may change.

A retrieval engine that gives AI agents automatic access to a team's structured knowledge vault before every turn, using BM25 keyword search with epistemic scoring tuned to note types and confidence levels.

## Overview

Knowledge goes into vaults but never comes back out. Agents answer from their training data or hallucinate instead of consulting the team's actual beliefs, research, and experience. Vault Engine closes the loop: every agent turn gets relevant vault context injected into the system prompt — no explicit tool calls required.

## Features

- **BM25 Search**: Fast in-memory keyword search using MiniSearch
- **Epistemic Scoring**: Results ranked by note type and confidence level
- **Passive Injection**: Relevant context automatically injected into agent system prompts
- **Active Query Tool**: Agents can explicitly search the vault when needed
- **CLI**: Command-line interface for querying and managing the index

## Packages

- `@ghostwater/vault-engine` - Core retrieval engine
- `@ghostwater/vault-engine-openclaw` - OpenClaw plugin for agent integration

## Installation

```bash
npm install @ghostwater/vault-engine @ghostwater/vault-engine-openclaw
```

## CLI Usage

Set a vault path once:

```bash
export VAULT_PATH=~/projects/abidan-vault
```

Run a standard query:

```bash
vault query "what do we think about memory systems?"
```

Run a query with context and explain mode:

```bash
vault query "retrieval architecture" \
  --context "we were discussing memory systems and query latency" \
  --explain
```

Run a query with JSON output:

```bash
vault query "byterover" --json
```

Filter by note type and cap result count:

```bash
vault query "go to market" --types topic,research --max-results 5
```

Index management:

```bash
vault index stats
vault index rebuild
```

## OpenClaw Plugin Config

Install the plugin package:

```bash
npm install @ghostwater/vault-engine-openclaw
```

Configure OpenClaw to load the plugin and provide `vaultPath`:

```json
{
  "plugins": {
    "entries": {
      "vault-engine": {
        "enabled": true,
        "package": "@ghostwater/vault-engine-openclaw",
        "config": {
          "vaultPath": "/home/you/projects/abidan-vault",
          "injection": {
            "maxResults": 3,
            "maxTokens": 1500,
            "minScore": 0.3,
            "minBm25Score": 0.1
          }
        }
      }
    }
  }
}
```

Behavior:
- Uses `before_prompt_build` to inject retrieval context automatically.
- Registers the `vault_query` tool for explicit deeper retrieval.
- Shares one engine singleton between passive injection and tool calls.

## `vault_query` Tool Usage

Tool name: `vault_query`

Input contract:

```ts
{
  query: string;
  maxResults?: number;
  noteTypes?: string[];
  context?: string;
}
```

Invocation example:

```json
{
  "tool": "vault_query",
  "input": {
    "query": "What do we believe about memory systems?",
    "maxResults": 5,
    "noteTypes": ["belief", "research"],
    "context": "We were discussing retrieval architecture tradeoffs."
  }
}
```

Return value: full structured `QueryResult` from `@ghostwater/vault-engine`.

## Clean-Room Implementation Notice

This project is inspired by the ByteRover paper and implements similar concepts from the paper only. This is a clean-room implementation — no code has been copied, adapted, or derived from the ByteRover source code (which is licensed under Elastic License 2.0). Our code is fully original and licensed under Apache 2.0.

## Citation

This project is inspired by research from the ByteRover paper:

```bibtex
@article{byterover2026,
  title={ByteRover: Progressive Retrieval for Memory-Efficient LLM Agents},
  author={ByteRover Authors},
  journal={arXiv preprint arXiv:2604.01599},
  year={2026}
}
```

## License

Apache 2.0 - see [LICENSE](LICENSE) for details.
