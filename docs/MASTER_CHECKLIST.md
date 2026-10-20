# Mudaala — Master Project Checklist

**Last reconciled:** 2026-10-20 (UTC+3; PR #153 My Business workspace merged and deployed; PR #155 business products/sales/stock/analytics/export foundation merged as `6717c11b2acfe58e631335d004168f67ee2a0f46`, validated by [39456564703](https://github.com/isaJrKai/mudaala-cloudflare/actions/runs/39456564703), public regression by [39456564778](https://github.com/isaJrKai/mudaala-cloudflare/actions/runs/39456564778), and deployed by [39457298706](https://github.com/isaJrKai/mudaala-cloudflare/actions/runs/39457298706); post-deploy shop/search check [39457536578](https://github.com/isaJrKai/mudaala-cloudflare/actions/runs/39457536578) passed; post-deploy API/privacy/owner checks passed but browser photo render check [39457536544](https://github.com/isaJrKai/mudaala-cloudflare/actions/runs/39457536544) failed because the public feed had no photo-bearing listing for the fixture-dependent test; lazy-load performance PR #156 merged as `528ac8c4360210f24015dde62f5b67c35b1bd731`, validation [39457892043](https://github.com/isaJrKai/mudaala-cloudflare/actions/runs/39457892043) passed and deployment [39458897542](https://github.com/isaJrKai/mudaala-cloudflare/actions/runs/39458897542) queued; one isolated prior `Network connection lost.` event on `/api/auth/me` remains under recurrence monitoring; founder-session My Business and /admin checks, physical-phone QR/layout verification, backup/restore drill, phone-verification provider/app lifecycle, fixture-based browser photo verification, next scheduled sweep, and unpatched development-only `braces` advisory remain open)
**Production app:** https://mudaala-cloudflare.kaisoisaac.workers.dev  
**Repository:** https://github.com/isaJrKai/mudaala-cloudflare

This is the canonical project checklist. Use it across Mudaala conversations instead of starting competing checklists. Individual chats can work on a task, but status changes belong here after evidence is available.

## Operating rules

- **Execution freeze:** until the P0 reliability and database-privilege gates are closed, do not implement unrelated catalogue/collection layouts, trending products, likes/engagement, or video. Preserve the current public shop design. **Founder-approved exceptions (2026-10-18 and 2026-10-20):** PR #116 adds the home Post an Ad CTA, explicit social/email sharing, and content-based related products; the founder explicitly authorized My Business and trader-records work, implemented in PRs #153 and #155. This exception covers business records, inventory, sales, analytics, exports, promotions/collections and AI-ready architecture, not unrelated storefront redesign. Customer-specific taste learning remains future work until interaction signals and privacy/retention rules are designed.

- Follow **Investigate → Fix → Test → Deploy → Verify → Update this checklist**.
- **Founder directive — proactive Ugandan small-seller thinking (2026-10-19):** On every Mudaala task, actively consider adjacent real-world seller needs and edge cases, especially students and microbusinesses selling juice/drinks, cakes, mandazi, chapati, Rolex, snacks and similar goods. Check whether category choices and price units are explicit (e.g. per bottle, cup, piece, slice, plate, pack, dozen, or batch) so a price like UGX 1,000 is never ambiguous. Surface useful opportunities and record them in the backlog while completing the assigned task. This is a standing product-thinking requirement, **not permission to bypass the execution freeze above**: defer new catalogue/product features until the P0 gates are closed, and never mix unrelated scope into a bug-fix PR.
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
| P0 | Worker DB client lifecycle / intermittent public API 500s | **Request-scoped Prisma client deployed; current-version telemetry clean in a short sample, continue monitoring** | PR [#115](https://github.com/isaJrKai/mudaala-cloudflare/pull/115) fixed module-global Prisma/driver-pool reuse. Current version `4577326d-9ab8-44fe-aad5-a078abea82fa` reached 100% traffic via deployment `64f70f9a-5baf-455c-b2f2-c49003cf6d70` at 2026-10-19 23:19:27Z. Read-only Cloudflare Worker telemetry for 23:19:27–23:20:39Z recorded 0 HTTP 5xx and no `exceededCpu` outcomes (50 `ok` outcomes); this is a short observation window, not a permanence guarantee. The previous version `3ae1009e-648d-4d22-8bac-606392b43ac6` recorded 9 HTTP 503 / `exceededCpu` events on 2026-10-19 11:20–11:35Z, before later deployments. Keep monitoring and investigate if they recur; do not claim zero risk. |
| P0 | Photo upload and persistence | **Working in the current app; user-confirmed** | Isaac confirms photo uploads work in the current Mudaala version. Earlier upload/storage logs also show successful uploads and public image delivery. Do not treat this as an active bug or ask for another upload test unless a new failure is reported. The previous post-release fresh-upload telemetry gap was based on an outdated checklist assumption. Never accept local `/uploads` as durable production storage. |
| P1 | Home Post an Ad CTA, social sharing, and related products | **Merged and deployed; CI passed; recommendation endpoint not separately live-tested** | PR [#116](https://github.com/isaJrKai/mudaala-cloudflare/pull/116) replaces the four dashboard stat tiles with the agreed CTA, adds Facebook/X/Pinterest/email links alongside WhatsApp/copy/native share, and adds content-based related products on in-app and public ad pages. Cloudflare Worker version `e8ddf657-8fb6-412b-9269-92248622c716` (version 131) is serving 100% traffic via deployment `8a926874-ee04-4899-abf1-19a1a431db35`. Both PR validation workflows passed, including type-check, Worker build, API/account-isolation/photo tests, and browser journeys. No schema migration. Recommendations use product text overlap, category, comparable price, and location; category alone is not enough and weak matches are omitted. This is not yet a customer-specific fashion-taste model. Next: separately exercise the recommendation endpoint against live listing data and assess match quality as real stock grows. |
| P1 | Browse and product-card performance | **Pagination/ranking and new-upload thumbnails deployed; four legacy active photo URLs remain unoptimized; field performance baseline absent** | PRs [#112](https://github.com/isaJrKai/mudaala-cloudflare/pull/112), [#113](https://github.com/isaJrKai/mudaala-cloudflare/pull/113), and [#114](https://github.com/isaJrKai/mudaala-cloudflare/pull/114) implemented WebP thumbnails for new uploads, compact ranking candidates, and database pagination. Read-only production inspection on 2026-10-19 found 9 active non-seed photo URLs: 5 current-upload originals have matching `.thumb.webp` objects; 4 legacy URLs do not use the thumbnail naming convention. Do not alter or delete originals; plan a safe additive backfill only after the P0 gates. No field p95/LCP/INP/CLS baseline or representative load test is recorded. |
| P0 | Account isolation and database least privilege | **Runtime role, direct API boundaries and live admin/owner checks verified** | Read-only production SQL on 2026-10-19: 13/13 public tables have RLS enabled; 13/13 have deny-all policies for `anon` and 13/13 for `authenticated`; `mudaala_runtime` has 52 public-table grants, schema USAGE but no schema CREATE, no membership in `postgres`, and no elevated role flags. Supavisor logs show Cloudflare Hyperdrive authenticated as `mudaala_runtime`. Live verification [39338831344](https://github.com/isaJrKai/mudaala-cloudflare/actions/runs/39338831344) passed: anonymous admin access returned 401, ordinary-user admin access returned 403, non-owner listing changes were denied, owner edit succeeded, photo upload persisted and was fetched, and disposable test accounts were cleaned up. Continue monitoring; do not use customer accounts for destructive tests. |
| P1 | Scheduled maintenance origin | **Successful scheduled sweep verified** | The origin fix is on `main` in commit `fb9e0ba7`. Cloudflare telemetry for the scheduled run at `2026-10-17T03:00:30Z` recorded outcome `ok`; the sweep endpoint completed with HTTP 200. It processed zero expired listings, zero expiring notifications, and zero price snapshots because none were due. This verifies execution, not behavior when records are due. |
| P1 | PR #89 — Worker DB reuse + video media | **Draft; not for production** | Requires CI, reviewed additive videoUrl schema migration, configured durable media storage, and authenticated upload → save → refresh → playback verification. Keep separate from photo bug fixes. [PR #89](https://github.com/isaJrKai/mudaala-cloudflare/pull/89) |
| P1 | Public customer journey | **Browser contact/shop/QR journey and live contact-reveal API verified; physical QR scan still open** | [PR #143](https://github.com/isaJrKai/mudaala-cloudflare/pull/143) covers public contact reveal, `tel:`/WhatsApp links and shop navigation; [PR #145](https://github.com/isaJrKai/mudaala-cloudflare/pull/145) adds an accessible featured-shop QR SVG check and a live contact-reveal API check using the existing verifier's disposable listing. Current live verification [39340869802](https://github.com/isaJrKai/mudaala-cloudflare/actions/runs/39340869802) passed contact response matching without logging phone numbers, owner/admin boundaries, photo persistence, real-browser photo rendering and mobile Post navigation; live search [39340869801](https://github.com/isaJrKai/mudaala-cloudflare/actions/runs/39340869801) passed. Still verify a real phone's `tel:`/WhatsApp action and scan the displayed QR on a physical device before claiming the full live journey complete. |
| P1 | Mobile viewport overflow and listing-photo framing | **Automated viewport bounds pass; remaining reported right-side whitespace needs physical-device visual confirmation** | [PR #125](https://github.com/isaJrKai/mudaala-cloudflare/pull/125) and [PR #129](https://github.com/isaJrKai/mudaala-cloudflare/pull/129) are merged. Current combined-main validation run [39338786357](https://github.com/isaJrKai/mudaala-cloudflare/actions/runs/39338786357) passed at 320, 360, 375, 390, 414, and 640 CSS px; document and main widths matched at every width and 527 tests passed with 0 failures. The CSS containment fix is deployed and listing detail uses `object-contain`. Automated bounds checks cannot prove that the original Android screenshot's right-side blank space, squeezed controls and clipped labels look correct on a real phone. Download button remains explicitly out of scope. |
| P1 | Admin badge and permissions | **Badge and live authorization boundary verified** | Founder confirms the badge works. Live verification [39338831344](https://github.com/isaJrKai/mudaala-cloudflare/actions/runs/39338831344) confirmed anonymous admin analytics returns 401 and an ordinary authenticated account receives 403 for admin analytics/reports. Keep the server-side permission checks; do not infer admin status from client-supplied fields. |
| P1 | Fair featured-shop rotation | **Merged, deployed, and automated post-deploy checks passed; physical QR scan remains open** | PR [#151](https://github.com/isaJrKai/mudaala-cloudflare/pull/151) merged as `d18e9ff9090bbf2dc7747d0a52b5595a4dc7eef4`. Validation [39378736478](https://github.com/isaJrKai/mudaala-cloudflare/actions/runs/39378736478) passed the pure rotation policy and browser journey; public shop/listing verification [39378736427](https://github.com/isaJrKai/mudaala-cloudflare/actions/runs/39378736427) passed. It rotates among distinct named shops in current public listing results every 30 minutes, stable within each shared time bucket; no schema change, per-user tracking or impression records. Deployment [39382209948](https://github.com/isaJrKai/mudaala-cloudflare/actions/runs/39382209948) passed build, health/database, Browse/shop search, and rate-limit smoke checks. Worker version `3d8c07da-3135-4c29-83db-7e82270182b1` serves 100% traffic via deployment `525a64c7-f7ae-425f-9c6f-8db7617be553`. Post-deploy API/privacy/photo [39382385131](https://github.com/isaJrKai/mudaala-cloudflare/actions/runs/39382385131) and shop/search [39382385113](https://github.com/isaJrKai/mudaala-cloudflare/actions/runs/39382385113) passed. The bounded telemetry sample had no HTTP 5xx/CPU-limit outcomes but one error-level `Network connection lost.` on `/api/auth/me` without response status; monitor for recurrence. Physical phone QR scan remains an open manual check. |
| P1 | Admin dashboard analytics expansion | **Merged and deployed; authenticated founder-session UI confirmation still open** | PR [#152](https://github.com/isaJrKai/mudaala-cloudflare/pull/152) merged as `326158a03b6f5fec7eaf8c0770586594ed080b6e` after validation [39379215042](https://github.com/isaJrKai/mudaala-cloudflare/actions/runs/39379215042) passed. It adds aggregate growth, marketplace lifecycle/supply-demand, expiry, saved-search and notification counts, privacy-thresholded category/county distributions, moderation aggregates, and a live `/api/health` status panel. It returns aggregate counts only; category/county groups under five are suppressed. Deployment [39381928677](https://github.com/isaJrKai/mudaala-cloudflare/actions/runs/39381928677) passed all steps including database/app health, Browse/shop search, and shared rate-limit smoke checks. That deployment introduced Worker version `6f80e42e-27aa-4078-a16c-8d0c2fd1caf6`; the subsequent featured-shop release now serves Worker version `3d8c07da-3135-4c29-83db-7e82270182b1` at 100% traffic and retains these dashboard changes. Founder-session rendering/data loading is not yet independently confirmed in production. |
| P0 | Admin dashboard server-render failure | **Root cause fixed and deployed; authenticated founder-session render still needs confirmation** | Cloudflare telemetry on Worker version `a7edaddb-46d8-4fee-b831-29b22f8439ec` recorded repeated `/admin` HTTP 500s; deployed bundle line mapped to `Database access must run inside withRequestDb() in production`. PR [#149](https://github.com/isaJrKai/mudaala-cloudflare/pull/149) wraps the session check in `withRequestDb()`, keeps authorization fail-closed, adds a safe retry state and a `/#/account` return link. CI [39378088063](https://github.com/isaJrKai/mudaala-cloudflare/actions/runs/39378088063) passed; deployment [39378671833](https://github.com/isaJrKai/mudaala-cloudflare/actions/runs/39378671833) succeeded and introduced Worker version `78ddfb00-7d87-4875-b224-e11f1749973b`. Subsequent deployment `525a64c7-f7ae-425f-9c6f-8db7617be553` now serves Worker version `3d8c07da-3135-4c29-83db-7e82270182b1` at 100% traffic and retains this fix. Post-deploy live API/privacy/photo [39378828582](https://github.com/isaJrKai/mudaala-cloudflare/actions/runs/39378828582) and shop/search [39378828645](https://github.com/isaJrKai/mudaala-cloudflare/actions/runs/39378828645) checks passed. No post-deploy authenticated `/admin` request is yet present in the bounded telemetry sample, so the founder-session page render is not claimed complete. |
| P2 | Settings and preferences | **Preferences work per founder; detailed audit not required unless a defect appears** | Founder confirms preferences work. Reopen only for a specific reported problem or a security/privacy concern. |
| P1 | Opening-hours schedule selector (issue #126) | **Fixed, merged and browser-regression-tested** | [PR #136](https://github.com/isaJrKai/mudaala-cloudflare/pull/136) adds Daily/Weekdays/Mon-Sat presets, individual weekday selection, native time inputs, and save/reload parsing without a schema change. Validation run [39333045686](https://github.com/isaJrKai/mudaala-cloudflare/actions/runs/39333045686) passed, including the 390px mobile schedule journey. Do not rebuild unless a new reproducible failure appears. |
| P2 | Search quality | **Incremental work after stability** | Fix Unicode/normalization and practical Uganda-first product vocabulary; verify exact model terms outrank overly broad matches without inventing product claims. |
| P2 | Product polish and future video | **Do not block stability work** | Preserve green + warm mango/yellow accents and botanical identity. Video stays deferred until its separate release gate passes. |



### Latest read-only production inspection (2026-10-16)

- Supabase project status: ACTIVE_HEALTHY; region eu-west-2.
- Security Advisor: no security lints returned (rechecked 2026-10-17).
- Performance Advisor: five unused-index notices only (INFO); no index was removed because current usage may be low-volume and deletion needs workload evidence.
- Read-only SQL recheck: all 13 public application tables have RLS enabled, runtime policies cover all 13, and direct Data API deny policies cover all 13. Although the SQL inspection connection itself ran as `postgres`, Supavisor logs independently show Cloudflare Hyperdrive sessions authenticating as `mudaala_runtime` at `2026-10-18 10:58:39Z` and `11:19:17Z`.
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
- [x] After Prisma reuse deployment, a 24-hour telemetry query on 2026-10-17 found no HTTP 500 events for Browse or shop-name search and no error-level events in the latest two-hour sample; direct live API reads were unavailable from the verification client, so this is telemetry-only evidence, not a complete live smoke pass.

### 2. Confirm scheduled maintenance execution

- [x] Cloudflare scheduled invocation at `2026-10-17T03:00:30Z` completed with outcome `ok` and HTTP 200.
- [x] Zero expired listings, expiring notifications and price snapshots were processed; no records were due, so due-record behavior remains untested.

### 3. Confirm the live shop and photo journey

- [x] Founder reports the live product and shop-owner journey were manually tested successfully (2026-10-17).
- [x] Independent Supabase Storage logs show successful S3 uploads at `2026-10-16T15:52:10Z` and `2026-10-17T06:01:23Z` (HTTP 200), paired with Worker `/api/upload` HTTP 201 at `2026-10-17T06:01:23Z`.
- [x] The stored public image was fetched from Supabase Storage with HTTP 200 after the latest Worker release; profile/listing API reads also returned 200.
- [x] Photo upload status reconciled with current app: user confirms profile/listing photo uploads work. Reopen only if a new reproducible failure appears.
- [x] Account-isolation and ownership-boundary regression tests run successfully in disposable PostgreSQL under the restricted runtime role in [PR #120 validation run](https://github.com/isaJrKai/mudaala-cloudflare/actions/runs/39121952598); this is CI evidence, not a live production account test. [ ] Public contact actions still need safe end-to-end verification.

### 4. Security release gate

- [x] Inspect production database role, grants, RLS policies and direct Data API exposure (read-only, 2026-10-17).
- [x] Historical read-only investigation confirmed the previous Hyperdrive connection used the powerful `postgres` role (`BYPASSRLS` and schema `CREATE`). This gap was addressed by the restricted-runtime cutover below; retain the old config only for rollback.
- [x] Recheck the `CategoryInterest` Data API policy: `category_interest_deny_direct_api_clients` already denies all rows for `anon` and `authenticated` (`USING false`, `WITH CHECK false`). The policy name differs from the common name; no production policy change is needed. CI is being changed to validate policy behavior/table coverage rather than demand identical policy names.
- [x] [Runtime-role migration fix PR #109](https://github.com/isaJrKai/mudaala-cloudflare/pull/109) passed required CI in disposable PostgreSQL; production role flags/grants/RLS coverage were checked read-only.
- [x] Apply the corrected additive migration and verify 13 runtime policies, 52 table grants, no elevated role flags, and no schema `CREATE` (2026-10-17). The role was subsequently enabled for login so Hyperdrive can use it; read-only SQL confirms `rolcanlogin=true` and no membership in `postgres`.
- [x] Provisioned the restricted `mudaala_runtime` credential through the approved secret workflow and created Hyperdrive config `mudaala-runtime-db` (ID `2bdd2812396f49dc8d048a6a821d7313`); PR #110 switched the Worker binding and merged as `adf955f2b58a6d11e78764c3a963fcc301180640`. Production deployment run [39076114442](https://github.com/isaJrKai/mudaala-cloudflare/actions/runs/39076114442) passed deployment, live health/database, Browse, shop search and shared rate-limiter smoke checks. Authenticated owner/admin operations, photos and cron authorization still require separate production-safe verification.
- [x] Old `postgres` Hyperdrive config remains available for rollback; active binding metadata in `wrangler.jsonc` points to `mudaala-runtime-db` / `mudaala_runtime`, and read-only SQL confirms the role has no elevated flags, no `BYPASSRLS`, no schema `CREATE`, and no membership in `postgres`. Direct live Worker connection identity is verified by Supavisor logs: `Cloudflare Hyperdrive` authenticated as `mudaala_runtime` at `2026-10-18 10:58:39Z` and `11:19:17Z`, after Worker version 134 reached 100% traffic. This closes the runtime-role identity discrepancy.
- [x] CI owner-boundary tests use disposable accounts/database: non-owner edit/delete/refresh denied, anonymous edit denied, owner edit allowed, and `PATCH userId` cannot reassign listing ownership. PR #120 merged as `718a6b6207d9d8c902531b211b390d7c2b1ac2e0`; validation run [39121952598](https://github.com/isaJrKai/mudaala-cloudflare/actions/runs/39121952598) passed, including the API/account-isolation suite under `mudaala_runtime`. [ ] Live owner/admin boundary verification using disposable accounts remains open; do not use or mutate customer records.
- [ ] Verify secrets are not exposed to client bundles or logs.
- [ ] Record production evidence and a rollback plan before any security migration/policy change.

### 4. Deployment release gate

- [x] PR #107 required CI passed on its exact head (workflow run 221); production smoke gates are merged but will execute on the next application deployment.
- [ ] Required CI passes on the exact commit intended for each subsequent release.
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
- Main-branch deployment builds the Worker, captures the current production version, checks `/api/health`, verifies the shared rate limiter and cookie-only auth mode, and attempts rollback plus a post-rollback health check if the release gate fails. PR #107 (`e781147be8be3084ee5ecfbea2b9578de66607b2`) merged after its required CI passed; the next application deployment will run read-only Browse and shop-search response-shape checks and roll back on failure.
- Cloudflare Worker observability is enabled. This is evidence of telemetry collection, not proof that alert delivery, SLO dashboards or incident response are configured.
- User-confirmed shop creation/deletion, Browse, badge display, preferences and photo upload are recorded above; do not reopen working features without a specific new failure.

### Verified gaps / next actions

- **PR #106 database reuse reconciliation:** the current `src/lib/db.ts` on `main` and on `fix/worker-db-reuse-no-video` have the same content (SHA `98b72e99ceb4690a01c20a5df8d7a854e5805392`). The reuse fix is already in main commit `a9b2d5b0e6c3e66e35eac9756ba0499d317ca21f` and is running in production version `e19f1b62-b3fb-49a4-83fb-d6ecb2cc8747`. Do not merge PR #106 as a second code change; retain its context until its stale checklist diff is reconciled, then close/supersede it to avoid conflicting release records.

- **P0 database privilege:** the additive runtime-role migration from PR #109 is applied. Cloudflare Hyperdrive config metadata and `wrangler.jsonc` identify the Worker binding as `mudaala-runtime-db`, configured for `mudaala_runtime`; read-only SQL confirms the role has no elevated flags, no public schema `CREATE`, and no membership in `postgres`. Deployment smoke passed health/database, Browse, shop search and shared rate limiting. `CategoryInterest` has a deny-all Data API policy under a different name; PR #107 verifies policy behavior across all 13 tables. Remaining checks: active session identity where feasible and owner/admin boundaries, secret exposure, photo persistence and cron authorization.
- **P0 reliability:** intermittent public GET HTTP 500s were traced to unsafe module-global Prisma/driver-pool reuse across Worker invocations and addressed in PR #115. Production deployment and both independent live verification workflows now pass. Keep monitoring for recurrence; don't overstate stability from a short sample.
- **P1 customer journey:** existing browser tests do not cover the complete public journey from Browse → listing detail → call/WhatsApp contact, nor a full shop link/QR open. Add deterministic coverage using seeded disposable records; avoid destructive production tests.
- **P1 performance:** no measured field p95/LCP/INP/CLS baseline or representative load-test result is recorded. Do not claim sub-500ms p95 or 99.99% uptime until measured. Google Core Web Vitals use LCP ≤2.5s, INP ≤200ms and CLS ≤0.1 as “good” field thresholds; these are more defensible initial web UX targets than a blanket <500ms page-load claim.
- **P1 recovery:** no verified backup-restore drill is evidenced in this checklist. Document the backup source/retention and restore to a disposable database before calling recovery ready.
- **P1 supply chain / CI (reconciled 2026-10-20):** repository-wide ESLint and blocking production dependency audit are wired into PR CI. [PR #141](https://github.com/isaJrKai/mudaala-cloudflare/pull/141) fixed the invalid development audit option and merged as `9dc5d75dfc3a6dc36208976564b6baf030baa0e9`; [PR #142](https://github.com/isaJrKai/mudaala-cloudflare/pull/142) patched Prisma CLI's `deepmerge-ts` advisory to 8.0.2 without upgrading Prisma, merged as `857dd31cc3882946ebf474f4f7dfc78a4de0c5c5`. Combined current-main validation [39338786357](https://github.com/isaJrKai/mudaala-cloudflare/actions/runs/39338786357) passed: production audit reports 0 vulnerabilities; the all-dependency audit no longer reports `deepmerge-ts` but still reports the unpatched `braces` advisory via Next ESLint tooling (five audit findings along the same advisory chain). Upstream currently lists no patched version, and npm's suggested force-fix would downgrade `eslint-config-next` to 14.2.35. Keep the advisory visible in [issue #132](https://github.com/isaJrKai/mudaala-cloudflare/issues/132); do not force-fix, downgrade Next, or suppress it.
- **P1 operations:** deploy rollback exists, but a canary traffic split, alert routing, tested incident contact list and measured MTTR are not evidenced. Prioritize actionable failure alerts and a tested rollback/restore runbook before building a large custom admin dashboard.
- **P2 product analytics:** seller views/contacts/conversion analytics and response-time measurement should follow reliable event definitions and privacy boundaries; don't invent KPI claims.

### Latest performance and runtime recheck (2026-10-18)

- Production Worker version `2b4179be-6440-4dca-a9d8-d27c09734502` is confirmed at 100% traffic.
- Deployment smoke passed: health/database, Browse response shape, shop-name search, and shared rate-limit reachability. The two independent live verification workflows also passed, including API/privacy checks, real-browser photo rendering, mobile publish navigation, and customer-facing search semantics.
- The root cause of the intermittent HTTP 500s was consistent with a module-global Prisma/node-postgres pool being retained across Cloudflare Worker invocations. PR #115 now scopes the client to each request and lets Hyperdrive keep the upstream pool warm. Cloudflare's guidance: [connection lifecycle](https://developers.cloudflare.com/hyperdrive/concepts/connection-lifecycle/) and [connection pooling](https://developers.cloudflare.com/hyperdrive/concepts/connection-pooling/).
- A read-only telemetry query found zero HTTP 500 events in the latest 10-minute sample after deployment. Continue monitoring for recurrence.
- Wrangler emitted a warning that `RateLimitShard` is not exported from the Worker bundle. The shared-limiter smoke and live route checks passed, but reconcile this warning before future runtime upgrades.
- Existing product photos are not yet backfilled to thumbnails: 4 active listing photo URLs were found, all using legacy names. New uploads generate thumbnails. Do not claim old photos are optimized until the backfill is completed and verified.
- No representative field p95/LCP/INP/CLS or load-test baseline has been recorded; database-work reduction is implemented, but don't claim a measured speedup until latency is measured.

### Market position: compete on the job Mudaala does best

Mudaala is currently a shop identity and shareable product-catalogue tool with direct phone/WhatsApp contact, not an in-app checkout marketplace. Jiji Uganda offers broad classifieds, category/location/price filtering, seller contact, feedback and paid promotion; WhatsApp Business offers product catalogues, shareable catalog/item links, collections and cart-to-chat. Mudaala should not attempt to match Jiji's listing volume or WhatsApp's messaging platform immediately. Its near-term edge should be a lightweight, persistent, mobile-first storefront for Ugandan small shops, simple photo-backed listing management, dependable direct contact, stable shop links/QRs, clear availability/prices and honest trust/safety guidance. Build density and trust in one launch market before expanding geography.

References for competitor feature checks:
- Jiji Uganda buyer/seller flow and safety guidance: https://jiji.ug/faq/26 and https://jiji.ug/about.html
- WhatsApp Business catalog features: https://whatsappbusiness.com/products/business-app-features/
- WhatsApp catalog details: https://faq.whatsapp.com/405903568419894/?helpref=uf_share
- Google Core Web Vitals thresholds: https://support.google.com/webmasters/answer/9205520?hl=en



## Product vision and competitive learning backlog (living requirements)

**Product principle:** Mudaala should help ordinary local shopkeepers sell and be discovered online without needing technical expertise or expensive infrastructure. Prefer features that make a small shop easier to find, trust, understand, share and contact. Revisit these requirements as customer research provides stronger evidence; when a better approach supersedes one, replace the old requirement rather than keeping contradictory duplicates.

### Buyer discovery and trust

- [ ] Make product discovery dependable: useful search, category/location filters, sensible relevance, fast mobile browsing, and clear empty/error states.
- [ ] Keep listing information honest and current: genuine product photos, price, availability/stock where relevant, and clear seller/shop identity.
- [ ] Make seller contact explicit and reliable: correct phone/WhatsApp destinations, accessible on mobile, with clear fallback/error behavior.
- [ ] Provide a straightforward way to report suspicious listings or shops; define a moderation queue, audit trail and response process before promising moderation SLAs.
- [ ] Show trust signals only when their meaning is true and explainable. Never display “verified” merely because a shop has an account or profile photo.

### Shareable shop catalogues and seasonal collections

- [ ] Treat a shop's public catalogue and stable share link/QR as a core product capability, not a decorative add-on.
- [ ] Explore named collections within a shop catalogue, such as “Christmas outfits”, “Back to School”, “New arrivals” or “Wedding collection”, with shareable collection links where practical.
- [ ] Explore a collection landing-page layout inspired by fashion storefronts: one prominent hero/cover image and a clear grid of the products in that collection. Keep the existing shop design intact until a prototype is validated with shopkeepers and buyers.
- [ ] Preserve the simple all-products shop view for shops that do not create collections; a collection feature must not make ordinary shops harder to use.
- [ ] Validate the collection creation, product assignment, mobile rendering, image persistence, public sharing and QR journey before calling the feature complete.

### Product interest, likes and merchant insights — discovery stage, not an implementation decision

- [ ] Decide whether product likes/favourites should be public, private to the customer, or replaced/augmented by a “notify the shop” interest action. Do not assume likes are the best signal without customer research. Implementation backlog: [#128 — notify sellers when a buyer likes their listing](https://github.com/isaJrKai/mudaala-cloudflare/issues/128); defer until P0 reliability and database-privilege gates close.
- [ ] If implemented, define whether a customer can like without an account, whether likes are visible to other buyers, how to prevent repeated/fake engagement, and how a shopkeeper is notified without spamming them.
- [ ] Distinguish interest signals from actual purchases. Never describe likes as sales or proof that a manufacturer’s product is being bought.
- [ ] Define privacy-conscious merchant insights from meaningful events (views, contacts, saved/liked products and eventual purchases if supported). Give manufacturers or advertisers access only when consent, product-market fit and privacy controls justify it.
- [ ] Consider in-app messaging/lead tracking only after defining the buyer/seller problem it solves, notification permissions, abuse reporting, retention and support burden. Reliable call/WhatsApp contact remains the current low-friction baseline.

### Business verification — future milestone, not a current launch blocker

- [ ] Keep the current onboarding low-friction while the pilot validates value. Do not require formal business-registration/tax documents from every early pilot seller without a clear operational/legal reason.
- [ ] Plan a future business-verification tier for an appropriate later stage (target to reassess by the end of 2027, not a committed release date). Determine which documents establish registration and tax status in Uganda, who reviews them, how documents are protected/retained/deleted, how disputes and expired documents are handled, and what the badge actually guarantees.
- [ ] Until that process exists, use neutral account/profile labels and never imply that Mudaala has verified a shop's registration or tax compliance.
- [ ] Separate “profile complete”, “phone confirmed”, “business documents reviewed” and any future trust tier so customers are not misled by a single ambiguous badge.

### Evidence and replacement rule

For each new idea, record: customer problem, evidence/source, intended user, smallest test, privacy/safety impact, success measure and status (idea / validated / building / shipped / measured). An idea stays in discovery until the team has evidence it improves the real shopkeeper or buyer journey. When research contradicts an older assumption, replace the old checklist item and note why; do not accumulate incompatible requirements.



## Execution record — 2026-10-20 overnight reliability push

### Completed and evidenced in this session

- [x] [PR #141](https://github.com/isaJrKai/mudaala-cloudflare/pull/141) merged (`9dc5d75dfc3a6dc36208976564b6baf030baa0e9`): development dependency audit command now uses `npm audit --include=dev`; production audit remains blocking. PR validation run [39334461031](https://github.com/isaJrKai/mudaala-cloudflare/actions/runs/39334461031) passed. Its all-dependency report identified the still-unpatched `braces` advisory and, before PR #142 merged, `deepmerge-ts`.
- [x] [PR #142](https://github.com/isaJrKai/mudaala-cloudflare/pull/142) merged (`857dd31cc3882946ebf474f4f7dfc78a4de0c5c5`): patched Prisma CLI's transitive `deepmerge-ts` to 8.0.2 through an override and lockfile update while keeping Prisma and `@prisma/client` on 6.19.3. Its PR validation run [39334629766](https://github.com/isaJrKai/mudaala-cloudflare/actions/runs/39334629766) passed. The combined current-main validation run [39338786357](https://github.com/isaJrKai/mudaala-cloudflare/actions/runs/39338786357) confirms the production audit has 0 vulnerabilities and `deepmerge-ts` no longer appears in the all-dependency audit; the only remaining high-severity report is the unpatched `braces` advisory.
- [x] [PR #143](https://github.com/isaJrKai/mudaala-cloudflare/pull/143) merged (`bf3a293f75688472bc5ca7f6023beb7d7876467c`): added public contact reveal, telephone/WhatsApp destination and shop navigation/back regression coverage using disposable browser fixtures. The first run exposed a test-selector mismatch; the selector was corrected to use the actual `/#/shop/` destination and validation run [39338172297](https://github.com/isaJrKai/mudaala-cloudflare/actions/runs/39338172297) passed.
- [x] Read-only Supabase security advisor returned zero security lints on 2026-10-19. Performance advisor returned five INFO-level unused-index notices only; do not remove indexes without workload evidence.
- [x] Read-only production SQL reconfirmed 13 public tables, 13 RLS-enabled tables, 26 policies, 52 grants to `mudaala_runtime`, no `public` schema CREATE privilege, no `postgres` membership, and deny-all direct-API policies on all 13 tables for both `anon` and `authenticated`. Role flags show `mudaala_runtime` is not superuser, cannot create roles/databases, and does not bypass RLS.
- [x] Recent Supavisor logs show Cloudflare Hyperdrive sessions authenticating as `mudaala_runtime`. CI secret-pattern scanning passed in the PR validation workflow; secret values were not read.

### Latest release and production evidence

- [x] Main commit `6b585ef806fa18e72df6769790a9bd89cebffade` deployed successfully in [run 39340678994](https://github.com/isaJrKai/mudaala-cloudflare/actions/runs/39340678994). Cloudflare reports deployment `64f70f9a-5baf-455c-b2f2-c49003cf6d70` with version `4577326d-9ab8-44fe-aad5-a078abea82fa` serving 100% traffic from 2026-10-19 23:19:27Z.
- [x] Live search verification [39340869801](https://github.com/isaJrKai/mudaala-cloudflare/actions/runs/39340869801) passed; live API/privacy/photo/admin/contact verification [39340869802](https://github.com/isaJrKai/mudaala-cloudflare/actions/runs/39340869802) passed on the current main commit. The live workflow verified health/database, anonymous and ordinary-user admin denial, non-owner listing changes denied, owner edit, public listing/shop privacy, photo upload → listing save → fresh read → image fetch, live public contact reveal using a disposable listing, real-browser photo rendering, mobile Post navigation, and cleanup of disposable accounts.
- [x] Combined current-main CI for [PR #145](https://github.com/isaJrKai/mudaala-cloudflare/pull/145) passed in [run 39340106255](https://github.com/isaJrKai/mudaala-cloudflare/actions/runs/39340106255): 527 passed, 0 failed; the browser lifecycle includes the featured-shop QR SVG assertion, and Browse viewport bounds passed at 320, 360, 375, 390, 414, and 640 CSS px. The production dependency audit found 0 vulnerabilities; the all-dependency audit reports the `braces` advisory only, with `deepmerge-ts` gone.
- [x] Read-only 24-hour Supabase log aggregate found zero mentions of the named secret bindings (`ADMIN_USER_IDS`, `CRON_SECRET`, `SETTINGS_ENCRYPTION_KEY`, `AT_API_KEY`) and zero literal `Bearer ` strings across the returned log sources. This is a narrow pattern scan, not proof that every possible secret-leak pattern is absent. CI's high-confidence client-bundle secret scan also passed; no secret values were read.
- [x] Read-only Storage metadata audit found 14 current-upload originals and 14 matching `.thumb.webp` objects overall. Among active non-seed listing photos, 5 URLs have matching thumbnail objects and 4 legacy photo URLs remain without thumbnail naming. No storage objects or listing records were modified.

### Still open — do not mark release-ready until addressed or explicitly accepted

- [ ] Visually verify the reported right-side blank space, squeezed search/filter controls and clipped labels on a physical phone. The Chromium bounds check is good regression evidence but cannot replace physical-device visual confirmation. Do not modify the download button.
- [ ] Complete the final real-device customer check: click the live listing's call/WhatsApp action and scan the featured-shop QR with a physical phone. The live contact API and local browser routes/QR SVG are verified, but an actual device click/scan has not been observed.
- [ ] Keep the development-tooling `braces` advisory open in [issue #132](https://github.com/isaJrKai/mudaala-cloudflare/issues/132) until a safe upstream patch or compatible toolchain replacement exists. Production dependency audit is clean; do not claim the entire development dependency graph is vulnerability-free.
- [ ] Perform a documented backup-restore drill from a verified logical export into a disposable local PostgreSQL database (or another explicitly approved no-production target). The Supabase organization is on the Free plan, for which automated daily backups are not included; do not assume a dashboard backup exists. Do not reset or restore production.
- [ ] Continue monitoring Worker error telemetry after the current deploy; successful live smoke and a short quiet log window are not a permanent reliability guarantee.
- [ ] Plan a safe additive backfill for the 4 active legacy photo URLs that do not have thumbnail objects; preserve all originals and customer listings.
- [ ] Keep video, collections, likes and other feature expansion frozen until P0 gates are closed. No new product schema or destructive production changes were made in this session.
## Security follow-up — phone verification (reconciled 2026-10-20)

### Registration phone ownership — do not enable verification until SMS delivery is configured

- [ ] Registration currently normalizes and uniqueness-checks a phone number, then creates the account and session without proving phone ownership. Track implementation in [issue #57](https://github.com/isaJrKai/mudaala-cloudflare/issues/57).
- [x] Read-only Cloudflare Worker settings inspection confirmed secret binding names/types only; no secret values were read. The active Worker currently has `ADMIN_USER_IDS`, `ADMIN_PHONES`, `CRON_SECRET`, `SETTINGS_ENCRYPTION_KEY`, and storage/database secret bindings, but **does not have `AT_API_KEY` or `AT_USERNAME`**, which the existing production Africa's Talking provider requires. `AT_SENDER_ID` is optional in the provider code.
- [ ] Implement pending-registration state and an additive nullable phone-verification timestamp/field, with a reviewed backwards-compatible policy for existing accounts. Never silently mark legacy phone numbers verified; SMS possession is not legal identity or business verification.
- [ ] Do not grant new accounts normal seller privileges or long-lived authenticated sessions before successful verification. Define a low-bandwidth resume/verify flow and a safe recovery path for people who lose access to their phone.
- [ ] OTP requirements: single-use, short-lived, keyed-hashed storage, atomic attempt limits and replay prevention, resend invalidation, per-phone and per-IP budgets through the shared Durable Object limiter, and fail-closed behavior if that limiter is unavailable. Responses must not enumerate accounts; never log or return OTPs or full phone numbers.
- [ ] Test provider failure, expiry, resend invalidation, concurrent guesses/resends, brute-force ceilings and account-creation races with the console/fake provider and disposable PostgreSQL only. Do not send real SMS or create/mutate production accounts during CI.
- [ ] Configure Africa's Talking credentials through the approved secret workflow and verify delivery safely before enabling/deploying phone verification. Do not put secret values in source, logs, PR comments or this checklist.

### Scheduled maintenance authorization

- [x] Live verifier rejects an invalid `x-cron-secret` with HTTP 403; source uses a constant-time digest comparison and returns 503 when the secret is unconfigured.
- [x] PR validation tests scheduled maintenance authorization/idempotency under the restricted runtime role in disposable PostgreSQL.
- [ ] Verify the next real scheduled run's outcome in telemetry; do not manually trigger the production sweep merely to generate evidence because it can modify real listings/notifications/snapshots.

## Execution record — 2026-10-20 post-PR #147 deployment

### Completed and evidenced

- [x] PR [#147](https://github.com/isaJrKai/mudaala-cloudflare/pull/147) merged as `fbf005f55b8774935303e49352cbd7eb8919c38c`; `src/instrumentation.ts` no longer performs a startup-only database query outside `withRequestDb()`.
- [x] Deployment workflow [39372342814](https://github.com/isaJrKai/mudaala-cloudflare/actions/runs/39372342814) passed on the exact merge commit. Cloudflare confirms deployment `1aae8e14-a7a0-4b3a-97d3-adbeaa026d95` and Worker version `a7edaddb-46d8-4fee-b831-29b22f8439ec` (version 144) serving 100% traffic from 2026-10-20 04:59:25 UTC.
- [x] Post-deploy live verification passed on the same commit: [API/privacy/photos run 39372487411](https://github.com/isaJrKai/mudaala-cloudflare/actions/runs/39372487411) and [shop/product search run 39372487359](https://github.com/isaJrKai/mudaala-cloudflare/actions/runs/39372487359).
- [x] Read-only Cloudflare telemetry for 2026-10-20 04:59:25–05:45 UTC returned zero error-level events, zero HTTP 5xx events, zero `exceededCpu` outcomes, and zero `[startup-db]` events on Worker version 144. A separate unfiltered two-hour review found 10 `[startup-db] failed` error-level events on the previous version `4577326d-9ab8-44fe-aad5-a078abea82fa` between 04:27:45 and 04:50:14 UTC, all before version 144 became active. A fresh version-filtered sample through 05:39 UTC again found zero current-version error-level, HTTP 5xx, or `exceededCpu` events. This is a bounded observation window, not a guarantee of zero future errors.

### Still open

- [ ] Verify the next real scheduled sweep on the updated Worker (cron `0 3 * * *` UTC; next expected run 2026-10-21 03:00 UTC). The endpoint is idempotent but not a dry-run: it can expire overdue listings, send expiring-soon notifications, and write price snapshots. No supported manual-trigger action is available in the connected tooling; do not expose `CRON_SECRET` in chat/logs. If a controlled manual run is still required, arrange it through a secure owner-controlled path and record the exact outcome.
- [ ] Continue monitoring post-deploy 5xx/CPU telemetry over a longer window.
- [x] Correlated the two HTTP 404 responses on `PATCH` and `DELETE /api/listings/:id` at 05:00 UTC with live owner-isolation workflow [39372487411](https://github.com/isaJrKai/mudaala-cloudflare/actions/runs/39372487411): the test explicitly expects a non-owner's edit/delete to return 404, then verifies owner edit succeeds; the workflow passed. These are expected authorization denials, not a defect. Three `/favicon.ico` 404s are separate, non-blocking missing-icon requests and are not 5xx/CPU failures.
- [ ] Physical-phone layout/QR check, safe backup-restore drill, phone-verification provider setup, and development-only `braces` advisory remain open as listed above.

### Parallel closeout review — 2026-10-20

- [x] Development dependency advisory traced to `braces@3.0.3` via `micromatch` → `fast-glob` → `@next/eslint-plugin-next` → `eslint-config-next`; `package-lock.json` marks `braces` as `dev: true`, and the production dependency audit reports zero vulnerabilities. Current GitHub Advisory Database entry [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) marks versions through 3.0.3 affected and lists no patched version. The upstream maintainer has publicly disputed that there is a fix to make; no supported patched release exists. `npm audit fix --force` proposes downgrading `eslint-config-next` to 14.2.35, a breaking mismatch for this Next 16 app. Do not force a downgrade, pin a nonexistent version, or silently suppress the alert. No safe dependency remediation is currently available; retain this as a documented, development-only residual risk and recheck upstream.
- [x] Read-only Supabase inspection confirms Mudaala is `ACTIVE_HEALTHY`, PostgreSQL 17.11.0.002, and the Supabase organization plan is `free`. Supabase's official backup guidance says automatic daily backups are for Pro/Team/Enterprise; Free projects should create and retain their own exports. The only listed development branch is `main` with `with_data=false`, so it is not a data-backed restore target. No branch/project was created and no production data was changed. Safest next drill: export the database with Supabase CLI using authorized credentials, restore into a disposable local PostgreSQL instance, verify tables/row counts and app schema, and securely store the export off-site. Storage API objects are not included in a database dump and need a separate inventory/backup plan.
- [x] Read-only Cloudflare Worker binding metadata does not include an `AT_API_KEY` binding. Phone verification remains unconfigured; no OTP/SMS was sent and no verification was enabled. Configure the provider only through the approved secret workflow after provider credentials and the phone-verification lifecycle/security design are approved.

### Reliability follow-up — 2026-10-20 05:45 UTC

- [x] Extended the read-only telemetry window from the initial 15 minutes to 45 minutes after the version 144 deployment. Queries completed successfully; error-level events, HTTP 5xx events, `exceededCpu` outcomes and `[startup-db]` events all returned zero. An unfiltered sample contained real request traffic, with sampled requests returning HTTP 200 on the new version.
- [ ] Continue observing a longer production window and verify the next scheduled sweep after it occurs. The sweep is not manually invoked.

### Thumbnail backfill preparation — 2026-10-20

- [x] Reviewed the existing upload and storage flow: the browser prepares a separate WebP thumbnail; the upload API stores it as a sibling `<stem>.thumb.webp` object. Original image storage is independent and a thumbnail-write failure intentionally leaves the original intact.
- [x] Read-only SQL reconciliation of active, non-seed listing photos found 9 active photo URLs and confirmed all 9 original objects exist in `mudaala-photos`. Five URLs use the current `*-t.<format>` naming convention and all five have their matching `.thumb.webp` objects. The other four are legacy names (`<8-hex>-<16-hex>.webp`) that the current `listingThumbnailUrl()` helper intentionally does not rewrite, so they continue using the original image rather than requesting a missing thumbnail. This is a compatibility/performance opportunity, not a broken-image or data-integrity failure.
- [ ] Do not run a blind storage-only backfill for these four legacy names: first decide whether thumbnail optimization is worth a narrowly scoped, backwards-compatible helper change. If approved, test the legacy URL mapping and image generation against disposable files, produce a dry-run manifest, and upload only missing thumbnail siblings. Do not update listing rows, delete/replace originals, touch shop photos without a separate audit, or process seed fixtures. No production photo objects were written or deleted during this review.

### Supabase release-gate review — 2026-10-20

- [x] Read-only Supabase project inspection reports project `Mudaala` as `ACTIVE_HEALTHY` on PostgreSQL 17.11.0.002. Its only listed development branch is the default `main` branch with `with_data=false`; it is not a suitable data-backed restore drill target.
- [x] Supabase security advisors returned zero lints at 2026-10-20 05:19 UTC.
- [x] Supabase performance advisors returned five informational unused-index findings on `Report`, `AuditLog`, and `PriceSnapshot` indexes. No index was dropped or changed; unused-index advisories are not sufficient evidence to remove indexes from security/audit and scheduled maintenance paths without query-plan and workload review.
- [ ] Backup readiness remains open: the organization is Free tier, so confirm/export a logical database backup with the Supabase CLI, store it off-site, and complete a disposable local PostgreSQL restore. No paid branch/project is necessary for the initial drill; no restore target was created and no production data was changed.

## My Business workspace and records — 2026-10-20

### Completed and verified in GitHub

- [x] PR [#153](https://github.com/isaJrKai/mudaala-cloudflare/pull/153) merged as `9e55bb0a2f554f422d2952858c9c30c96d098fa9`. Added a dedicated My Business workspace, separated shop/account settings from the business overview, and showed listing views, active listings, fulfilled status (explicitly not verified sales), and listings expiring soon.
- [x] Cloudflare deployment list showed deployment `f8516bc2-8f75-48c1-bc29-d8c1813e58aa`, Worker version `14ee9dd1-dbb5-4dbb-af4a-1caafd1b8d71` serving 100% traffic, created 2026-10-20 15:53:38 UTC. This is the latest observed deployment before PR #155; do not treat the new business-record APIs as live until a newer deployment and post-deploy checks are confirmed.
- [x] PR [#155](https://github.com/isaJrKai/mudaala-cloudflare/pull/155) merged as `6717c11b2acfe58e631335d004168f67ee2a0f46`. Added business product, sale, sale-item snapshot and stock-movement models with an additive migration; owner-scoped product/stock/sales/analytics/export APIs; idempotent sale recording; transactional stock changes; auditable voids; configurable low-stock thresholds; and a My Business UI for recording completed sales and managing products/stock.
- [x] Validation workflow [39456564703](https://github.com/isaJrKai/mudaala-cloudflare/actions/runs/39456564703) passed; shop/listing/public regression and Worker build [39456564778](https://github.com/isaJrKai/mudaala-cloudflare/actions/runs/39456564778) passed. The API suite reported 546 passed, 0 failed, including new ownership, stock consistency, idempotency, oversell prevention, profit calculations, voids, stock history and CSV export checks.
- [x] Listing.quantity remains unchanged and is not silently treated as stock-on-hand. Views remain interest signals, not unique reach, confirmed orders, or profit. Profit remains unknown when cost data is incomplete and excludes operating expenses. CSV export is owner-scoped and guards spreadsheet formula injection.

### Deployment and follow-up status

- [x] Cloudflare confirms the PR #155 deployment workflow [39457298706](https://github.com/isaJrKai/mudaala-cloudflare/actions/runs/39457298706) succeeded. The deployment record previously confirmed Worker version `c8674e9b-5a0e-4168-a941-0b16d276468d` (version 149) at 100% traffic; the business-record models and APIs are now deployed, not merely merged.
- [x] Post-deploy shop/search verification [39457536578](https://github.com/isaJrKai/mudaala-cloudflare/actions/runs/39457536578) passed. Live API, privacy, owner/admin boundary and photo-persistence steps in [39457536544](https://github.com/isaJrKai/mudaala-cloudflare/actions/runs/39457536544) passed; the workflow failed only in its separate browser photo-render step because the first public listing page had no listing with a photo and the script timed out waiting for one. Treat this as a data-dependent verification gap, not proof that the storage path is broken. Improve the browser check to use a disposable test-owned photo/listing rather than organic public inventory.
- [x] Performance follow-up PR [#156](https://github.com/isaJrKai/mudaala-cloudflare/pull/156) merged as `528ac8c4360210f24015dde62f5b67c35b1bd731` after validation [39457892043](https://github.com/isaJrKai/mudaala-cloudflare/actions/runs/39457892043) passed. It lazy-loads My Business so the dashboard code is not part of the initial public marketplace render. Deployment run [39458897542](https://github.com/isaJrKai/mudaala-cloudflare/actions/runs/39458897542) is queued; verify deployment, live checks and bounded telemetry before calling this performance mitigation live.
- [ ] Fix the live browser photo-verification test so it creates and cleans up its own disposable fixture; rerun it and confirm no test data or uploaded objects remain. No manual production customer data was seeded.
- [ ] Test My Business with a real signed-in founder account and on a physical phone: product creation, opening stock, sale recording, stock decrement/restock, low-stock alerts, void/reversal, CSV download and navigation. The connected session cannot confirm the founder's signed-in browser.
- [ ] Next product work: link existing public listings into the business catalogue without reinterpreting `Listing.quantity`, add privacy-safe listing/shop view and contact-click event instrumentation, and improve multi-item sales workflows.
- [ ] Then build promotions (discounts, bundles, collections), followed by market analytics using privacy-protected aggregate data.
- [ ] Prepare a provider-neutral AI-agent adapter with owner consent, scoped tools, audit logs and staged permissions. Do not deploy an autonomous agent or build a new model before records, analytics and permission boundaries are reliable. Evaluate Hermes Agent and alternatives separately before choosing an integration.
- [ ] Keep seller phone verification as a separate release gate: Google or phone access for buyers; sellers must verify phone ownership before listing or opening a shop; safely link accounts; retain phone-based recovery. Provider setup and the app-side OTP lifecycle remain unfinished.
- [x] Closed duplicate parallel PR [#157](https://github.com/isaJrKai/mudaala-cloudflare/pull/157) without merging because it duplicated the stronger canonical implementation in PR #155; continue from the existing BusinessProduct/Sale/SaleItem schema and APIs.

