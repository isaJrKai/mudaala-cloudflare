# ADR-0003: Deterministic-first module strategy with versioned engines and shadow defaults

**Status:** Accepted (increment 1)
**Date:** 2026-11-20
**Scope:** `intelligence/modules/`, `intelligence/eval/`, `intelligence/contracts/registry.json`

## Context

The master plan §8.1 mandates the simplest technique that meets a measured quality target, and the resource matrix Phase 2 orders the first capabilities with deterministic baselines before any model. The repository already contains high-quality deterministic engines (merchant-growth, discovery-ranking, search, price-trends) with honesty patterns (minimum sample sizes, status gating, reason codes). The AI search evaluation protocol (unmerged branch `ai/ranking-engine-implementation-2026-10-30`) defines the gates any ranking change must pass.

## Decision

1. **Every module is a pure, versioned engine** with an explicit `ENGINE_VERSION`, typed input/output contract (zod), reason codes and feature contributions in the output envelope. No module does I/O; callers supply minimised data. This keeps modules testable, portable (worker/bun/CI) and swappable behind the same contract.
2. **Deterministic v0 first for MCI-01, 02, 03, 08, 27.** Learned models are a later, separate decision per module, gated by the matrix's evidence rules (labels, consent, benchmark win over this baseline). The v0 engines are designed so their feature vectors are the input layer of any future learned model — no rewrite will be needed to add ML.
3. **Reuse, don't transplant:** `src/lib/merchant-growth.ts` (MCI-38) stays the commerce-plane implementation and is registered as REUSE in the registry. The intelligence plane does not fork commerce-plane logic; where the same logic is needed across planes (ranking concepts), it is re-expressed as a versioned intelligence-plane engine with its own fixtures and tests.
4. **Shadow by default:** no module is wired into any customer-facing route in this increment. Status vocabulary in the registry follows master plan §15 exactly (PROPOSED → RESEARCHED → IN DEVELOPMENT → SHADOW → CANARY → PRODUCTION / PAUSED / REJECTED).
5. **Evaluation harness ships with the engines, not after them:** synthetic Ugandan-market fixtures (clearly marked synthetic), author-graded query set (provenance stated), metrics from the AI search evaluation protocol (nDCG@5, Precision@5, Recall@K, MRR, zero-result rate, duplicate rate, distinct shops in top 5, exposure concentration). The results log starts empty — no fabricated results.
6. **Honesty caps are part of contracts, not conventions:** e.g. MCI-27 refuses to emit "sales" language from tap metrics; MCI-03 preserves a relevance floor when a query is present (mirroring the audited commerce baseline); every engine returns `UNKNOWN` rather than guessing where inputs are insufficient.

## Consequences

- Deterministic engines may under-treat language nuance (Luganda/code-switch queries) until the language benchmark exists — recorded as an explicit gap in the registry, not hidden.
- The registry JSON is a governance artifact: every status change requires an evidence link; CI validates schema, not truth of claims.

## Alternatives rejected

- Start with embeddings/vector search (Qdrant/pgvector): matrix §9 explicitly requires proving the PostgreSQL/deterministic baseline insufficient first; no benchmark exists yet.
- Fork merchant-growth into the intelligence plane to "enhance" it: forks the audited commerce logic and creates divergence before evaluation exists.
- Ship LLM wording inside MCI-27 insights: adds provider dependency and privacy review burden to the first increment; wording is a later, separable layer.
