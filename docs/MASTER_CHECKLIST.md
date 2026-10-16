# Mudaala — Master Project Checklist

**Last reconciled:** 2026-10-16 (UTC+3)  
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
| P0 | PR #87 — end-to-end journey and silent action failures | **Blocked by browser CI failure** | Saved-search browser journey passed on commit ff8fbaff. Listing lifecycle journey timed out waiting for POST /api/listings at publish. A diagnostic-only commit 5dc8848b was added to print validation errors and form state; rerun CI on the latest head and fix the actual cause. Do not merge/deploy until required CI is green. [PR #87](https://github.com/isaJrKai/mudaala-cloudflare/pull/87) |
| P0 | Shop creation / first-run onboarding | **User reports fixed; production verification pending** | Test a fresh account through sign-in, shop creation, save, refresh, product publish and public shop URL. |
| P0 | Photo upload and persistence | **Production status not confirmed** | Earlier reports said profile gallery and listing photos failed. Test authenticated upload → saved URL → reload/new session → public rendering. Verify storage is durable in the production Worker; never accept local /uploads as durable production storage. |
| P0 | Account isolation and database least privilege | **CI evidence exists; production evidence pending** | CI on PR #87's prior head passed disposable-Postgres checks for direct Data API deny policies, a runtime role without BYPASSRLS, API/account-isolation, moderation and photo behavior. This does not prove production Supabase settings/role are correct. Verify production grants, RLS, Worker connection identity and cross-account access safely. |
| P1 | PR #63 — scheduled maintenance origin | **Open; scheduled execution not yet confirmed** | After the appropriate deploy, confirm a successful mudaala_scheduled_sweep_completed event in Cloudflare logs. [PR #63](https://github.com/isaJrKai/mudaala-cloudflare/pull/63) |
| P1 | PR #89 — Worker DB reuse + video media | **Draft; not for production** | Requires CI, reviewed additive videoUrl schema migration, configured durable media storage, and authenticated upload → save → refresh → playback verification. Keep separate from photo bug fixes. [PR #89](https://github.com/isaJrKai/mudaala-cloudflare/pull/89) |
| P1 | Public customer journey | **End-to-end verification pending** | Browse real listings → open detail → contact via call/WhatsApp → shop link/QR. Verify mobile layout and slow connection. |
| P1 | Admin badge and permissions | **Live verification pending** | Verify authorized admin response includes shop.isAdmin: true and UI badge renders correctly; verify ordinary users cannot gain admin privileges. |
| P2 | Settings and preferences | **Pending audit** | Verify notification/search notification preferences, privacy controls and supported language options; remove duplication only after identifying the canonical implementation. |
| P2 | Search quality | **Incremental work after stability** | Fix Unicode/normalization and practical Uganda-first product vocabulary; verify exact model terms outrank overly broad matches without inventing product claims. |
| P2 | Product polish and future video | **Do not block stability work** | Preserve green + warm mango/yellow accents and botanical identity. Video stays deferred until its separate release gate passes. |

## Immediate execution queue

### 1. Unblock PR #87

- [ ] Confirm the current PR head includes commit 5dc8848b.
- [ ] Re-run the PR validation workflow against that head.
- [ ] Read the new browser diagnostic from the failed listing-publish journey.
- [ ] Fix the root cause in the existing form/test; do not weaken the test or bypass validation.
- [ ] Verify saved-search create → list → reload → apply → delete → reload.
- [ ] Verify listing create → detail → edit → save → delete.
- [ ] Verify mobile cart open/close and navigation to Post.
- [ ] Ensure the other API, security, type-check, lint and build steps remain green.
- [ ] Merge only after the required checks pass; then verify the deployed Worker.

### 2. Confirm the live shop and photo journey

- [ ] Fresh test account can sign in.
- [ ] Shop profile can be created and saved.
- [ ] Profile survives refresh and a new session.
- [ ] Product/listing can be created and edited.
- [ ] A newly uploaded photo remains available after refresh and is publicly rendered where intended.
- [ ] Other accounts cannot edit or view private owner data.
- [ ] Public shop/listing URLs and contact actions work on mobile.

### 3. Security release gate

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
