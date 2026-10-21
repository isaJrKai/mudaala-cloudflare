# Marketplace Trust & Safety: implementation plan

**Status:** In progress. This document distinguishes protections that exist today from controls that still need implementation and verification.
**Scope:** Seller profiles, listing text and photos, buyer reports, account abuse, marketplace integrity, and moderator operations.

## Immediate safety baseline

### Existing controls verified in source

- Listing and shop reports can be submitted without requiring sign-in.
- Report creation has rate limits and duplicate-open-report prevention.
- Three distinct reporters can cause an active listing to be hidden while it is reviewed.
- Admins have a report queue and can hide, restore, or dismiss reports; moderation actions are audited.
- Listing upload requires authentication, limits file size and upload rate, checks image magic bytes, and strips common image metadata.
- Listing/shop names and listing title/description use shared server-side content validation.
- Prohibited product text has a publish-time filter.

### Critical limitation: file validation is not image moderation

The current upload route verifies that a file is a supported JPEG, PNG, or WebP and removes selected metadata. It does **not** identify nudity, sexual content, violence, hateful imagery, or other visual content. A valid JPEG can still contain prohibited imagery. Do not describe the marketplace as automatically detecting or blocking nudity until a real image-classification/moderation service is integrated and tested.

The report-category addition is a reporting aid, not a substitute for automatic image screening or a staffed review process. It does not retroactively scan existing photos.

## Required controls, in priority order

### P0 — Explicit image and content safety

- Keep an explicit prohibition on nudity, explicit sexual imagery, sexual exploitation, and any sexual content involving minors.
- Integrate a maintained image-moderation service at the server-side upload/publish boundary. Never trust a client-provided moderation result.
- Define outcomes before enabling the integration: clearly prohibited content is rejected; uncertain cases are held from public display pending review; safe content can proceed.
- Fail closed for new public publication if the moderation provider is unavailable, with a clear retry message. Do not silently publish an unscanned image.
- Do not store or expose classifier payloads or sensitive imagery in routine logs. Keep only the minimum decision, provider/version, timestamp, and review reference needed for accountability.
- Test JPEG, PNG, WebP, thumbnails, multiple photos per listing, profile avatars, cover photos, and alternate API paths. Confirm that every public-image route shares the same gate.
- Define a safe, privacy-preserving process for suspected child sexual abuse material: do not download, copy, or circulate it for manual review; restrict access and follow applicable reporting obligations.

### P0 — Repeat-violation warnings and moderation operations

#### Account warning rule (policy target; not active until implemented and tested)

- Count **confirmed violations**, not raw reports. A report, a rejected upload, or an unreviewed accusation alone must not count as a strike.
- A confirmed violation is recorded only after a moderator reviews the evidence and takes an enforcement action for a specific policy breach. Record the policy category, target, moderator/system decision, timestamp, and linked case ID.
- On the **fourth confirmed violation** (more than three), send the account a formal in-app warning explaining the specific rule breached, the action taken, the cumulative confirmed-violation count, how to appeal, and that further violations may lead to temporary suspension or account removal.
- Notify on each subsequent confirmed violation as well, but do not flood the account with duplicate notifications for retries of the same moderation action.
- Give users a fair appeal path. If a decision is overturned, reverse the strike and correct the count; do not punish users for good-faith reports or unsubstantiated allegations.
- Keep a moderator-visible case history and an audit trail. Restrict access to sensitive evidence and never include explicit imagery in notifications.
- A formal warning is not itself a suspension. Any temporary suspension or account removal must have separately defined thresholds, proportionality, an appeal route, and an auditable moderator decision.
- Until the warning counter, notification, idempotency, appeal reversal, and tests ship, this is a **planned rule**, not a live account-enforcement feature.

- Make nudity/sexual content, harassment/hate, exposed personal information, and spam/impersonation first-class report reasons.
- Ensure reports about a photo can be tied to the listing/shop and the relevant photo, without exposing reporter identity to the reported user.
- Treat automatic multi-report hiding as a triage signal, not proof. Protect against coordinated false reports and provide a clear appeal/review path.
- Add shop-level moderation actions; currently shop reports can be dismissed but the admin action endpoint does not hide a shop.
- Set a real monitored support inbox, response-time target, reviewer ownership, escalation procedure, and audit retention policy before public launch.
- Require a reason for moderation actions and log actor, target, decision, and timestamp without copying harmful content into logs.

### P1 — Fraud, identity, and manipulation

- Detect impersonation of established shops, fake verification claims, duplicate/spam listings, misleading prices and bait-and-switch behavior.
- Preserve evidence and let users report scams without requiring an account.
- Keep verification badges disabled unless there is an evidenced, repeatable verification process.
- Add rate limits and abuse monitoring for account creation, password reset, reports, messaging/contact actions, and listing creation; alert on unusual spikes.

### P1 — Privacy and account safety

- Confirm public APIs never expose private phone numbers, precise coordinates, sessions, passwords, report IPs, or internal moderation notes.
- Test authorization for every seller-owned mutation and every admin endpoint; admin access must fail closed.
- Limit photo metadata and storage access, validate file signatures and size, and ensure deleted/hidden content is not exposed through direct URLs, thumbnails, search, sitemaps, or caches.
- Establish retention and deletion rules for reports, uploaded content, account data, and security logs.

### P1 — Resilience and operational visibility

- Monitor upload rejection rates, report volume, moderation queue age, auto-hides, failed moderation-provider requests, and storage errors.
- Add alerting for provider outage, sudden report/upload spikes, and a growing unreviewed queue.
- Test backups and restoration, rate-limit behavior under concurrency, and moderation actions under retries.
- Provide a short incident runbook: contain exposure, preserve minimal evidence, restrict access, notify the responsible operator, remediate, and document follow-up.

## Acceptance gates before claiming image safety is complete

- [ ] A real server-side image moderation provider is selected and configured with secrets outside source control.
- [ ] Upload and publish paths cannot make a new image public before a moderation decision.
- [ ] Uncertain results are held for review; provider failures do not silently allow publication.
- [ ] Automated tests cover safe, prohibited, uncertain, unavailable-provider, malformed-image, thumbnail, and alternate-path cases.
- [ ] Existing publicly served images have an explicit migration/backfill decision; no claim that historical images are scanned until it is done.
- [ ] Report queue, shop-level action, appeal route, real support inbox, reviewer ownership, and audit logging are verified end-to-end.
- [ ] Confirmed-violation counting is idempotent, excludes unreviewed reports, and sends the formal warning on the fourth confirmed violation.
- [ ] Appeals can reverse an incorrect strike without leaving stale warning counts or duplicate notifications.
- [ ] Live smoke tests verify rejected content is not visible by direct URL, listing page, search, sitemap, thumbnails, or cached responses.
- [ ] Monitoring and incident-response ownership are documented.

## Current delivery in this branch

This change adds specific report reasons for nudity/sexual content, harassment/hate, exposed personal information, and spam/impersonation, and tests the API validation path. It updates the safety guide to explain the rules and specifies a formal warning after the fourth confirmed violation. It does **not** yet implement automated visual classification, confirmed-violation counting, account warnings, shop suspension, a moderation-provider integration, or an appeal workflow. Those remain explicit gates rather than implied capabilities.
