# Mudaala — Master Project Checklist

**Last reconciled:** 2026-10-17 (UTC+3; deletion CPU error correlated and focused no-video fix prepared)  
**Production app:** https://mudaala-cloudflare.kaisoisaac.workers.dev  
**Repository:** https://github.com/isaJrKai/mudaala-cloudflare

This is the canonical project checklist. Use it across Mudaala conversations instead of starting competing checklists. Individual chats can work on a task, but status changes belong here after evidence is available.

## Operating rules

- Follow **Investigate → Fix → Test → Deploy → Verify → Update this checklist**.
- A commit, a green build, or a merged PR is not proof that production works.
- Do not mark an item complete without evidence. Distinguish CI-only evidence from production evidence.
- Avoid duplicate implementations. Extend the existing feature and preserve existing accounts, listings, shop data, and working flows.
- Never run a destructive migration or change production data/security policies without reviewing the exact impact and rollback path.
- Production stack is Cloudflare Workers + Supabase/Postgres. Do not reintroduce the old Render runtime.
- Video media is a separate future capability; do not let it block photo fixes or ship it before its schema migration, CI, storage and live playback checks are safe.
- No fabricated listings, customer activity, testimonials, or verification badges.

## Current control board

| Priority | Workstream | Status | Evidence / next action |
|---|---|---|---|
| P0 | PR #87 reconciliation / saved-search and listing concurrency | **Merged and deployed; production smoke evidence positive** | Stale PR #87 was superseded by [PR #104](https://github.com/isaJrKai/mudaala-cloudflare/pull/104), which passed required CI and merged as `9d8ded6c826249526a9f729b850f38d0e064d095`. Cloudflare shows version `4945a9f4-6e0c-442c-9ce9-0f46de22ad88` serving 100% traffic from 2026-10-17 11:11 UTC. Production health returned HTTP 200 with database connection logs; sampled Browse requests on the new version returned HTTP 200. Continue observing for recurrence; this is not a zero-risk guarantee. |
| P0 | Shop creation / deletion | **Intermittent delete failure correlated with Worker CPU exhaustion; isolated fix proposed, not deployed** | Founder reports sample shop creation/deletion succeeded after a first error. Cloudflare observability shows `DELETE /api/account` failed with “Worker exceeded CPU time limit” at 2026-10-17T13:28:30.542Z; a public shop GET failed from CPU exhaustion within the same second. Code inspection found `src/lib/db.ts` constructs a fresh Prisma client and pg adapter on each model-property access and sets `maxUses: 1`. A focused branch `fix/worker-db-reuse-no-video` now proposes reusing one Prisma client per Worker isolate, without video changes. Required next: run CI/regression tests, review connection lifecycle and deploy only after passing; then verify production telemetry. No production code changed. |
| P0 | Photo upload and persistence | **Working in the current app; user-confirmed** | Isaac confirms photo uploads work in the current Mudaala version. Earlier upload/storage logs also show successful uploads and public image delivery. Do not treat this as an active bug or ask for another upload test unless a new failure is reported. The previous post-release fresh-upload telemetry gap was based on an outdated checklist assumption. Never accept local `/uploads` as durable production storage. |
| P0 | Account isolation and database least privilege | **P0 security gap confirmed: production Worker is configured to connect as the powerful `postgres` database user** | Read-only checks on 2026-10-17: Security Advisor returned zero lints; all 13 public tables have RLS enabled; `anon` and `authenticated` have no table grants and have deny-all policies. Cloudflare config shows the Worker prefers `HYPERDRIVE`; its production Hyperdrive origin is configured with the project's `postgres` database user. The database role inspection shows `postgres` has `BYPASSRLS` and `CREATE` on `public`. Therefore, RLS does not constrain queries made through that connection. Do not mark security complete: design a restricted runtime role and an account-isolation/RLS strategy, review impact and rollback, test in disposable CI first, then deploy and verify. No production settings were changed during this investigation. |
| P1 | Scheduled maintenance origin | **Successful scheduled sweep verified** | The origin fix is on `main` in commit `fb9e0ba7`. Cloudflare telemetry for the scheduled run at `2026-10-17T03:00:30Z` recorded outcome `ok`; the sweep endpoint completed with HTTP 200. It processed zero expired listings, zero expiring notifications, and zero price snapshots because none were due. This verifies execution, not behavior when records are due. |
| P1 | PR #89 — Worker DB reuse + video media | **Draft; not for production** | Requires CI, reviewed additive videoUrl schema migration, configured durable media storage, and authenticated upload → save → refresh → playback verification. Keep separate from photo bug fixes. [PR #89](https://github.com/isaJrKai/mudaala-cloudflare/pull/89) |
| P1 | Public customer journey | **Browsing confirmed by founder; contact actions still need verification** | Founder confirms customers can browse listings. Remaining: open detail → call/WhatsApp → shop link/QR, plus mobile/slow-connection checks. |
| P1 | Admin badge and permissions | **Badge works per founder; privilege boundary still needs security verification** | Founder confirms the badge works. Still verify an ordinary user cannot gain admin privileges and that admin-only endpoints reject ordinary users. |
| P2 | Settings and preferences | **Preferences work per founder; detailed audit not required unless a defect appears** | Founder confirms preferences work. Reopen only for a specific reported problem or a security/privacy concern. |
| P2 | Search quality | **Incremental work after stability** | Fix Unicode/normalization and practical Uganda-first product vocabulary; verify exact model terms outrank overly broad matches without inventing product claims. |
| P2 | Product polish and future video | **Do not block stability work** | Preserve green + warm mango/yellow accents and botanical identity. Video stays deferred until its separate release gate passes. |



### Latest read-only production inspection (2026-10-16)

- Supabase project status: ACTIVE_HEALTHY; region eu-west-2.
- Security Advisor: no security lints returned (rechecked 2026-10-17).
- Performance Advisor: five unused-index notices only (INFO); no index was removed because current usage may be low-volume and deletion needs workload evidence.
- Read-only SQL recheck: 13 public base tables, all 13 have RLS enabled. The inspection connection ran as `postgres`, so this does not identify the Worker runtime role; that gap remains open.
- RLS: enabled on all 13 public application tables.
- Direct Data API access: `anon` and `authenticated` have no table grants; deny-all policies exist on the application tables.
- Cloudflare Worker: active deployment `4945a9f4-6e0c-442c-9ce9-0f46de22ad88` serving 100% traffic from 2026-10-17 11:11 UTC. Initial post-release sample through 12:09 UTC: health HTTP 200, 17 Browse requests HTTP 200, no Worker `error`-level or `exceededCpu` events. Follow-up telemetry query for 12:00–12:46 UTC on Oct 17 returned zero matching `/api/listings` events and zero matching `exceededCpu` events; this means no matching events were recorded in that query window, not that Browse was actively exercised or permanently proven healthy. Follow-up Supabase Storage log query for upload activity in that same window returned no records. The previous version had six Browse `503 / exceededCpu` events plus one HTTP 500 in the inspected pre-release window. Continue monitoring production health. Photo uploads are confirmed working by the user in the current app; do not infer a current upload defect from missing telemetry alone.
- Worker secret values were not read. The founder confirms photo uploads work in the current app; do not mark uploads as an active defect based solely on missing post-release telemetry.
- Production live smoke workflow passed on 2026-10-16 16:31 UTC: health, anonymous auth, public listing detail, shop-name search, admin flag, persisted cover-photo delivery, and browser rendering of three existing listing photos. This still does not prove a fresh authenticated upload succeeds.
- These read-only checks did not change production data or settings.

## Immediate execution queue

### 1. Reconcile saved-search and listing lifecycle work

- [x] Superseded stale PR #87 with [PR #104](https://github.com/isaJrKai/mudaala-cloudflare/pull/104), based on current `main` and preserving current database, photo-storage and mobile fixes.
- [x] Required CI passed before merge; PR #104 merged as `9d8ded6c826249526a9f729b850f38d0e064d095`.
- [x] Verified Cloudflare production version `4945a9f4-6e0c-442c-9ce9-0f46de22ad88` is serving 100% traffic.
- [x] Post-release health telemetry: `/api/health` returned HTTP 200 and `[startup-db] connected` was recorded.
- [x] Post-release Browse telemetry: 17 sampled `/api/listings` HTTP requests returned 200; no `error`-level or `exceededCpu` events were found for the new version in the checked window.
- [ ] Continue monitoring because intermittent errors can recur outside the sampled window.

### 2. Confirm scheduled maintenance execution

- [x] Cloudflare scheduled invocation at `2026-10-17T03:00:30Z` completed with outcome `ok` and HTTP 200.
- [x] Zero expired listings, expiring notifications and price snapshots were processed; no records were due, so due-record behavior remains untested.

### 3. Confirm the live shop and photo journey

- [x] Founder reports the live product and shop-owner journey were manually tested successfully (2026-10-17).
- [x] Independent Supabase Storage logs show successful S3 uploads at `2026-10-16T15:52:10Z` and `2026-10-17T06:01:23Z` (HTTP 200), paired with Worker `/api/upload` HTTP 201 at `2026-10-17T06:01:23Z`.
- [x] The stored public image was fetched from Supabase Storage with HTTP 200 after the latest Worker release; profile/listing API reads also returned 200.
- [x] Photo upload status reconciled with current app: user confirms profile/listing photo uploads work. Reopen only if a new reproducible failure appears.
- [ ] Independently capture reproducible test evidence for account isolation and public contact actions; do not ask the founder to repeat already-completed tests unless a specific failure requires it.

### 4. Security release gate

- [ ] Inspect production database role, grants, RLS policies and direct Data API exposure.
- [x] Read-only investigation confirmed the configured production Hyperdrive database user maps to the powerful `postgres` role; the role has `BYPASSRLS` and schema `CREATE` privilege. This is a confirmed gap, not a completed fix.
- [ ] Design and review a restricted runtime role plus compatible authorization/RLS policy strategy; preserve the existing app and data.
- [ ] Test the proposed role and cross-account isolation in disposable CI before any production change.
- [ ] Test owner/admin boundaries with separate test accounts without modifying real customer records.
- [ ] Verify secrets are not exposed to client bundles or logs.
- [ ] Record production evidence and a rollback plan before any security migration/policy change.

### 4. Deployment release gate

- [ ] Required CI passes on the exact commit intended for release.
- [ ] Review the diff and migration impact.
- [ ] Deploy only the intended release.
- [ ] Check Cloudflare deployment/version and live health.
- [ ] Run relevant production smoke tests without destructive writes.
- [ ] Verify logs and scheduled execution where applicable.
- [ ] Update this checklist with commit/PR, tests, deployment version, evidence and remaining failures.

## Coding-learning commitment

The founder's planned daily study block is **one hour**. Keep learning scoped to the work being done: Git/branches and diffs first, then TypeScript/React form flow, API routes, PostgreSQL/Supabase and RLS, then automated testing and deployment. Learning is a parallel track, not a reason to delay fixing the current production blocker.

## Update format for every Mudaala work session

Record:
1. **Investigated:** exact file/route/production behavior inspected.
2. **Changed:** commit/PR and files changed.
3. **Tested:** commands and results; clearly label disposable CI vs production.
4. **Deployed:** exact deployment/version, or explicitly “not deployed”.
5. **Verified:** actual observed production result.
6. **Next:** one highest-priority action.

Do not mark an item done just because code was written.
