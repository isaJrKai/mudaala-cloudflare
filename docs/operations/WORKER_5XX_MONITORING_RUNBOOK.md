# Mudaala Cloudflare Worker 5xx monitoring runbook

**Prepared:** 2026-10-30  
**Timezone:** Africa/Kampala (UTC+3)  
**Worker:** `mudaala-cloudflare`  
**Production origin:** `https://mudaala-cloudflare.kaisoisaac.workers.dev`

This is an operational proposal. It does not create Cloudflare alerts, save queries, change observability settings, or invoke production endpoints.

## 1. Daily monitoring window

Use a rolling 24-hour window and record the exact UTC start/end timestamps, converting report timestamps to Africa/Kampala. Also inspect a short 15-minute window around any incident.

Track separately:

- HTTP 5xx response count and rate, grouped by status, route template, outcome, and Worker version.
- Worker outcomes including `exceededCpu`, `exception`, `canceled`, and `ok`.
- CPU time and wall time distributions (p50/p95/p99 where available).
- Error-level events grouped by safe error template/class.
- Critical public paths: homepage, Browse/listing search, public listing detail, public shop, and `/api/health`.
- Scheduled sweep invocation, completion marker, HTTP result, and counters (`expired`, `expiringNotified`, `priceSnapshots`).

Do not treat 404, expected 401/403, validation 400, or rate-limit 429 as 5xx. Do not count canceled requests as server errors without corroborating evidence.

## 2. Suggested alert thresholds

Tune these after establishing a representative traffic baseline. These are proposed starting points, not configured alerts.

| Severity | Suggested trigger | Response |
|---|---|---|
| SEV-1 | Critical public route returns 5xx on 3 consecutive independent probes, or broad 5xx rate exceeds 5% for 5 minutes with at least 20 requests | Immediate investigation; verify multiple regions/clients; assess rollback with release owner |
| SEV-2 | At least 5 5xx responses in 10 minutes, or 5xx rate exceeds 1% for 10 minutes with at least 50 requests | Investigate affected route/version and database dependency |
| SEV-2 | Any confirmed `exceededCpu` outcome on a critical customer route; 3 or more within 15 minutes is a sustained incident | Correlate route, version, CPU time and request pattern |
| SEV-3 | A single isolated 5xx with no recurrence and healthy critical probes | Record and monitor; do not claim root cause from one event |
| SEV-2 | Scheduled sweep has no completion evidence within 15 minutes after its normal 06:00 EAT schedule | Inspect scheduled event, Worker logs and completion marker; do not invoke manually |

For low-volume periods, use absolute counts and critical-path probes as well as percentages. A percentage based on one or two requests is not a reliable rate.

## 3. Triage sequence

1. **Confirm scope:** exact time window, Worker version, status/outcome, affected route template, and whether the issue is still recurring.
2. **Check customer-critical paths:** use safe, read-only GET requests only. Do not submit forms, create accounts, publish listings, or trigger maintenance as a probe.
3. **Separate failure classes:** HTTP 5xx, CPU-limit outcome, canceled invocation, database/network error, and expected client response.
4. **Correlate dependencies:** compare Worker logs with Hyperdrive/Supabase pooler and Postgres logs for the same time window. Use request IDs privately for correlation; do not publish them.
5. **Compare versions:** determine whether failures began after a release and whether they are isolated to one version or route.
6. **Reproduce safely:** create deterministic tests against disposable/local PostgreSQL and a preview build. Do not reproduce by mutating production data.
7. **Choose remediation:** smallest scoped code/configuration change, regression test, exact-head CI, review, controlled deployment, and post-deploy verification. A rollback is a release-owner decision, not an automatic response to an uncorrelated single event.

## 4. Evidence to record

- Report timestamp in EAT and exact UTC query window.
- Worker script and version ID.
- Counts by HTTP status and Worker outcome.
- Route templates, not raw customer-specific URLs.
- Error class/template and safe stack/source mapping if available.
- CPU/wall-time percentiles and sample counts.
- Supabase/Hyperdrive corroboration or explicit UNKNOWN.
- Relevant GitHub run/commit/deployment links.
- Mitigation, owner, next review time, and closure evidence.

## 5. Privacy and safety

Never include secrets, cookies, Authorization headers, phone numbers, customer names, listing titles, full listing URLs/IDs, IP addresses, raw SQL parameters, or full request/response bodies in reports. Avoid querying or exporting customer data merely to debug an aggregate failure.

A zero-event result means only that no matching event was observed in that query window and dataset. It does not prove the path is healthy, the logger is complete, or the failure cannot recur.

A zero maintenance counter can be valid when no records were due, but it does not test the non-zero processing path. Verify execution, completion marker, counters, and due-record behaviour separately.

## 6. Current baseline note (2026-10-30)

The read-only 24-hour query ending 2026-10-29 23:26 UTC returned four HTTP 500 responses on Worker version 176; two were associated with public `/l/{id}` page requests. No `exceededCpu` outcome appeared in that window. This is a bounded baseline observation, not a claim of sustained health. See [listing-detail investigation](./LISTING_DETAIL_500_INVESTIGATION.md).
