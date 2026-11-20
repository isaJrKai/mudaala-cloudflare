# Mudaala Intelligence — Operations and Cost Documentation

**Status:** Increment-1 operations posture and cost model assumptions. Every cost figure is an **assumption or placeholder** unless it is a measured value from this repository's test runs — nothing here is a price quote, and no provider pricing has been verified from Uganda yet (master plan §5.2 requires that check before provider selection).

## 1. Operational surfaces and owners

| Surface | Runs where | Health signal | Kill switch | Owner |
|---|---|---|---|---|
| Intelligence gateway | Cloudflare Workers (separate worker) | `/healthz`, `/version`, Worker observability (enabled in config) | `INTELLIGENCE_GATEWAY_DISABLED` secret; per-caller `enabled: false` | unassigned — owner to assign |
| Module engines | In-process in the gateway | Envelope error rates, latency per route | Per-module `MODULE_DISABLED` responses (route-level disable is a gateway config change) | unassigned |
| Hermes control plane | Not deployed (local skeleton) | `/healthz` on the local/server instance | Process-level; no production instance exists | unassigned |
| Evaluation harness | CI (`validate-intelligence.yml`) + manual runs | CI green; versioned reports in `intelligence/eval/reports/` | n/a (read-only) | unassigned |
| Job store | Draft SQL only | Reconciliation query in `intelligence/jobs/schema.sql` | Not applied | unassigned |

**Owner is `unassigned` in every row — that is deliberate and honest.** Resource matrix §11 requires named owners; the repository owner must assign them before statuses advance past IN_DEVELOPMENT.

## 2. Observability (what is wired vs planned)

Wired in code now:
- Gateway responses: `x-mudaala-trace-id` on every response; stable error codes; `cache-control: no-store`; Worker observability enabled in `wrangler.jsonc`.
- Hermes: append-only JSONL audit (task/skill/actor/outcome, never payloads); task records carry steps/tool-call usage and timestamps.
- Client: breaker state observable in-process; reason codes distinguish disabled/breaker/timeout/gateway/network.

Planned (next increments): trace propagation into the commerce plane's request logs; per-route latency histograms; queue-depth/dead-letter alerts (needs the durable store); spend telemetry (needs a deployed, spend-bearing component — none exists).

## 3. Cost model (assumptions, not quotes)

Current month cost of increment 1: **≈ 0 — nothing is deployed.** Repository-level costs are Cloudflare Pages/Workers already paid for the commerce app; the gateway would share that account.

Forward model, per component (all values are assumptions to verify against live provider pricing):

| Component | Cost driver | Increment-1 assumption | Verification step |
|---|---|---|---|
| Gateway worker | Requests + DO operations | Negligible at server-to-server volumes (two callers, flag-off today) | Measure after staging deploy; re-check Cloudflare plan terms |
| Hermes always-on | Minimum container hours | UNKNOWN — the single biggest open cost question; Modal Starter credits do not guarantee a free always-on runtime (master plan explicitly warns this) | WS-3 measured always-on trial in the owner's Modal workspace |
| Batch/training (Modal) | CPU/GPU-seconds | Not incurred in increment 1 (no training) | Per-job budget caps + owner-approved spend ceiling before any GPU run |
| Model APIs | Tokens | Zero — no LLM is wired; Hermes token budget contract-locked at 0 | Privacy/security review required before ANY user data reaches a provider |
| Storage (artifacts/reports) | GB-months | Reports are small JSON, committed in Git | Object storage only when datasets exist (dataset registry rules) |
| Egress Uganda→provider | GB | Unknown; a provider-selection input from Uganda measured latency/egress | Provider benchmark from Uganda (master plan §5.2) |

**Budget controls already in code** (master plan principle 12): job budgets with hard caps and bounded backoff (`contracts/jobs.ts`); `GPU_BATCH` submissions flagged for explicit owner approval; Hermes max-model-tokens locked at 0; gateway per-caller rate limits; 32 KiB payload caps; single bounded retry in the commerce client.

**Rule that survives every increment:** no automatic spend expansion. Any new spend-bearing component requires owner approval recorded in the PR and in this document's log below.

## 4. Operational runbook pointers

- Gateway incident: set the global kill switch → commerce continues on local fallbacks (drill procedure: `DEPLOYMENT_AND_ROLLBACK.md` §B).
- Caller credential rotation: add a new `secretId` entry, deploy secret, flip caller, remove old entry (zero-downtime because signing is per-request).
- Rate-limit tuning: caller registry `rateLimitPerMinute`; the DO is sharded per key, so tuning is config-only.
- Benchmark drift: re-run `bun run intelligence/eval/run-benchmark.ts --out intelligence/eval/reports/<stamp>.json` after ANY weight/fixture/contract change and compare against the previous report before merging.

## 5. Change log

| Date | Change | Approval |
|---|---|---|
| 2026-11-20 | Increment 1 built on branch `feat/intelligence-foundation-2026-11-20`; nothing deployed, zero spend | Pending owner review (this document is part of the review) |
