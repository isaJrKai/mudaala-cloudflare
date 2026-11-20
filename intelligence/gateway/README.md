# Mudaala Intelligence Gateway

**Status:** Implemented + tested (27 gateway tests). **Not deployed.** Deployment requires owner secrets and approval — see `docs/intelligence/DEPLOYMENT_AND_ROLLBACK.md`.

A separate Cloudflare Worker (ADR-0002) that is the only entry point from the commerce plane to the intelligence plane. It authenticates service callers, enforces scopes and limits, dispatches to deterministic module engines, and returns the common response envelope (`intelligence/contracts/envelope.ts`).

## Endpoints

| Route | Scope | Module |
|---|---|---|
| `GET /healthz`, `GET /version` | none (no data) | — |
| `POST /v1/search/understand` | `search:understand` | MCI-01 |
| `POST /v1/search/plan` | `search:plan` | MCI-02 |
| `POST /v1/search/rank` | `search:rank` | MCI-03 |
| `POST /v1/search/diversify` | `search:diversify` | MCI-08 |
| `POST /v1/merchant/insights` | `merchant:insights` | MCI-27 |
| `POST /v1/jobs` | `jobs:submit` | staging job store (ADR-0004) |

All responses carry `x-mudaala-trace-id` (echoed from the caller or generated) and `cache-control: no-store`. Errors use the stable envelope-error codes from the contracts (`AUTH_MISSING`, `AUTH_BAD_SIGNATURE`, `AUTH_REPLAY`, `AUTH_CLOCK_SKEW`, `SCOPE_DENIED`, `PAYLOAD_TOO_LARGE`, `PAYLOAD_INVALID`, `RATE_LIMITED`, `MODULE_DISABLED`, …).

## Service authentication

HMAC-SHA256 over the canonical string `callerId \n secretId \n METHOD \n /path \n timestampSeconds \n sha256Hex(body)`, ±90 s clock window, nonce replay protection (Durable Object). The canonicalisation lives in `src/auth.ts` (`signRequest`); the commerce-plane client implements the same scheme and both are pinned by tests.

The caller registry is the `INTELLIGENCE_CALLERS` secret (JSON map: callerId → `{secretId, secret, scopes, rateLimitPerMinute, enabled}`). Rotate by adding a new secretId, flipping `enabled`, then removing the old entry.

## Guarantees

- **Fail-closed at the gateway:** missing auth, replay, bad scope, oversize payload → request rejected.
- **Fail-safe for commerce:** every non-200 is a signal for the commerce client to fall back to its local deterministic behaviour; gateway degradation never degrades mudaala.store.
- **No data access:** the worker has no Hyperdrive/DB/KV/R2 bindings; it cannot reach the commerce database by construction.
- **No payload logging:** only trace id, caller id, route, status and latency are observable.

## Development

```bash
bun test intelligence/gateway/            # auth + pipeline tests (in-memory limiter)
npx tsc -p intelligence/gateway/tsconfig.json   # strict worker typecheck
```

`wrangler.jsonc` sets `workers_dev: false` — deploy is intentionally inert until the owner wires a service binding or internal route (see deployment doc). The DO class `IntelligenceLimiter` handles rate windows and nonces; the memory implementations exist for tests and local dev only.
