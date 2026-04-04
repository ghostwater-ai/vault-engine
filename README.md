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
npm install @ghostwater/vault-engine
```

## Usage

```bash
# Query the vault
vault query "what do we think about memory systems?"

# Show index statistics
vault index stats
```

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
