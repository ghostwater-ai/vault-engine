# PRODUCT.md — Vault Engine

---

## Layer 1: What Is This Thing?

**One sentence:** Vault Engine is a retrieval engine that gives AI agents automatic access to a team's structured knowledge vault before every turn, using BM25 keyword search with epistemic scoring tuned to note types and confidence levels.

**Who uses it:** AI agent operators running OpenClaw (or similar frameworks) who maintain a structured Markdown knowledge base and want their agents to retrieve relevant context automatically.

**Why they care:** Knowledge goes into vaults but never comes back out. Agents answer from their training data or hallucinate instead of consulting the team's actual beliefs, research, and experience. Vault Engine closes the loop: every agent turn gets relevant vault context injected into the system prompt — no explicit tool calls required.

**Inspiration:** ByteRover paper (arxiv 2604.01599) — 5-tier progressive retrieval achieving 92-96% accuracy on memory benchmarks with zero external infra. We implement from the paper only (clean-room); their code is Elastic License 2.0 which we cannot use. Cited in README.

**Distribution:**
- npm: `@ghostwater/vault-engine` (core) + `@ghostwater/vault-engine-openclaw` (plugin)
- CLI: `vault` command
- OpenClaw plugin: installed via `openclaw plugins install`

**Tech stack:**
- **Language:** TypeScript (Node.js 22, ESM)
- **Search:** MiniSearch (in-memory BM25)
- **Build:** `tsc` → `dist/`
- **Package manager:** pnpm (workspace monorepo)
- **Testing:** Vitest
- **Index:** In-memory, built on startup, file watcher for incremental updates

**Repo:** `ghostwater-ai/vault-engine` (Apache 2.0)

**Monorepo structure:**
```
packages/
├── core/           # @ghostwater/vault-engine — parser, index, scoring, retrieval
└── openclaw-plugin/ # @ghostwater/vault-engine-openclaw — hook + tool plugin
bin/
└── vault.ts        # CLI entry point
```

---

## Layer 2: What Matters Right Now?

**Current focus:** Ship MVP — BM25 retrieval with epistemic scoring, OpenClaw passive injection via `before_prompt_build` hook, CLI with explain mode. No LLM calls, no vector search, no cache.

**What "done" looks like:**
- `vault query "what do we think about memory systems?" --explain` returns ranked results with full scoring breakdown
- OpenClaw plugin injects relevant vault context into system prompt every turn, under 100ms
- Agents can call `vault_query` tool for explicit deeper retrieval
- All scoring weights are tunable and visible via `--explain`
- Works against our 312-note Abidan Vault as the reference corpus

**Known constraints:**
- BM25-only means semantic/conceptual queries will miss notes that use different terminology (e.g. "marketing" vs "GTM"). This is a known limitation — Tier 2 (LLM reranking) is the planned fix, not vector search.
- No cross-type synthesis (e.g. "what patterns repeat across our failures") — requires reasoning, not keyword matching. Active `vault_query` + future Tier 3 addresses this.
- 312 notes is small enough that in-memory index is trivially fast. Architecture may need revision if vault grows to 10K+ notes.

**What we're explicitly NOT doing right now:**
- Query cache (exact-hash has near-zero hit rate in conversation; MiniSearch is already sub-millisecond in-memory)
- Vector/embedding search (adds infra we don't want; LLM reranking over BM25 top-N is cheaper and smarter at our scale)
- MCP server (post-MVP, for non-OpenClaw consumers)
- Agent-role-aware retrieval (all agents get same results for same query — role biasing is future)
- LLM-based query expansion or reranking (Tier 2+)

**What's next (post-MVP):**
1. Tier 2: Single LLM call — read top 10 BM25 results, rerank/synthesize for ambiguous queries
2. Tier 3: Agentic reasoning loop — multi-step retrieval for novel questions
3. Fuzzy cache (Jaccard similarity) — only when usage telemetry shows near-miss patterns justify it
4. Richer context signals (last N turns, agent role, channel metadata)
5. `vault calibrate` CLI command — runs test queries, shows score distributions for threshold tuning
6. Recency decay — add temporal scoring to compound formula with enough weight (0.25+) to meaningfully affect rankings; resolve updatedAt source (git log vs frontmatter vs mtime)
7. Query-type detection ("what happened?" vs "what do we think?" → different type weights)
7. Out-of-domain detection — suppress noisy results on unrelated queries
8. Agent-role-aware retrieval — bias results by querying agent's domain
9. MCP server — external tool compatibility

---

## Layer 3: User Acceptance Criteria

### Document Parsing

#### UAC-001: Parse vault markdown files into typed documents
- status: intent
- added: 2026-04-04
- revised: 2026-04-04 (Dross review: scoped directory scanning, added topic pages)
- source_files: packages/core/src/parser.ts, packages/core/src/document.ts
- criteria:
  - **Scans only these directories** within the vault path (not recursive from root):
    - `experiences/` — experience notes
    - `research/notes/` — research notes
    - `beliefs/` — belief notes
    - `entities/` — entity notes
    - `bets/` — bet notes
    - `questions/` — question notes
    - `_topics/` — topic map pages (indexed as `noteType: "topic"`)
  - **Excludes:** `_maintenance/`, root-level files (`INDEX.md`, `VAULT-SPEC.md`, `AGENTS.md`, `CLAUDE.md`, `_progress.md`), and any `_*` prefixed directories other than `_topics/`
  - Extracts YAML frontmatter: type, description, topics, status, confidence, maturity, provenance, date, connections
  - Extracts body sections: splits on `## ` headers into named sections (Summary, Key Claims, Evidence, Connections, etc.)
  - Handles all 6 vault note types plus topic pages (7 types total)
  - Strips `[[wiki-links]]` brackets during indexing but preserves linked note name as a searchable term
  - Gracefully handles malformed frontmatter (skip file, log warning, don't crash)
  - Returns typed `VaultDocument` with all extracted fields

#### UAC-002: Typed document model covers all vault metadata
- status: intent
- added: 2026-04-04
- source_files: packages/core/src/types.ts
- criteria:
  - `VaultDocument` type includes: path, slug, noteType, title, description, topics, status, confidence, maturity, provenance, date, updatedAt, connections, bodySections, rawBody
  - `noteType` is one of: `experience | research | belief | entity | bet | question | topic`
  - All frontmatter fields are optional (graceful degradation for incomplete notes)
  - `connections` parsed from both frontmatter and `[[wiki-links]]` in body text

### Indexing

#### UAC-003: Build in-memory MiniSearch index on startup
- status: intent
- added: 2026-04-04
- revised: 2026-04-04 (Dross review: added fuzzy + prefix matching per ByteRover)
- source_files: packages/core/src/index.ts
- criteria:
  - Scans the 7 scoped directories defined in UAC-001
  - Parses each file into VaultDocument
  - Builds MiniSearch index with fields: title, description, body, topics
  - Field boost weights: title 5×, description 3×, topics 2× (body included at default weight 1× — not boosted, just searchable)
  - **Fuzzy matching enabled:** `fuzzy: 0.2` — handles typos and near-matches (e.g. "mem" → "memory"). Aligned with ByteRover's configuration.
  - **Prefix search enabled:** allows partial term matching for short queries
  - Index build completes in <500ms for 312 files
  - Exposes document count and type distribution via `getStats()`

#### UAC-004: File watcher updates index incrementally
- status: intent
- added: 2026-04-04
- source_files: packages/core/src/index.ts
- criteria:
  - Watches vault path for file changes (add/modify/delete)
  - On change: re-parses affected file(s), updates index entry
  - **Debounced rebuilds**: waits 2 seconds after last detected change before rebuilding (handles maintenance pipeline batch edits of 30+ files)
  - Does not rebuild entire index on single-file change
  - `vault index rebuild` CLI command forces full reindex for manual repair

#### UAC-005: Query preprocessing normalizes input
- status: intent
- added: 2026-04-04 (from Dross review)
- revised: 2026-04-04 (Dross review round 2: specified stemmer dependency)
- source_files: packages/core/src/index.ts
- criteria:
  - **Stemming:** English stemming via external `stemmer` npm package (or equivalent like `natural/lib/stemmers`). MiniSearch does NOT have built-in stemming — requires a custom `processTerm` function wired into MiniSearch options.
  - **Stop words:** filtered using English default stop word list, applied in the same `processTerm` function
  - Case-insensitive matching (MiniSearch default)
  - `[[wiki-links]]` in indexed content: brackets stripped, linked note name preserved as term
  - Query text receives the same `processTerm` pipeline as indexed content (stemming + stop words + case normalization)
  - **Dependency:** add `stemmer` (or chosen package) to `packages/core/package.json`

### Scoring

#### UAC-006: Multiplicative compound scoring formula
- status: intent
- added: 2026-04-04 (revised from additive per Dross review)
- source_files: packages/core/src/scoring.ts
- criteria:
  - BM25 raw scores normalized via `s / (1 + s)`
  - Compound score formula:
    ```
    compound = bm25_normalized × (1 + type_boost + confidence_modifier)
    ```
  - **Multiplicative type/confidence modifiers**: type boost and confidence modifier scale the BM25 contribution rather than adding independently. This ensures BM25 textual relevance remains the dominant signal — a belief with weak BM25 match cannot outscore a research note with a strong match on type bonuses alone.
  - A document with zero BM25 score always produces zero compound score (the multiplicative term zeroes out)
  - Recency decay deferred to post-MVP (see UAC-009) — removed the 0.70 weight and 0.10 recency split; BM25 × modifiers is the entire formula now
  - All weights are configurable (not hardcoded)
  - `--explain` output shows each component: raw BM25, normalized BM25, type boost, confidence modifier, final compound

#### UAC-007: Type boost weights
- status: intent
- added: 2026-04-04
- revised: 2026-04-04 (Dross review: added topic type)
- source_files: packages/core/src/scoring.ts
- criteria:
  - Default type boosts (tunable):
    | Note Type | Boost | Rationale |
    |-----------|-------|-----------|
    | beliefs | +0.15 | Synthesized understanding — highest epistemic value |
    | research | +0.05 | Reference material — useful but not our position |
    | experiences | +0.00 | Raw evidence — relevant when query is about events |
    | entities | +0.00 | Reference data — high for "what is X?" queries |
    | topics | +0.00 | Navigational map pages — useful for broad queries |
    | bets | -0.05 | Forward-looking — rarely relevant for passive injection |
    | questions | -0.10 | Open unknowns — almost never passively injected |
  - These are initial guesses. `vault calibrate` (post-MVP) will enable empirical tuning.

#### UAC-008: Status and confidence modifiers
- status: intent
- added: 2026-04-04
- source_files: packages/core/src/scoring.ts
- criteria:
  - Belief confidence modifiers:
    | Confidence | Modifier |
    |------------|----------|
    | high | +0.10 |
    | medium | +0.05 |
    | low | +0.00 |
  - Research status modifiers:
    | Status | Modifier |
    |--------|----------|
    | proven | +0.10 |
    | battle-tested | +0.05 |
    | benchmarks-only | +0.02 |
    | anecdotal | +0.00 |
    | theoretical | -0.03 |
    | opinion | -0.05 |
  - Belief maturity modifiers:
    | Maturity | Modifier |
    |----------|----------|
    | evergreen | +0.05 |
    | developing | +0.00 |
    | seedling | -0.03 |
  - All modifiers configurable via scoring config object

#### UAC-009: Recency decay — DEFERRED TO POST-MVP
- status: deferred
- added: 2026-04-04
- revised: 2026-04-04 (moved to post-MVP)
- rationale: |
    At 0.10 weight in the compound formula, recency produces a maximum 0.09 difference between
    a brand-new note and a 6-month-old note. With BM25 × 0.70 producing typical values of 0.21–0.35,
    recency is invisible — a rounding error, not a signal. It adds implementation cost (git log subprocess
    per file during index build, updatedAt source resolution with 3-tier fallback, exponential decay math)
    for no observable effect on the current 312-note corpus.
    
    Additionally, our vault's maintenance pipeline (reflect/reweave/verify/rethink) already surfaces
    important notes by enriching them — which improves their BM25 relevance naturally. Recency decay
    would be fighting the same battle with a weaker weapon.
    
    Add recency back when: (a) we have temporal queries that need it ("what changed recently?"),
    (b) we give it real weight (0.25+) so it actually affects rankings, and (c) we decide the updatedAt
    source (git log is most accurate but adds subprocess cost per file).

#### UAC-010: Minimum BM25 floor
- status: intent
- added: 2026-04-04 (from Dross review)
- source_files: packages/core/src/scoring.ts, packages/core/src/retrieval.ts
- criteria:
  - Documents must meet a minimum BM25 normalized score to be considered (default: 0.10)
  - This is a *prerequisite* check before compound scoring — documents below the BM25 floor are excluded regardless of type/confidence bonuses
  - With multiplicative scoring, zero BM25 already produces zero compound, but the floor catches near-zero matches that would otherwise get small compound scores
  - BM25 floor is configurable independently of compound score threshold
  - Both thresholds exposed in `--explain` output

### Retrieval

#### UAC-011: Tiered retrieval (MVP: Tier 0 + Tier 1)
- status: intent
- added: 2026-04-04 (renumbered from ByteRover scheme per Dross review)
- source_files: packages/core/src/retrieval.ts
- criteria:
  - **Tier 0 (~50ms): BM25 search with epistemic scoring.** Primary retrieval path. Runs MiniSearch query, applies compound scoring, returns ranked results. High-confidence threshold: top result normalized score ≥ 0.85 with gap ≥ 0.06 from #2.
  - **Tier 1 (deferred): Single LLM reranking call.** When Tier 0 results are ambiguous or low-confidence, pass top 10 BM25 results to an LLM for reranking/synthesis. Not implemented in MVP.
  - **Tier 2 (deferred): Agentic reasoning loop.** Multi-step retrieval for novel questions. Not implemented in MVP.
  - Tier numbering matches our implementation, not ByteRover's 5-tier scheme (their Tiers 0-1 were cache tiers we've deferred)
  - Return value includes `tier` field indicating which tier produced the result

#### UAC-012: Minimum compound score threshold
- status: intent
- added: 2026-04-04
- source_files: packages/core/src/retrieval.ts
- criteria:
  - Results below compound score threshold are excluded (default: 0.30)
  - If no results pass threshold, return empty (silent injection > noisy injection)
  - Threshold is configurable per-query via options and globally via config
  - `--explain` shows which results were filtered and why

#### UAC-013: Context-aware re-ranking
- status: intent
- added: 2026-04-04 (mechanism specified per Dross review)
- revised: 2026-04-04 (Dross review round 2: specified context term extraction)
- source_files: packages/core/src/retrieval.ts
- criteria:
  - Core API accepts optional `context` string alongside primary `query`
  - BM25 search runs against `query` only — context does not dilute the primary search
  - **Context term extraction:** the caller provides a context string. Core tokenizes it, applies the same `processTerm` pipeline (stemming, stop words, case normalization), and produces a set of context keywords. For the OpenClaw plugin, context = last 3 user messages concatenated (see UAC-017).
  - After BM25 scoring, a post-hoc re-ranking step checks context term overlap: for each result, compute what fraction of extracted context keywords appear in the document
  - Context overlap score is used as a secondary sort signal: results with similar compound scores are re-ordered by context relevance
  - Context boost is small (tiebreaker, not dominant) — a result with high BM25 + no context overlap still outranks a result with low BM25 + high context overlap
  - `--explain` shows context terms extracted and overlap score per result
  - If no `context` provided, re-ranking step is skipped entirely

### Core API

#### UAC-014: Retrieval core API surface
- status: intent
- added: 2026-04-04
- source_files: packages/core/src/retrieval.ts, packages/core/src/types.ts
- criteria:
  - Main function: `query(text: string, options?: QueryOptions) → QueryResult`
  - `QueryOptions`: `{ maxResults?, minScore?, minBm25Score?, noteTypes?, tokenBudget?, context? }`
  - `QueryResult`: `{ results: ScoredDocument[], tier: number, latencyMs: number, query: string, contextTerms?: string[] }`
  - `ScoredDocument`: `{ doc: VaultDocument, score: number, bm25Raw: number, bm25Normalized: number, typeBoost: number, confidenceModifier: number, contextOverlap?: number, matchedFields: string[], explanation: string }`
  - Core returns structured results only — no formatting, no prompt text. Consumers (plugin, CLI, MCP) own formatting.

### CLI

#### UAC-015: Query command with ranked results
- status: intent
- added: 2026-04-04
- source_files: bin/vault.ts
- criteria:
  - `vault query "what do we think about memory systems?"` — shows ranked results with scores
  - Default output: `[type|status] title — description` per result, with compound score
  - `vault query --json` — structured JSON output (full ScoredDocument array)
  - `vault query --explain` — full scoring breakdown: raw BM25, normalized BM25, type boost, confidence modifier, context overlap, BM25 floor status, compound threshold status, final score
  - `vault query --context "we were discussing retrieval architecture"` — passes context for re-ranking
  - `vault query --types beliefs,research` — filter by note types
  - `vault query --max-results 5` — override default result count
  - `vault query --min-score 0.4` — override compound threshold
  - `vault query --dry-run` — shows formatted injection output (what the OpenClaw plugin would inject into system prompt), with token count. For testing plugin formatting without running inside OpenClaw.

#### UAC-016: Index management commands
- status: intent
- added: 2026-04-04
- source_files: bin/vault.ts
- criteria:
  - `vault index rebuild` — full reindex from disk
  - `vault index stats` — document count, type distribution, index size, last rebuild time
  - `vault --vault-path /path/to/vault` — override vault location (default from config)

### OpenClaw Plugin (Passive Injection)

#### UAC-017: before_prompt_build hook for passive injection
- status: intent
- added: 2026-04-04
- revised: 2026-04-04 (Dross review: engine singleton, context extraction specified)
- source_files: packages/openclaw-plugin/src/plugin.ts
- criteria:
  - Registers as a `before_prompt_build` hook plugin (NOT a slot plugin)
  - Coexists with LCM (context engine slot) and memory-core (memory slot) without conflict
  - **Engine singleton:** initializes the vault engine lazily on first hook invocation (reads vaultPath from plugin config, parses + indexes vault). Caches the engine instance for all subsequent turns. Does NOT rebuild index every turn.
  - On every agent turn: extracts latest user message from hook `messages` param as primary query
  - **Context extraction:** concatenates last 3 user messages from `messages` param, tokenizes with stop word removal, passes as `context` to core API for re-ranking
  - Queries Tier 0 only — no LLM calls, must complete in <100ms
  - Formats results and injects via `appendSystemContext`
  - If engine is still initializing (first turn startup), skip injection for that turn rather than blocking

#### UAC-018: Injection formatting and token budget
- status: intent
- added: 2026-04-04
- source_files: packages/openclaw-plugin/src/formatter.ts
- criteria:
  - Format per result: `[type|status] title\ndescription` — description is pulled directly from the `description` frontmatter field. No body extraction, no LLM summarization. If a note has no `description`, show title only. (Rationale: every vault note has a description field designed as a 1-2 sentence summary. Extracting "key claims" from the body would require either an LLM call (can't do in <100ms) or brittle heuristics. The frontmatter description is deterministic, already curated, and purpose-built for this.)
  - Hard cap per result: 400 tokens
  - **Fixed result count:** return top 3 results (or fewer if fewer pass threshold). Dynamic gap-based sizing deferred — the gap thresholds are arbitrary and need tuning data we don't have yet.
  - Total injection budget: 1500 tokens max (including header line "Vault context:")
  - Drop weakest results first if over budget
  - Skip injection entirely if no results pass compound score threshold (silent > noisy)
  - Header: `## Vault Context` (or similar, visible in system prompt)

#### UAC-019: Plugin configuration
- status: intent
- added: 2026-04-04
- source_files: packages/openclaw-plugin/src/plugin.ts
- criteria:
  - Config via `plugins.entries.vault-engine.config` in openclaw.json:
    ```json5
    {
      vaultPath: "~/projects/abidan-vault",
      injection: {
        maxResults: 3,
        maxTokens: 1500,
        minScore: 0.30,       // compound score threshold
        minBm25Score: 0.10    // BM25 floor
      }
    }
    ```
  - Plugin validates config on load (schema validation via configSchema in manifest)
  - Missing or invalid vaultPath → plugin disables itself with warning, doesn't crash gateway
  - Empty vault (vaultPath exists but no .md files in scoped directories) → plugin initializes but returns empty results, logs once, no injection
  - All files fail parsing → same as empty vault, graceful degradation

#### UAC-020: Design note — session context approximation
- status: intent
- added: 2026-04-04
- note_type: design_decision
- criteria:
  - MVP uses recent messages from the `before_prompt_build` hook as context, NOT the LCM session summary directly
  - This is an approximation — messages are the raw material LCM summarizes, so extracting keywords from the last few messages provides similar topical grounding
  - If this approximation proves insufficient (vague follow-ups retrieve poorly), we will investigate accessing LCM summaries from the hook
  - The core API's `context` parameter is format-agnostic — swapping the context source later requires no core changes, only plugin changes

### Active Query Tool

#### UAC-021: vault_query agent tool
- status: intent
- added: 2026-04-04
- revised: 2026-04-04 (Dross review: shared engine singleton)
- source_files: packages/openclaw-plugin/src/tool.ts
- criteria:
  - Registered as an OpenClaw agent tool via `api.registerTool()`
  - Tool name: `vault_query`
  - Parameters: `{ query: string, maxResults?: number, noteTypes?: string[], context?: string }`
  - Returns full structured results (same as core API QueryResult)
  - **Uses the same engine singleton** as the hook (UAC-017). If the tool is called before the hook has initialized the engine, the tool triggers initialization.
  - No tier restriction — can use Tier 1+ when available (MVP: Tier 0 only)
  - Tool description tells the agent when to use it: "Search the knowledge vault for specific information. Use when passive vault context isn't sufficient or you need to explore a topic in depth."

### Testing

#### UAC-022: Test strategy
- status: intent
- added: 2026-04-04 (from Dross review)
- criteria:
  - **Unit tests — parser:** sample vault notes (one per type, including malformed) → expected VaultDocuments. Test frontmatter extraction, body section splitting, wiki-link stripping, graceful failure on bad YAML.
  - **Unit tests — scoring:** known inputs (BM25 raw score, note type, confidence, date) → expected compound scores. Verify multiplicative formula, BM25 floor filtering, zero-BM25-equals-zero-compound invariant.
  - **Unit tests — context re-ranking:** verify context term extraction, overlap calculation, re-ranking behavior (tiebreaker only, doesn't override BM25 primacy).
  - **Integration test — Abidan vault:** index the actual vault at `~/projects/abidan-vault/`, run a set of known queries, assert expected notes appear in top results. This is the canonical acceptance test.
  - **Test fixture:** the Abidan vault IS the primary test fixture. For unit tests, use a `test/fixtures/` directory with small synthetic vault notes.
  - **Framework:** Vitest

---

## Layer 4: Engineering Invariants

### INV-001: Core is framework-agnostic
- The `@ghostwater/vault-engine` package has zero knowledge of OpenClaw, sessions, agents, or any framework
- It accepts a query string + options, returns structured results
- All OpenClaw integration lives in `@ghostwater/vault-engine-openclaw`
- **Review checkpoint:** "Can a different agent framework use vault-engine by only changing the consumer code?" If no, it's coupled.

### INV-002: No external infrastructure
- No vector database, embedding service, graph database, or external API calls
- MiniSearch runs in-process, in-memory
- Index is rebuilt from disk on every startup (<500ms for 312 files)
- The only dependency beyond the vault directory is Node.js

### INV-003: Silent over noisy
- If retrieval confidence is low, inject nothing
- A wrong vault injection is worse than no injection — agents will treat injected context as authoritative
- Every injection threshold is configurable so operators can tune aggressiveness

### INV-004: Passive injection is non-blocking
- `before_prompt_build` hook must complete in <100ms
- No LLM calls, no network requests during query execution
- Disk I/O occurs only during index build (startup/rebuild/file watcher). Never during query execution.
- If index isn't ready (still building), skip injection for that turn rather than blocking

### INV-005: Explain everything
- Every scoring decision is traceable via `--explain` / explanation field
- Raw BM25 score, normalized score, type boost, confidence modifier, context overlap, BM25 floor check, compound threshold check — all visible
- This is how we tune: run queries, read explanations, adjust weights

### INV-006: Clean-room implementation
- Inspired by ByteRover paper (arxiv 2604.01599), implemented from paper only
- No code copied, adapted, or derived from ByteRover source (Elastic License 2.0)
- README credits the paper and explains the relationship
- Our code is Apache 2.0, fully owned

### INV-007: Multiplicative scoring preserves BM25 primacy
- The compound scoring formula uses multiplicative type/confidence modifiers
- This means textual relevance (BM25) is always the dominant signal
- Type and confidence bonuses amplify relevant results, they cannot manufacture relevance from nothing
- A document with zero BM25 score always has zero compound score

---

## Architecture

```
OpenClaw Gateway
├── Context Engine Slot: lossless-claw (LCM) — owns compaction/assembly
├── Memory Slot: memory-core — owns memory_search/memory_get
└── Plugin: vault-engine — hook-only + tool (no exclusive slot)
    ├── before_prompt_build hook → Tier 0 → appendSystemContext
    └── vault_query tool → all tiers → structured results

┌─────────────────────────────────────────────┐
│  @ghostwater/vault-engine (core)            │
│                                             │
│  vault path → parser → VaultDocument[]      │
│                  ↓                          │
│              MiniSearch index               │
│                  ↓                          │
│  query → BM25 → scoring → re-ranking       │
│                  ↓                          │
│  { results, tier, latencyMs, explanation }  │
└─────────────────────────────────────────────┘
         ↑                    ↑
   CLI (vault)     OpenClaw plugin (hook + tool)
```

---

## Scoring Model (Reference)

### Formula

```
compound = bm25_normalized × (1 + type_boost + confidence_modifier)
```

Where:
- `bm25_normalized = raw_bm25 / (1 + raw_bm25)` — maps to [0, 1)
- `type_boost` — per note type (see UAC-007)
- `confidence_modifier` — per status/confidence/maturity (see UAC-008)
- Recency decay deferred to post-MVP (see UAC-009)

### Why multiplicative?

With additive scoring (the original design), a high-confidence belief (+0.15 type + 0.10 confidence + 0.05 maturity = +0.30) could score competitively even with a mediocre BM25 match. The type bonuses dominated the BM25 signal, effectively turning the engine into type-filtered retrieval with BM25 as tiebreaker.

Multiplicative scoring fixes this: type/confidence modifiers *scale* the BM25 contribution. A belief with a strong BM25 match gets the biggest boost. A belief with zero BM25 match gets zero regardless of type bonuses. BM25 stays primary; epistemic scoring amplifies, never manufactures.

The formula was originally `bm25_normalized × 0.70 × (1 + boosts) + recency × 0.10`, splitting the score budget three ways. With recency deferred (see UAC-009 — at 0.10 weight it produced no observable effect), we simplified to `bm25_normalized × (1 + boosts)`. No artificial weighting cap on BM25 anymore.

### Retrieval pipeline

1. Preprocess query (stem, normalize, strip wiki-link brackets)
2. MiniSearch BM25 search with fuzzy (0.2) + prefix matching → raw scores
3. Normalize BM25 scores: `s / (1 + s)`
4. Apply BM25 floor filter (default 0.10) — exclude near-zero matches
5. Compute compound score per result: `bm25_normalized × (1 + type_boost + confidence_modifier)`
6. Apply compound score threshold (default 0.30) — exclude low-confidence results
7. If `context` provided: extract context terms (tokenize, stem, remove stop words), compute overlap fraction per result, re-rank as tiebreaker
8. Sort by final score, return top N (default 3)
9. Return with full explanation metadata

### Why lower thresholds than ByteRover?

ByteRover uses BM25 confidence ≥ 0.93 with gap ≥ 0.08 from #2. We use ≥ 0.85 with gap ≥ 0.06.

Their thresholds are tuned for ~23K documents where false positives are a real problem. We have ~312 notes — the search space is small enough that lower thresholds are appropriate. We'd rather surface a marginally relevant result than miss it entirely. With epistemic scoring as a secondary signal, near-miss results from a lower BM25 threshold still get filtered if they don't match the right type/confidence profile.

If the vault grows significantly, revisit these thresholds. `vault calibrate` (post-MVP) will make this empirical.

### Paper comparison: what we take, what we skip, why

**Taking from ByteRover:**
- MiniSearch as the search engine
- `s/(1+s)` score normalization
- Field boosting (titles highest)
- Tiered architecture (fast first, LLM later)
- In-memory index, markdown on disk
- No external infra
- High-confidence threshold + gap (with adjusted values for our corpus size)
- Fuzzy matching (`fuzzy: 0.2`) and prefix search

**Not taking (justified):**
- Cache tiers (near-zero hit rate for agent conversation use case)
- Domain → Topic → Subtopic hierarchy (we have richer typed structure with 7 note types)
- AKL importance scoring (mechanical; our maintenance pipeline handles importance semantically)
- Bidirectional reference index (our wiki-links + connections frontmatter serve this; MiniSearch indexes the terms)
- Out-of-domain detection (post-MVP, when we have more notes and usage data)

**Adding (justified by our vault structure):**
- Epistemic type boosts (6 note types with different authority levels)
- Confidence/status modifiers (frontmatter already carries this data)
- Multiplicative scoring (preserves BM25 primacy while using type/confidence)
- Context re-ranking from conversation (agents have session context; ByteRover's CLI doesn't)
- OpenClaw plugin integration (they have MCP; we need deeper pre-turn injection)
