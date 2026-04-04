---
type: bet
description: Prediction that LLM reranking will outperform pure BM25 for ambiguous queries
topics:
  - predictions
  - search
  - llm
status: pending
confidence: medium
date: 2025-04-01
connections:
  - tier-2-design
---

# LLM Reranking Superiority Bet

## Summary

We bet that adding a single LLM reranking call on top of BM25 will improve result quality by 30% for ambiguous queries.

## Reasoning

BM25 struggles with synonym matching and conceptual queries. An LLM can bridge this gap.
See [[semantic-search-limitations]] for background.

## Resolution Criteria

Run A/B test comparing pure BM25 vs BM25 + LLM reranking on 100 ambiguous queries.
