# ADR-0002: Intelligence gateway — separate Cloudflare Worker with HMAC service auth

**Status:** Accepted (increment 1)
**Date:** 2026-11-20
**Scope:** `intelligence/gateway/`, `src/lib/intelligence/gateway-client.ts`

## Context

The master plan §5.1.B requires a gateway that is publicly unreachable except through authenticated Mudaala server-to-server paths; enforces scopes, payload limits, timeouts, rate limits and idempotency; never exposes arbitrary DB access; and adds ≤50 ms overhead. The commerce Worker currently runs on a Workers Free-class CPU allowance with verified `exceededCpu` 503s (PR #342), so intelligence work must not land in that worker. No Cloudflare Queues binding exists; no Redis service is proven.

## Decision

1. **Separate worker** (`intelligence/gateway/`) with its own `wrangler.jsonc`, own Durable Object (rate limiting + nonce replay cache), no Hyperdrive, no database binding. The commerce app reaches it by HTTPS fetch to an internal hostname; a service binding can replace the fetch later without contract changes.
2. **HMAC service authentication**: each caller has a caller id + secret id + shared secret (worker secret store). The signature covers caller id, secret id, path, timestamp, body hash and a caller-generated nonce; ±90 s clock window; nonce cache rejects replays. Rationale: simpler and more auditable than JWT rotation for a two-caller system, and it authenticates the body, which bearer tokens do not.
3. **Authorisation by static scopes per route** (e.g. `search:rank`, `merchant:insights`). No dynamic scope grants in v1. Merchant insights requests must declare the merchant subject; there is no "any merchant" scope.
4. **Bounded by default**: 32 KiB payload cap, 5 s upstream deadline, per-caller token bucket, JSON envelope errors, no request body logging (trace id + caller id + module id + outcome only).
5. **Fail-closed for the gateway, fail-safe for commerce**: the gateway returns envelope errors with stable codes; the commerce client treats every non-200/timeout as "use local deterministic fallback". Gateway degradation cannot degrade commerce.
6. **Root tsconfig exclusion** for `intelligence/gateway/` with its own tsconfig (worker runtime types differ from the DOM/Next types used by the app). One additive exclusion; the gateway is not app code.

## Consequences

- Two workers to operate and monitor; the gateway's cost on the same Cloudflare account is expected to be negligible at current volumes but must be verified at deployment (operations doc).
- HMAC requires careful clock handling in clients — the commerce client retries once on clock-skew rejection with a re-signed request.
- The nonce cache lives in a Durable Object with TTL cleanup; its capacity is bounded by the per-caller rate limit, so the DO cannot be a scaling hazard.
- Route modules are invoked in-process (the worker imports `intelligence/modules/` engines). This is intentional for v0 determinism; moving a module behind its own service later changes only the handler, not the contract.

## Alternatives rejected

- Put intelligence endpoints inside the commerce Worker: violates the CPU-ceiling constraint and the master plan's plane separation.
- JWT/OAuth2 client-credentials now: heavier key management for two callers; revisit if caller count grows or third parties appear (never expected on this surface).
- API-key-only auth: does not authenticate the body, is replayable, and cannot be scoped per request.
