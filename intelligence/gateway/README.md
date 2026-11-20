# Mudaala Intelligence Gateway

**Status:** Implemented + tested (56 gateway tests, remediated). **Not deployed.** Deployment requires owner secrets and approval — see `docs/intelligence/DEPLOYMENT_AND_ROLLBACK.md`.

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

All responses carry `x-mudaala-trace-id` (echoed from the caller or generated) and `cache-control: no-store`. Errors use the stable envelope-error codes from the contracts (`AUTH_MISSING`, `AUTH_BAD_SIGNATURE`, `AUTH_REPLAY`, `AUTH_CLOCK_SKEW`, `SCOPE_DENIED`, `PAYLOAD_TOO_LARGE`, `PAYLOAD_INVALID`, `RATE_LIMITED`, `MODULE_DISABLED`, `MODULE_TIMEOUT`, `MODULE_INTERNAL`, `IDEMPOTENCY_CONFLICT`, …).

## Service authentication

HMAC-SHA256 over the canonical string `callerId \n secretId \n METHOD \n /path \n timestampSeconds \n sha256Hex(body)` (body hashed as raw UTF-8 bytes), ±90 s clock window, atomic nonce replay protection. The canonicalisation lives in `src/auth.ts` (`signRequest`); the commerce-plane client implements the same scheme and both are pinned by tests.

**Replay protection (remediated):** consuming a nonce is ONE atomic operation (`NonceCache.consume`) — the increment-1 seen-check/record split had a race where two concurrent identical requests could both pass. The Durable Object decides in a single synchronous block and owns exactly one shard per `(caller, nonce)` (`n:<callerId>:<nonce>`), so callers cannot pre-burn each other's nonces. Every consume arms a DO alarm at expiry; `alarm()` deletes the shard storage, so nonce records never outlive their TTL and the namespace cannot grow without bound. Header values (caller id, secret id, nonce, timestamp, signature) are format- and length-checked before use — malformed values fail closed as `AUTH_MISSING` and are never echoed.

**Payload limits (remediated):** the 32 KiB cap is enforced WHILE STREAMING the request body and measured in UTF-8 bytes — oversized or chunked/misleading-Content-Length requests are cancelled as soon as the cap is crossed, never fully buffered. The signature is computed over the exact bytes received.

The caller registry is the `INTELLIGENCE_CALLERS` secret (JSON map: callerId → `{secretId, secret, scopes, rateLimitPerMinute, enabled}`). Rotate by adding a new secretId, flipping `enabled`, then removing the old entry.

## Guarantees

- **Fail-closed at the gateway:** missing auth, replay, bad scope, oversize payload → request rejected.
- **Fail-safe for commerce:** every non-200 is a signal for the commerce client to fall back to its local deterministic behaviour; gateway degradation never degrades mudaala.store.
- **No data access:** the worker has no Hyperdrive/DB/KV/R2 bindings; it cannot reach the commerce database by construction.
- **No payload logging:** only trace id, caller id, route, status and latency are observable.

## Development

```bash
bun test intelligence/gateway/            # auth, DO concurrency, streaming-cap and pipeline tests
npx tsc -p intelligence/gateway/tsconfig.json   # strict worker typecheck
```

`wrangler.jsonc` sets `workers_dev: false` — deploy is intentionally inert until the owner wires a service binding or internal route (see deployment doc). The DO class `IntelligenceLimiter` handles rate windows and nonce consume/expire; the memory implementations exist for tests and local dev only (they implement the same atomic `consume` semantics).
