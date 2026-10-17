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
| P0 | Shop creation / deletion | **Prisma reuse fix deployed; CPU errors absent in sampled post-release window, but two non-CPU 500s need investigation** | Main commit `a9b2d5b0e6c3e66e35eac9756ba0499d317ca21f` contains the per-isolate Prisma client reuse fix. Cloudflare reports version `e19f1b62-b3fb-49a4-83fb-d6ecb2cc8747` serving 100% traffic from 2026-10-17T17:14:36Z. A telemetry query for 17:14–18:58 UTC recorded zero `exceededCpu` events, but recorded HTTP 500s on `GET /api/listings?page=1&pageSize=10` (10.17s wall time, 48ms CPU) and `GET /api/shops/search?q=gras` (733ms wall time, 52ms CPU), both from Node-based Microsoft-hosted probes. Root cause is not established. Next: capture actionable exception details safely, reproduce these public GETs, then exercise shop create/delete using controlled test accounts. Do not call the reliability gate complete yet. |
| P0 | Photo upload and persistence | **Working in the current app; user-confirmed** | Isaac confirms photo uploads work in the current Mudaala version. Earlier upload/storage logs also show successful uploads and public image delivery. Do not treat this as an active bug or ask for another upload test unless a new failure is reported. The previous post-release fresh-upload telemetry gap was based on an outdated checklist assumption. Never accept local `/uploads` as durable production storage. |
| P0 | Account isolation and database least privilege | **Production runtime role remains over-privileged; CategoryInterest deny-policy fix prepared in a branch, not deployed** | Read-only checks on 2026-10-17: Security Advisor returned zero lints; all 13 public tables have RLS enabled; `anon` and `authenticated` have no table grants. The existing deny-all Data API migration covers 12 tables but omitted `CategoryInterest`. Branch `fix/category-interest-deny-policy` adds an idempotent policy migration and updates disposable-Postgres CI to assert 13 policies and zero direct grants; required CI must pass before merge. Separately, Cloudflare Hyperdrive authenticates as `postgres`, which has `BYPASSRLS`, `CREATEROLE`, `CREATEDB`, and `CREATE` on `public`. This remains the larger security gap: design a restricted runtime role compatible with current application authorization, review rollback, prove behavior in disposable CI, then schedule a controlled production credential cutover. No production database permissions or credentials were changed. |
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

- [x] Inspect production database role, grants, RLS policies and direct Data API exposure (read-only, 2026-10-17).
- [x] Read-only investigation confirmed the configured production Hyperdrive database user maps to the powerful `postgres` role; the role has `BYPASSRLS` and schema `CREATE` privilege. This is a confirmed gap, not a completed fix.
- [ ] Add the missing `deny_direct_api_clients` policy for `CategoryInterest` after reviewing a minimal, reversible SQL change.
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


## Independent audit reconciliation (2026-10-17)

Copilot's 91% score is not a measured readiness score: the audit does not define a weighted rubric or provide production evidence for the KPI targets. Use the following evidence-based status instead.

### Already implemented (do not rebuild without a demonstrated gap)

- PR validation runs against disposable PostgreSQL, validates/generates Prisma, builds the Cloudflare Worker, tests photo-storage fail-closed behavior, tests shared Durable Object rate limits, verifies Data API deny policies and a restricted CI role, runs API/account-isolation/moderation/photo tests, and exercises saved-search persistence, listing lifecycle and mobile cart behavior in Playwright.
- Main-branch deployment builds the Worker, captures the current production version, checks `/api/health`, verifies the shared rate limiter and cookie-only auth mode, and attempts rollback plus a post-rollback health check if the release gate fails.
- Cloudflare Worker observability is enabled. This is evidence of telemetry collection, not proof that alert delivery, SLO dashboards or incident response are configured.
- User-confirmed shop creation/deletion, Browse, badge display, preferences and photo upload are recorded above; do not reopen working features without a specific new failure.

### Verified gaps / next actions

- **P0 database privilege:** production Hyperdrive still uses the powerful `postgres` role. The Data API policy for `CategoryInterest` is being added on `fix/category-interest-deny-policy`; the restricted production runtime-role cutover remains separate and not yet done.
- **P0 reliability:** CPU reuse fix is deployed and no `exceededCpu` events were recorded in the checked post-release window. Two public GET requests returned HTTP 500 shortly after deploy; investigate before calling production stable.
- **P1 customer journey:** existing browser tests do not cover the complete public journey from Browse → listing detail → call/WhatsApp contact, nor a full shop link/QR open. Add deterministic coverage using seeded disposable records; avoid destructive production tests.
- **P1 performance:** no measured field p95/LCP/INP/CLS baseline or representative load-test result is recorded. Do not claim sub-500ms p95 or 99.99% uptime until measured. Google Core Web Vitals use LCP ≤2.5s, INP ≤200ms and CLS ≤0.1 as “good” field thresholds; these are more defensible initial web UX targets than a blanket <500ms page-load claim.
- **P1 recovery:** no verified backup-restore drill is evidenced in this checklist. Document the backup source/retention and restore to a disposable database before calling recovery ready.
- **P1 supply chain / CI:** PR CI currently lacks a blocking lint step and a blocking dependency vulnerability audit; the Knip audit is explicitly `continue-on-error`. Add lint and a suitable lockfile/dependency scan, then triage findings instead of silently suppressing them.
- **P1 operations:** deploy rollback exists, but a canary traffic split, alert routing, tested incident contact list and measured MTTR are not evidenced. Prioritize actionable failure alerts and a tested rollback/restore runbook before building a large custom admin dashboard.
- **P2 product analytics:** seller views/contacts/conversion analytics and response-time measurement should follow reliable event definitions and privacy boundaries; don't invent KPI claims.

### Market position: compete on the job Mudaala does best

Mudaala is currently a shop identity and shareable product-catalogue tool with direct phone/WhatsApp contact, not an in-app checkout marketplace. Jiji Uganda offers broad classifieds, category/location/price filtering, seller contact, feedback and paid promotion; WhatsApp Business offers product catalogues, shareable catalog/item links, collections and cart-to-chat. Mudaala should not attempt to match Jiji's listing volume or WhatsApp's messaging platform immediately. Its near-term edge should be a lightweight, persistent, mobile-first storefront for Ugandan small shops, simple photo-backed listing management, dependable direct contact, stable shop links/QRs, clear availability/prices and honest trust/safety guidance. Build density and trust in one launch market before expanding geography.

References for competitor feature checks:
- Jiji Uganda buyer/seller flow and safety guidance: https://jiji.ug/faq/26 and https://jiji.ug/about.html
- WhatsApp Business catalog features: https://whatsappbusiness.com/products/business-app-features/
- WhatsApp catalog details: https://faq.whatsapp.com/405903568419894/?helpref=uf_share
- Google Core Web Vitals thresholds: https://support.google.com/webmasters/answer/9205520?hl=en

