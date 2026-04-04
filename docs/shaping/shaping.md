---
shaping: true
---

# Vault Engine — Shaping

## Requirements (R)

| ID | Requirement | Status |
|----|-------------|--------|
| R0 | Agents get relevant vault context before acting, without explicit tool calls | Core goal |
| R1 | Retrieval respects epistemic hierarchy (beliefs > research > experiences for normative queries) | Must-have |
| R2 | Type-aware scoring: research status, belief confidence, and note type affect ranking | Must-have |
| R3 | Passive injection has a hard token budget (max ~1500 tokens, top 3 results) | Must-have |
| R4 | Sub-2s median query latency on our 312-note corpus | Must-have |
| R5 | Agents can explicitly query for deeper answers when passive injection isn't enough | Must-have |
| R6 | No external infrastructure — no vector DB, no embedding service, no graph DB | Must-have |
| R7 | Clean-room — fully owned (MIT/Apache), no ELv2 taint from ByteRover code | Must-have |
| R8 | CLI exposes scored results with explanation (why did belief X outrank research Y?) | Must-have |
| R9 | Retrieval core is separated from prompt formatting (reusable across CLI, plugin, MCP) | Must-have |

---

## Shape A: Tiered BM25 with Epistemic Scoring + OpenClaw Plugin

Selected shape. Single approach — no competing shapes needed. The ByteRover paper
validates the core architecture (tiered BM25 + cache + LLM escalation); our
differentiation is the epistemic scoring model mapped to our vault's 6 knowledge types.

### Parts

| Part | Mechanism | Flag |
|------|-----------|:----:|
| **A1** | **Document model + parser** | |
| A1.1 | Parse vault markdown files: extract YAML frontmatter + body content | |
| A1.2 | Typed document model: note type, description, topics, status, confidence, maturity, provenance, date, connections | |
| A1.3 | Body section extraction: split into Summary, Key Claims, Evidence, Connections for field-level search | |
| **A2** | **MiniSearch index with type-aware boosting** | |
| A2.1 | MiniSearch instance: fields = title, description, body, topics. Boost: title 5×, description 3×, topics 2×. | |
| A2.2 | Score normalization: `s / (1 + s)` (same as ByteRover) | |
| A2.3 | Type-aware score modifiers (see Scoring Model below) | |
| A2.4 | Compound score: `BM25_normalized * relevance_weight + type_boost + confidence_modifier + recency_decay` | |
| A2.5 | Build index once on startup; file watcher invalidates/rebuilds changed docs only | |
| **A3** | **Query cache (exact hash only for MVP)** | |
| A3.1 | SHA-256 hash of normalized query string → cached results | |
| A3.2 | Cache invalidation on index rebuild | |
| A3.3 | No fuzzy/Jaccard matching in MVP (add when usage data shows near-miss patterns) | |
| **A4** | **Tiered retrieval** | |
| A4.1 | Tier 0: exact cache hit (~1ms) | |
| A4.2 | Tier 2: BM25 search with type-aware scoring (~50ms). High-confidence threshold: normalized score ≥ 0.85, gap ≥ 0.06 from #2 result. | |
| A4.3 | Minimum confidence floor: if best hit < threshold, return empty (silent > noisy) | |
| A4.4 | Tier 3-4 (LLM escalation) deferred to post-MVP | |
| **A5** | **Retrieval core API** | |
| A5.1 | `query(text, options?) → { results: [{ doc, score, matchedFields, boosts, explanation }], tier, latencyMs }` | |
| A5.2 | Options: `maxResults`, `minScore`, `noteTypes[]`, `tokenBudget`, `context` | |
| A5.4 | `context` string used for query expansion/boosting but not as primary search target. BM25 runs against `query`; `context` terms boost matching docs that also appear in context. | |
| A5.3 | Explanation object: raw BM25 score, type boost applied, confidence modifier, final compound score | |
| **A6** | **CLI** | |
| A6.1 | `vault query "..."` — ranked results with scores | |
| A6.2 | `vault query --json` — structured output | |
| A6.3 | `vault query --explain` — full scoring breakdown per result | |
| A6.4 | `vault index rebuild` — manual reindex | |
| A6.5 | `vault index stats` — doc count, index size, type distribution | |
| **A7** | **OpenClaw plugin (passive injection)** | |
| A7.1 | `before_prompt_build` hook plugin — coexists with LCM (context engine slot) and memory-core (memory slot) | |
| A7.2 | Extracts latest user message from hook `messages` param as primary query; recent messages provide topical context | |
| A7.3 | Queries Tier 0-2 only (cache + BM25, no LLM calls — must stay <100ms) | |
| A7.4 | Formats top 3 results as compact block: `[type] title — one-line description + relevance snippet` | |
| A7.5 | Hard token cap: 1500 tokens. Drop weakest result if over budget. | |
| A7.6 | Skip injection entirely if best score < confidence floor | |
| A7.7 | Injects via `appendSystemContext` into system prompt (not user message) | |
| **A8** | **Active query tool** | |
| A8.1 | Agent-callable tool: `vault.query(text, options?)` | |
| A8.2 | Returns full structured results (same as A5.1) | |
| A8.3 | No tier restriction — can use Tier 3-4 when available | |

---

## Scoring Model

### Type Weights (normative queries: "what do we think about X?")

| Note Type | Base Boost | Rationale |
|-----------|-----------|-----------|
| beliefs | +0.15 | Synthesized understanding — highest epistemic value |
| research | +0.05 | Reference material — useful but not our position |
| experiences | +0.00 | Raw evidence — relevant when query is about events |
| entities | +0.00 | Reference data — high for "what is X?" queries |
| bets | -0.05 | Forward-looking — rarely relevant for passive injection |
| questions | -0.10 | Open unknowns — almost never passively injected |

### Status/Confidence Modifiers

| Field | Value | Modifier |
|-------|-------|----------|
| belief.confidence | high | +0.10 |
| belief.confidence | medium | +0.05 |
| belief.confidence | low | +0.00 |
| research.status | proven | +0.10 |
| research.status | battle-tested | +0.05 |
| research.status | benchmarks-only | +0.02 |
| research.status | anecdotal | +0.00 |
| research.status | theoretical | -0.03 |
| research.status | opinion | -0.05 |
| belief.maturity | evergreen | +0.05 |
| belief.maturity | developing | +0.00 |
| belief.maturity | seedling | -0.03 |

### Recency Decay

`recency = e^(-days_since_updated / 90)`

90-day half-life. Recent notes get a slight edge. Old-but-evergreen beliefs resist
decay via maturity bonus.

### Compound Score Formula

```
compound = (bm25_normalized × 0.70) + type_boost + confidence_modifier + (recency × 0.10)
```

Weights are initial guesses. The `--explain` CLI flag exists specifically so we can
tune these against real queries and see what's working.

---

## Fit Check: R × A

| Req | Requirement | Status | A |
|-----|-------------|--------|---|
| R0 | Agents get relevant vault context before acting | Core goal | ✅ |
| R1 | Retrieval respects epistemic hierarchy | Must-have | ✅ |
| R2 | Type-aware scoring affects ranking | Must-have | ✅ |
| R3 | Passive injection has hard token budget | Must-have | ✅ |
| R4 | Sub-2s median query latency | Must-have | ✅ |
| R5 | Agents can explicitly query deeper | Must-have | ✅ |
| R6 | No external infrastructure | Must-have | ✅ |
| R7 | Clean-room, fully owned | Must-have | ✅ |
| R8 | CLI with explanation/debug | Must-have | ✅ |
| R9 | Core separated from formatting | Must-have | ✅ |

No failures. Single shape — the ByteRover paper already validated the architecture.
Our differentiation (epistemic scoring) is additive, not structural.

---

## Passive Query Input (MVP)

Latest user message + current session summary as topical context.

- **query** = latest user message (primary BM25 search target)
- **context** = session summary from OpenClaw runtime (ambient beacon / LCM summary)

The session summary grounds vague follow-ups ("what have we tried?", "tell me more
about that") so they retrieve relevant vault notes even when the user message alone is
ambiguous. OpenClaw already generates these summaries — no new infrastructure needed.

The core engine's `context` parameter boosts docs whose terms overlap with the summary
but doesn't replace the primary query. This keeps retrieval focused on the user's
intent while leveraging conversational grounding for free.

**Decision:** James, 2026-04-04.

---

## Index Strategy

- Parse all 312 vault markdown files on startup
- Build in-memory MiniSearch index
- File watcher (chokidar or similar) invalidates and rebuilds changed docs only
- `vault index rebuild` CLI command for manual repair
- No per-query rebuild — unnecessary churn even at our scale
- No persisted index file for MVP (startup rebuild is <100ms on 312 files)

---

## Post-MVP Roadmap

| Phase | What | Why |
|-------|------|-----|
| v2 | Tier 1: Fuzzy cache (Jaccard similarity) | Optimize when usage data shows near-miss patterns |
| v2 | Tier 3: Single LLM call with pre-fetched context | Handle ambiguous queries BM25 can't resolve |
| v2 | Tier 4: Agentic reasoning loop | Novel questions requiring multi-step retrieval |
| v2 | Richer context signals (last N turns, agent role, channel metadata) | Further follow-up handling beyond session summary |
| v3 | AKL (importance scoring, maturity tiers, recency decay) | Usage-based ranking refinement |
| v3 | Out-of-domain detection | Prevent noisy results on unrelated queries |
| v3 | MCP server | External tool compatibility for non-OpenClaw consumers |
| v3 | Query-type detection | "What happened?" vs "What do we think?" → different type weights |

---

## Repo Structure

```
ghostwater-ai/vault-engine (Apache 2.0)
├── packages/
│   ├── core/               # Retrieval engine (parser, index, scoring, query, cache)
│   │   ├── src/
│   │   │   ├── parser.ts       # Markdown + frontmatter extraction
│   │   │   ├── document.ts     # Typed document model
│   │   │   ├── index.ts        # MiniSearch wrapper + file watcher
│   │   │   ├── scoring.ts      # Type-aware compound scoring
│   │   │   ├── cache.ts        # Query cache (exact hash)
│   │   │   ├── retrieval.ts    # Tiered retrieval orchestrator
│   │   │   └── types.ts        # Shared types
│   │   ├── package.json        # @ghostwater/vault-engine
│   │   └── tsconfig.json
│   └── openclaw-plugin/    # OpenClaw integration
│       ├── src/
│       │   ├── plugin.ts       # Plugin hook: passive injection
│       │   ├── tool.ts         # Active vault.query() tool
│       │   └── formatter.ts    # Result → prompt-ready text
│       ├── package.json        # @ghostwater/vault-engine-openclaw
│       └── tsconfig.json
├── bin/
│   └── vault.ts            # CLI entry point
├── docs/
│   └── shaping/            # This file + frame
├── AGENTS.md
├── README.md               # Credits ByteRover paper
├── package.json            # Workspace root
├── pnpm-workspace.yaml
└── tsconfig.base.json
```

---

## Resolved Questions

1. **Plugin hook mechanism** → `before_prompt_build` hook plugin. Not a slot plugin.
   Coexists with LCM (context engine slot) and memory-core (memory slot) without
   conflict. Injects via `appendSystemContext`. See `spike-plugin-integration.md`
   for full analysis. (James, 2026-04-04)

2. **License** → Apache 2.0 (patent protection). (James, 2026-04-04)

3. **Vault location config** → `plugins.entries.vault-engine.config.vaultPath` in
   openclaw.json. CLI accepts `--vault-path` flag override for standalone use.
   (Oz, 2026-04-04)

---

## Plugin Architecture

```
OpenClaw Gateway
├── Context Engine Slot: lossless-claw (LCM) — owns compaction/assembly
├── Memory Slot: memory-core — owns memory_search/memory_get
└── Plugin: vault-engine — hook-only + tool (no exclusive slot)
    ├── before_prompt_build hook → Tier 0-2 → appendSystemContext
    └── vault_query tool → all tiers → structured results
```

Plugin config:
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
