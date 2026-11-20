# Mudaala Intelligence — Deployment and Rollback Procedure

**Status:** Procedure documented; nothing deployed. **Every step marked (APPROVAL) requires the owner's explicit go-ahead** (master plan §16: no merge to main, no production deployment, no new secrets without approval).

## Increment-1 deployment topology

| Component | Host | Deployable? | Notes |
|---|---|---|---|
| Intelligence gateway | Cloudflare Workers (separate worker `mudaala-intelligence-gateway`) | Config + procedure ready | Requires `INTELLIGENCE_CALLERS` secret + DO migration; `workers_dev: false` |
| Module engines (MCI-01/02/03/08/27) | Inside the gateway worker | Same deployment | In-process dispatch; no separate service |
| Hermes control plane | Modal (or dedicated CPU host) — **not yet provisioned** | No | Requires owner's Modal workspace; skeleton runs locally today |
| Commerce-plane client | `src/lib/intelligence/gateway-client.ts` | Shipped flag-OFF | No route references it; enabling = next increment after gateway staging |
| Job store | Draft SQL only | No | Owner approval gate (ADR-0004) |

## A. Gateway deployment procedure (staging first)

1. **(APPROVAL)** Owner approves gateway deployment to a staging environment and provisions:
   - `INTELLIGENCE_CALLERS` (JSON caller registry; the `secret` values inside are provisioned secrets, never committed);
   - `GATEWAY_VERSION` (optional);
   - an internal access path: a **service binding** from the commerce worker (add to commerce `wrangler.jsonc` when wiring is approved) or a WAF-restricted internal route. `workers.dev` is disabled by config.
2. `cd intelligence/gateway && npx wrangler deploy --env staging` (config uses no environment-specific routes; verify the DO migration `v1-intelligence-limiter` applies cleanly).
3. Verify `GET /healthz` returns `{"ok":true,...}` **from the internal path only**; confirm the public workers.dev URL is NOT reachable.
4. Run a signed smoke request (one caller, `search:understand`) and check the envelope + trace echo.
5. Negative checks: unsigned request → 401; replayed nonce → 409; disabled-caller → 401; kill switch secret set → all `/v1/*` return 503 `MODULE_DISABLED`.

## B. Rollback / kill switches (in escalation order)

1. **Per-caller disable** — set `"enabled": false` for the caller in `INTELLIGENCE_CALLERS` and redeploy the secret (seconds; no code change).
2. **Global kill switch** — `wrangler secret put INTELLIGENCE_GATEWAY_DISABLED "true"`; all `/v1/*` return 503 `MODULE_DISABLED` immediately (health endpoints stay up).
3. **Commerce side** — unset `INTELLIGENCE_GATEWAY_URL` (or set `INTELLIGENCE_CLIENT_DISABLED=true`) in the commerce environment: the client turns off entirely and every caller falls back to local behaviour. **This is the primary rollback for commerce**: because no route is wired in increment 1, the commerce plane needs no rollback at all.
4. **Worker removal** — `npx wrangler delete` the gateway worker. Commerce is unaffected (service-binding-less increment).

Rollback is tested by construction for commerce (client returns `null` on any absence/failure — covered by `gateway-client.test.ts`); the DO migration rollback is `wrangler rollback` to the previous deployment (standard Workers semantics, untested here because nothing is deployed — honest status).

## C. Hermes deployment (when owner provisions Modal)

1. **(APPROVAL)** Modal workspace + spend cap. Verify current plan limits and region latency from Uganda **before** committing (master plan §5.2 provider-selection gate).
2. Start with the control-plane skeleton behind a private URL: `modal deploy intelligence/hermes/modal_app.py` (**file does not exist yet** — the deployment target is `hermes.server:app`; the Modal wrapper is a next-increment deliverable once the workspace exists).
3. Prove: process supervision across restarts, min-container behaviour, health-check alerting, cost telemetry — the WS-3 evidence list — before any "always-on" claim.
4. The default backend has NO registered handlers: deployment is inert until reviewed handler code ships with a release.

## D. What this increment deliberately does NOT deploy

- No production routes call the gateway (client flag-off; zero route changes).
- No schema migration (`intelligence/jobs/schema.sql` is draft).
- No customer-facing intelligence behaviour anywhere.
- No paid spend of any kind.

## E. Verification checklist before ANY production enablement (later increments)

- [ ] Staging negative tests pass (401/409/413/429/503 matrix — automated in `gateway.test.ts`, re-run against the deployed gateway).
- [ ] Latency budget measured from Uganda: gateway overhead p95 ≤ 50 ms target (master plan §11.2) — unmeasured today.
- [ ] `INTELLIGENCE_CALLERS` rotation drill done (add second secretId, flip, remove).
- [ ] Kill-switch drill done end-to-end.
- [ ] Owner sign-off recorded in the PR and in `contracts/registry.json` status transitions.
