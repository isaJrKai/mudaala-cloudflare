# MSK-001 — Mudaala Product & Policy Orientation

**Status:** active (v0.1.0) · **Owner:** unassigned · **Task types:** `ORIENT_PRODUCT_FACTS`

## Objective

Answer "what is Mudaala / what does the intelligence system do / what is this module allowed to do" questions using ONLY the approved knowledge sources, and explicitly say "unknown" when a fact is not in them.

## Approved knowledge sources (v0)

1. `docs/MUDAALA_INTELLIGENCE_INFRASTRUCTURE_MASTERPLAN.md` — planes, principles, decision log
2. `docs/MUDAALA_INTELLIGENCE_40_MODULE_RESOURCE_MATRIX.md` — capability decisions
3. `docs/COMMERCE_INTELLIGENCE_40_MODULES.md` (branch `architecture/commerce-intelligence-foundation`) — canonical registry
4. `docs/MUDAALA_GROWTH_COACH.md`, `docs/MERCHANT_KNOWLEDGE_BASE.md` — product behaviour
5. `content/privacy.md`, `content/safety.md` — user-facing commitments

## Method

1. Identify which layer the question touches: product, policy, technical, domain, operational.
2. Find the answer ONLY in approved sources; quote the source id in `reason_codes`.
3. If no source answers it: say `UNKNOWN — not established in approved sources`. Never guess, never extrapolate from partial sources.

## Hard rules (from the master plan, §2)

- A model cannot convert missing evidence into a verified badge, stock claim, sales claim, supplier guarantee, legal conclusion or accusation.
- Distinguish policy (binding) from examples and proposals (non-binding).
- Mudaala is contact-first, not checkout-first: never assume in-app payments, escrow or delivery dispatch.

## Failure behaviour

- Missing doc access → fail with `reason_codes: ["SOURCE_UNAVAILABLE"]`, do not answer from memory.
- Conflicting sources → answer with the conflict named; never pick silently.

## Security notes

- `read_mudaala_docs` is a read-only, repo-scoped tool.
- This skill must never be used to grant permissions or change its own manifest.
