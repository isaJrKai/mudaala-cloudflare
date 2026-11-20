# MCI-01 — Query understanding (deterministic v0)

**Status:** IN_DEVELOPMENT (implemented + tested; commerce adapter wired behind flag; not staging-verified, not deployed, not shadowed)
**Contract:** `intelligence/contracts/modules/mci01.ts` · **Engine:** `engine.ts` (`mci01-query-understanding-v0.1.0`)
**Concept pack:** `concepts.ts` (`mci01.concepts.v0.1`) · **Gateway route:** `/v1/search/understand`
**Latency budget:** 150 ms · **Compute:** CPU_XS · **Owner:** unassigned

## Purpose

Parse a raw search query into a typed plan: normalised text, tokens, UGX price filter, sort preference, category hints (taxonomy ids), offer/request intent, language hints and explicit ambiguity. Upstream of MCI-02 (retrieval planning) and MCI-03 (ranking).

## Technique and why

Deterministic rules and a versioned concept pack — the simplest technique that meets the current evidence level. The registry decision is BUILD baseline now, ADAPT a text model only after a Luganda/English/code-switch benchmark exists (resource matrix MCI-01 row). No model, no network, no I/O: same input and pack version ⇒ identical output.

## Data provenance and minimisation

- Input: public query text + optional locale/channel/surface. No user identifiers, no history, no profile data.
- The original query is preserved verbatim in the result (registry guardrail); nothing else is stored — the engine is stateless.
- Assumption: unmarked amounts are UGX (Mudaala listings default to UGX). Non-UGX currencies are explicitly skipped with a note, not converted.

## Honest limitations (v0)

- Language hints come from a tiny curated loanword set (`concepts.ts`); `unknown` is a normal result. No claim of Luganda coverage until the benchmark exists.
- Category hints cover the concept pack's ~70 tokens only; unmapped words simply produce no hint.
- Bare amounts ("iphone 20k") become upper bounds with an explicit ambiguity note — an interpretation, not a fact.

## Fallback and kill switch

- Deterministic fallback is the engine itself — there is no worse mode. If the gateway cannot serve MCI-01, the commerce plane keeps its existing local search parsing unchanged.
- Kill switch: gateway route can be disabled per module (`MODULE_DISABLED` envelope error); commerce client treats any failure as "use local behaviour".

## Tests

`engine.test.ts` — 20 cases: query preservation, Unicode safety, UGX grammar (k/m/million/thousand, ranges, under/over, bare amounts, non-UGX skip), intent detection and conflicts, sort detection, ambiguity degradation, determinism, version stability.
