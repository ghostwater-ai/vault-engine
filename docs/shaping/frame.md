---
shaping: true
---

# Vault Engine — Frame

## Source

> ByteRover published a paper (https://arxiv.org/abs/2604.01599) demonstrating a 5-tier
> progressive retrieval system that hits 92-96% accuracy on memory benchmarks with zero
> external infra — just BM25 via MiniSearch, query caching, and tiered LLM escalation.
> All markdown files on disk.
>
> James approved a clean-room build from the paper (not a fork — their code is Elastic
> License 2.0 which would block us from ever selling it). We read the paper, implement
> the ideas in our own code, cite them in the README. We own the result fully.
>
> — Dross, #vault-engine briefing, 2026-04-04

> The one critical gap: no retrieval. Knowledge goes in, nothing comes back out
> automatically. Agents can't query the vault before acting.
>
> — Dross, #vault-engine briefing, 2026-04-04

Bet: `bets/build-retrieval-engine-from-byterover-paper.md`
Research: `research/notes/agent-native-memory-beats-external-memory-services.md`

---

## Problem

The Abidan Vault has 312 notes across 6 knowledge types with a 5-phase maintenance
pipeline, but zero retrieval capability. Agents act without consulting what we already
know. Knowledge goes in, nothing comes back out. We repeat mistakes, miss context, and
duplicate research because the vault is write-only for practical purposes.

## Outcome

Agents automatically receive relevant vault knowledge before acting — without calling
a tool, without knowing the vault exists. When passive retrieval isn't enough, they can
explicitly query for deeper answers. The retrieval engine understands our epistemic model:
beliefs outrank research, proven outranks anecdotal, high confidence outranks low.
