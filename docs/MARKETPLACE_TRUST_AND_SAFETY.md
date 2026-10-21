# Marketplace Trust & Safety: implementation plan

**Status:** In progress. This document distinguishes protections that exist today from controls that still need implementation and verification.
**Scope:** Seller profiles, listing text and photos, buyer reports, account abuse, marketplace integrity, and moderator operations.

## Immediate safety baseline

### Existing controls verified in source

- Listing and shop reports can be submitted without requiring sign-in.
- Report creation has rate limits and duplicate-open-report prevention.
- Three distinct reporters can cause an active listing to be hidden while it is reviewed.
- Admins have a report queue and can hide, restore, or dismiss reports; moderation actions are audited. This change adds explicit confirmed-violation and reversal actions, with a separate strike record rather than counting raw reports.
- Listing upload requires authentication, limits file size and upload rate, checks image magic bytes, and strips common image metadata.
- Listing/shop names and listing title/description use shared server-side content validation.
- Prohibited product text has a publish-time filter.

### Critical limitation: production image moderation needs configuration and verification

The upload route now calls OpenAI's `omni-moderation-latest` moderation endpoint before storage when `OPENAI_MODERATION_API_KEY` is configured. Explicit sexual-content flags are rejected, and a missing key, provider error, timeout, or malformed result blocks production uploads instead of publishing unchecked photos. This integration is **not active in production** until the Cloudflare secret is configured and live checks pass.

This upload-time control does not retroactively scan existing photos. It also does not yet provide a queue for ambiguous cases or an admin review flow for rejected uploads, so those remain launch gaps. The report categories are a reporting aid, not a substitute for a staffed review process.

## Bug reports and user feedback

- This change adds a global “Report a bug / Send feedback” entry point in the site footer. Users can report a broken feature, slow loading, a complaint, an idea, or another issue, with a summary, detailed comment, current page path, browser user-agent, and optional contact details.\n- Reports are rate-limited, and only admin-authorized endpoints can read or triage them. The admin inbox supports status, priority, and private internal notes; updates are audit-logged.\n- This is an in-app inbox, not an external email or SMS alert. A named admin must monitor it and define response expectations before launch. Screenshot uploads are not accepted in this first version; do not ask users to attach sensitive screenshots or credentials.\n\n## Image moderation release gate\n\n- Configure the secret with `wrangler secret put OPENAI_MODERATION_API_KEY` only after the provider account, billing, privacy/retention settings, and access controls are approved. Never place the key in `wrangler.jsonc`, source files, or GitHub commits.\n- Verify safe photos upload, explicit test fixtures are blocked, thumbnail images are checked too, and provider failure returns a temporary error without storing either image.\n- Scan existing public photos separately before claiming the marketplace is fully moderated. This change only gates new uploads.\n\n## Required controls, in priority order

### P0 — Explicit image and content safety

- Keep an explicit prohibition on nudity, explicit sexual imagery, sexual exploitation, and any sexual content involving minors.
- Keep the image-moderation service at the server-side upload boundary. Never trust a client-provided moderation result.
- Current outcomes: explicit sexual-content flags are rejected; safe results can proceed; provider failures or malformed responses block the upload. A separate ambiguous-content review queue is still needed.
- Fail closed for new public publication if the moderation provider is unavailable, with a clear retry message. Do not silently publish an unscanned image.
- Do not store or expose classifier payloads or sensitive imagery in routine logs. Keep only the minimum decision, provider/version, timestamp, and review reference needed for accountability.
- Test JPEG, PNG, WebP, thumbnails, multiple photos per listing, profile avatars, cover photos, and alternate API paths. Confirm that every public-image route shares the same gate.
- Define a safe, privacy-preserving process for suspected child sexual abuse material: do not download, copy, or circulate it for manual review; restrict access and follow applicable reporting obligations.

### P0 — Repeat-violation warnings and moderation operations

#### Account warning rule (implemented in this change; not active in production until checks pass, migration is deployed, and live verification completes)

- Count **confirmed violations**, not raw reports. A report, a rejected upload, or an unreviewed accusation alone must not count as a strike.
- Deduplicate reports against the same active target-level case so several reporters do not multiply one incident into several strikes.
- Strike counting begins when this enforcement feature is active; historical reports and automatic hides are not silently converted into confirmed strikes.
- A confirmed violation is recorded only after a moderator reviews the evidence and takes an enforcement action for a specific policy breach. Record the policy category, target, moderator/system decision, timestamp, and linked case ID.
- On the **fourth confirmed violation** (more than three), send the account a formal in-app notification explaining the moderator-selected policy category, confirmed-violation count, enforcement decision, appeal route, and that further confirmed violations may lead to account restrictions.
- Notify on each subsequent confirmed violation as well, but do not flood the account with duplicate notifications for retries of the same moderation action.
- Give users a fair appeal path. If a decision is overturned, reverse the strike and correct the count; do not punish users for good-faith reports or unsubstantiated allegations.
- Keep a moderator-visible case history and an audit trail. Restrict access to sensitive evidence and never include explicit imagery in notifications.
- A formal warning is not itself a suspension. Any temporary suspension or account removal must have separately defined thresholds, proportionality, an appeal route, and an auditable moderator decision.
- This change adds a unique active target-level confirmed-violation case, moderator confirmation/reversal actions, idempotent retries, in-app warning notifications from the fourth active strike onward, and a correction notification when an appeal is accepted. These controls remain **not live in production** until CI passes, the database migration is deployed safely, and end-to-end checks pass.

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

This branch implements the image-moderation provider integration at the upload boundary, moderator-confirmed violation records with idempotent confirmation/reversal, formal in-app warnings from the fourth active confirmed violation, and the private feedback inbox. These controls are implemented in code but are **not live in production** until the PR is merged, the OpenAI moderation secret is configured in Cloudflare, deployment and smoke checks pass, and authenticated end-to-end checks verify the admin and user flows. Still-open follow-ups include scanning existing photos, an ambiguous-content review queue, shop-level hide/suspend actions, external email/SMS delivery, and full monitoring/incident-response ownership.
