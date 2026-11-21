# ADR-0001: Runtime and language split for the intelligence plane

**Status:** Accepted (increment 1)
**Date:** 2026-11-20
**Deciders:** Intelligence implementation increment 1
**Scope:** All code under `intelligence/`

## Context

The master plan (§5) defines a hybrid intelligence plane: a gateway near the commerce edge, real-time bounded services, a Hermes control plane that must be continuously available, and specialist workers for batch/training workloads (Modal is the candidate provider for those). The commerce application is TypeScript on Cloudflare Workers; its Worker is under a verified production CPU ceiling (PR #342 evidence).

## Decision

1. **TypeScript** for the gateway and all real-time module services. Reasons: the only sync consumers are server-to-server callers at the edge; a TS gateway worker deploys to the same platform as the commerce app (one ops surface), shares JSON/zod ergonomics with the commerce codebase, and keeps the real-time path free of Python cold-start risk. Module engines are pure functions with no I/O, so they run identically in worker, bun test, and local node contexts.
2. **Python** for the Hermes control plane and all future training/evaluation/batch jobs. Reasons: Hermes-adjacent ecosystem, ML tooling (scikit-learn/LightGBM/forecasting), and Modal's Python-native model make Python the only sensible choice there. The control plane talks to modules only through typed HTTP contracts, never by importing them.
3. **No code sharing between planes.** Contracts are duplicated deliberately (TS `intelligence/contracts/` ↔ Python task/job schemas) and kept aligned by contract tests, per master plan principle 10 (provider/runtime portability) and to prevent accidental coupling of the planes.

## Consequences

- Two test runners (`bun test`, `pytest`) and two CI steps — accepted.
- Any future shared logic (e.g. event taxonomy validation) is implemented twice with golden-fixture tests on both sides.
- If Hermes' eventual pinned runtime is NousResearch hermes-agent (Python), the adapter boundary already matches.
- The commerce Worker's CPU budget is untouched: no intelligence code enters its bundle except the flag-off client module.

## Alternatives rejected

- All-Python intelligence plane: would force either a second hosting platform for the latency-sensitive gateway or Python-in-Worker (immature).
- All-TypeScript including training: rejects the ML ecosystem the master plan §8 depends on.
- Sharing a monorepo package manager/workspace across planes now: adds build coupling before the plane exists in production; revisit when a second Python service appears.
