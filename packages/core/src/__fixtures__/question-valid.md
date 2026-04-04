---
type: question
description: How should we handle out-of-domain queries?
topics:
  - search
  - ux
  - edge-cases
status: open
date: 2025-03-20
connections:
  - query-classification
---

# Out-of-Domain Query Handling

## Question

When a user queries something completely unrelated to the vault content, what should we do?

## Current Thinking

Options:
1. Return empty results silently
2. Return a "no relevant results" message
3. Attempt to find loosely related content

See [[retrieval-policy]] and [[user-experience-principles]] for context.

## Open Issues

Need user research to determine preferred behavior.
