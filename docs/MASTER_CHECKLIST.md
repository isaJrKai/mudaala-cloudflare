# Mudaala — Master Project Checklist

**Last reconciled:** 2026-10-17 (UTC+3)  
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
| P0 | PR #87 — end-to-end journey and silent action failures | **Blocked by browser CI failure** | Saved-search browser journey passed on commit ff8fbaff. Listing lifecycle journey timed out waiting for POST /api/listings at publish. Diagnostic commits 5dc8848b and d2b1478e now print validation/form state plus browser console and page errors if publish makes no API request. The current PR head is d2b1478e, but no workflow run is associated with the latest head despite reopening the PR. A temporary verification-only PR #103 was opened and closed because it also did not trigger Actions; no duplicate code was merged. The prior failure on ff8fbaff timed out waiting for POST /api/listings. Static review confirms the form uses the shared schema; the scripted inputs (category key, kg unit, Kampala district, valid-looking UG phone and required text) match the form's current options. This narrows the static review but does not prove browser state or identify the root cause because the new diagnostics have not run. The available GitHub connection can read workflow state and rerun old jobs, but does not expose a workflow-dispatch action; rerunning the old job would test the old SHA, not d2b1478e. A fresh run of `Validate Mudaala pull requests` against the current head is still required before fixing the observed cause. Do not merge/deploy until required CI is green. [PR #87](https://github.com/isaJrKai/mudaala-cloudflare/pull/87) |
| P0 | Shop creation / first-run onboarding | **User reports fixed; production verification pending** | Test a fresh account through sign-in, shop creation, save, refresh, product publish and public shop URL. |
| P0 | Photo upload and persistence | **Public photo delivery passed; fresh authenticated upload still unverified** | Production live verification workflow passed on 2026-10-16 16:31 UTC: existing listing photos rendered in-browser (3 images) and the admin shop cover photo was persisted and publicly served. This proves existing media delivery, not a new upload. Cloudflare logs show the last `/api/upload` 500/503 events were on Oct 10, before the current Worker version; no upload attempts were found in the last 7 days after that date. Next: authenticate, upload a fresh profile/listing photo, save, reload/new session, and verify durable storage and public rendering. Absence of recent failures is not proof of upload success. Never accept local /uploads as durable production storage. |
| P0 | Account isolation and database least privilege | **Direct API protections verified; Worker runtime role still unverified** | Live Supabase read-only inspection on 2026-10-16: Security Advisor returned no security lints; all 13 public application tables have RLS enabled; `anon` and `authenticated` have no table grants; deny-all policies cover those roles. The production Worker has `DATABASE_URL` and `HYPERDRIVE` bindings, but the secret values and actual runtime database identity were not inspected. Verify the Worker uses an appropriately restricted runtime role and run cross-account checks safely. CI on PR #87's prior head also passed disposable-Postgres least-privilege and account-isolation tests; that is not proof of the production runtime role. |
| P1 | Scheduled maintenance origin | **Origin fix is on main; scheduled execution not yet confirmed** | The PR #63 change is already on `main` in commit `fb9e0ba7` (same two-file change); closed the duplicate open PR without merging. Production Worker was redeployed after that commit. Cloudflare logs show a scheduled event at `2026-10-17T03:00:30Z` on version `a9d7a94d-7f04-4c81-9c40-c1404a41ff4a` with outcome `ok`, but no explicit `mudaala_scheduled_sweep_completed` log was found. The only `/api/cron/sweep` request events in the last 72 hours returned 403 on older versions (Oct 15/16); none appeared at the latest scheduled timestamp. Completion remains unproven and needs deeper verification. [Commit](https://github.com/isaJrKai/mudaala-cloudflare/commit/fb9e0ba7dd5c82a1887bd3da33b61ca5330a752d) |
| P1 | PR #89 — Worker DB reuse + video media | **Draft; not for production** | Requires CI, reviewed additive videoUrl schema migration, configured durable media storage, and authenticated upload → save → refresh → playback verification. Keep separate from photo bug fixes. [PR #89](https://github.com/isaJrKai/mudaala-cloudflare/pull/89) |
| P1 | Public customer journey | **End-to-end verification pending** | Browse real listings → open detail → contact via call/WhatsApp → shop link/QR. Verify mobile layout and slow connection. |
| P1 | Admin badge and permissions | **Live verification pending** | Verify authorized admin response includes shop.isAdmin: true and UI badge renders correctly; verify ordinary users cannot gain admin privileges. |
| P2 | Settings and preferences | **Pending audit** | Verify notification/search notification preferences, privacy controls and supported language options; remove duplication only after identifying the canonical implementation. |
| P2 | Search quality | **Incremental work after stability** | Fix Unicode/normalization and practical Uganda-first product vocabulary; verify exact model terms outrank overly broad matches without inventing product claims. |
| P2 | Product polish and future video | **Do not block stability work** | Preserve green + warm mango/yellow accents and botanical identity. Video stays deferred until its separate release gate passes. |



### Latest read-only production inspection (2026-10-16)

- Supabase project status: ACTIVE_HEALTHY; region eu-west-2.
- Security Advisor: no security lints returned (rechecked 2026-10-17).
- Performance Advisor: five unused-index notices only (INFO); no index was removed because current usage may be low-volume and deletion needs workload evidence.
- Read-only SQL recheck: 13 public base tables, all 13 have RLS enabled. The inspection connection ran as `postgres`, so this does not identify the Worker runtime role; that gap remains open.
- RLS: enabled on all 13 public application tables.
- Direct Data API access: `anon` and `authenticated` have no table grants; deny-all policies exist on the application tables.
- Cloudflare Worker: active deployment reported at 2026-10-16T16:22:31Z (version `a9d7a94d-7f04-4c81-9c40-c1404a41ff4a`, 100% traffic); no Cloudflare Observability issues were returned for the Worker query.
- Worker secret values were not read. Presence of storage-related bindings does not prove a fresh photo upload succeeds.
- Production live smoke workflow passed on 2026-10-16 16:31 UTC: health, anonymous auth, public listing detail, shop-name search, admin flag, persisted cover-photo delivery, and browser rendering of three existing listing photos. This still does not prove a fresh authenticated upload succeeds.
- These read-only checks did not change production data or settings.

## Immediate execution queue

### 1. Unblock PR #87

- [x] Founder manually tested the live product and confirmed it works (2026-10-17).
- [x] Founder manually tested the product/photo flow and shop-owner journey and confirmed both work (2026-10-17). This is founder-reported live verification; it is not being misrepresented as an automated test artifact.
- [x] Confirmed PR #87 remains open and its current head is `d2b1478e13245022e495a9e6c350b5f6dce8cf4d`.
- [ ] Trigger a fresh PR validation run against the current head (the available GitHub connection exposes no workflow-dispatch action; rerunning the old failed job would only check the old SHA).
- [ ] Read the new browser diagnostic from the failed listing-publish journey.
- [ ] Fix the root cause in the existing form/test; do not weaken the test or bypass validation.
- [ ] Verify saved-search create → list → reload → apply → delete → reload.
- [ ] Verify listing create → detail → edit → save → delete.
- [ ] Verify mobile cart open/close and navigation to Post.
- [ ] Ensure the other API, security, type-check, lint and build steps remain green.
- [ ] Merge only after the required checks pass; then verify the deployed Worker.

### 2. Confirm scheduled maintenance execution

- [ ] Inspect Cloudflare Worker observability for the scheduled invocation at 03:00 UTC and confirm a successful `mudaala_scheduled_sweep_completed` event.
- [ ] If the event failed or is missing, inspect the scheduled handler's HTTP response and error before changing configuration again.

### 3. Confirm the live shop and photo journey

- [x] Founder reports the live product and shop-owner journey were manually tested successfully (2026-10-17).
- [x] Founder reports the photo/product flow was tested successfully (2026-10-17).
- [ ] Independently capture reproducible test evidence for account isolation and public contact actions; do not ask the founder to repeat already-completed tests unless a specific failure requires it.

### 4. Security release gate

- [ ] Inspect production database role, grants, RLS policies and direct Data API exposure.
- [ ] Confirm the production runtime role cannot bypass RLS or perform schema changes.
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
