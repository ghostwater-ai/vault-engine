---
shaping: true
---

# Spike: OpenClaw Plugin Integration Path

## Context

We need vault retrieval to inject context into the system prompt before every
agent turn. The question is which OpenClaw plugin mechanism to use.

## Goal

Determine the right integration architecture for vault-engine given OpenClaw's
plugin slot model, existing LCM usage, and our requirements.

## Findings

### OpenClaw Plugin Slots (Exclusive)

Two exclusive plugin slots exist:

1. **`plugins.slots.contextEngine`** — owns session context orchestration
   (ingest, assemble, compact). Currently occupied by LCM (`lossless-claw`).
   The slot is exclusive: "only one registered context engine is resolved for
   a given run." Other plugins can load but won't be selected.

2. **`plugins.slots.memory`** — owns memory search/retrieval
   (`memory_search`, `memory_get` tools). Default: `memory-core` (builtin
   SQLite + BM25 + optional embeddings). Can be swapped for QMD or Honcho.

### Context Engine Slot (What LCM Uses)

The context engine has the richest pre-turn surface:

- `assemble()` — called before every model run, returns messages + estimated
  tokens + optional `systemPromptAddition` string
- `systemPromptAddition` — prepended to system prompt. This is exactly where
  we'd want vault retrieval results injected.
- Also owns `ingest()`, `compact()`, `afterTurn()`

**Problem:** Slot is exclusive. LCM already occupies it. We can't register a
second context engine.

### Memory Plugin Slot

The memory slot provides:

- `memory_search` tool — agent-callable search across indexed markdown files
- `memory_get` tool — read specific memory files
- `memorySearch.extraPaths` — index additional directories beyond workspace
- Builtin engine: SQLite FTS5 (BM25) + optional vector embeddings
- Supports hybrid search (BM25 + vector), temporal decay, MMR diversity
- File watcher for reindexing on changes

**Key capability:** `extraPaths` lets us point the memory engine at the vault
directory (`~/projects/abidan-vault/`). The builtin engine would then index all
vault markdown files and make them searchable via `memory_search`.

**Limitation:** Memory plugin provides *tools* (agent-callable), not automatic
pre-turn injection. The agent has to explicitly call `memory_search`. This
doesn't satisfy R0 ("agents get relevant vault context before acting, without
explicit tool calls").

### Plugin Hooks (The Third Path)

`before_prompt_build` is a plugin hook that runs after session load and before
prompt submission. It can inject:

- `prependContext` — per-turn dynamic text injected into context
- `systemPrompt` — replace entire system prompt (destructive, don't use)
- `prependSystemContext` — stable guidance in system prompt space
- `appendSystemContext` — appended to system prompt

**This is not slot-exclusive.** Any plugin can register a `before_prompt_build`
hook. It coexists with LCM's context engine and the memory plugin.

The hook receives `messages` (session history), which means we can read the
latest user message. We'd need to check if session summary / LCM context is
accessible from this hook's params.

Honcho (a memory plugin) already uses `before_prompt_build` for pre-turn
context injection — exactly our pattern.

### How Each Path Satisfies Requirements

| Requirement | Context Engine | Memory Slot | before_prompt_build Hook |
|-------------|:-:|:-:|:-:|
| R0: Auto-inject without tool calls | ✅ (systemPromptAddition) | ❌ (tool-only) | ✅ (prependContext) |
| Coexists with LCM | ❌ (exclusive slot) | ✅ | ✅ |
| Coexists with memory-core | ✅ | ❌ (exclusive slot) | ✅ |
| Access to session messages | ✅ (assemble gets messages) | N/A | ✅ (hook gets messages) |
| Pre-turn timing | ✅ | N/A | ✅ |
| Can inject into system prompt | ✅ | N/A | ✅ (appendSystemContext) |

## Recommendation: `before_prompt_build` Hook Plugin

**Use a standalone tool/hook plugin (not a slot plugin) that registers:**

1. A `before_prompt_build` hook for passive injection (Tier 0-2 retrieval →
   `appendSystemContext`)
2. A `vault_query` tool for active deep retrieval (agent-callable)

This is the only path that:
- Coexists with LCM in the context engine slot
- Coexists with memory-core in the memory slot
- Provides automatic pre-turn injection without agent tool calls
- Has access to session messages for query context

### Architecture

```
OpenClaw Gateway
├── Context Engine Slot: lossless-claw (LCM) — owns compaction/assembly
├── Memory Slot: memory-core — owns memory_search/memory_get
└── Plugin: vault-engine — hook-only + tool
    ├── before_prompt_build hook → runs Tier 0-2 → appendSystemContext
    └── vault_query tool → runs all tiers → structured results
```

### Session Summary Access

The `before_prompt_build` hook receives `messages`. We can derive conversation
context from the recent message history rather than needing direct LCM summary
access. For MVP, the latest user message is the primary query; recent assistant
messages provide topical grounding. This is functionally equivalent to using the
session summary — the messages themselves *are* the context.

If we later need the actual LCM summary, we can explore whether LCM exposes it
via a runtime helper or file. But messages-based context is sufficient for MVP.

### Plugin Config Pattern

```json5
// openclaw.json
{
  plugins: {
    entries: {
      "vault-engine": {
        enabled: true,
        config: {
          vaultPath: "~/projects/abidan-vault",
          injection: {
            maxResults: 3,
            maxTokens: 1500,
            minScore: 0.3
          }
        }
      }
    }
  }
}
```

Vault path goes in plugin config. No env var needed — the plugin config is the
right place since it's operator-controlled and per-installation.

CLI (`vault query`, `vault index`) reads the same config or accepts
`--vault-path` flag override for standalone use outside OpenClaw.

## Open Questions (Resolved)

1. ~~Plugin hook mechanism~~ → `before_prompt_build` hook plugin
2. ~~License~~ → Apache 2.0 (James, 2026-04-04)
3. ~~Vault location config~~ → `plugins.entries.vault-engine.config.vaultPath`
   with CLI `--vault-path` override

## Decision

**James, 2026-04-04:** Plugin hook mechanism is `before_prompt_build`. Not a
slot plugin. Coexists with LCM and memory-core without conflict.
