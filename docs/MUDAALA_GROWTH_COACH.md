# Mudaala Growth Coach

## Product intent

Mudaala Growth Coach is the merchant's practical business assistant. It uses real shop state and activity to recommend the next useful action, then makes that action easy to complete. It borrows habit-building, seller enablement, and notification ergonomics from Duolingo, TikTok Shop, Alibaba, and Facebook without copying their interfaces or optimizing for empty engagement.

The success metric is merchant progress and customer contact, not notification opens.

## Experience contract

### Notification types

- **Informational:** progress, useful shop signals, and milestone celebrations.
- **Actionable:** a specific recommendation with one primary action that opens the exact relevant Mudaala screen.
- **Reminder:** a previously deferred or still-relevant action, with snooze controls.
- **Event-triggered:** a meaningful shop event or a detected shop gap, deduplicated and frequency-capped.

### Merchant controls

- Mark read / unread.
- Archive and restore; archive is reversible and is not deletion.
- Snooze for 15 minutes, 30 minutes, 1 hour, or tomorrow.
- Dismiss a recommendation.
- Open the action directly.
- Configure push permission, quiet hours, and notification preferences.
- A persistent in-app notification centre remains the source of truth when browser/device push is unavailable.

### Delivery channels

1. In-app notification centre (works without push permission).
2. Web Push through a service worker for supported browsers and installed PWAs, after explicit opt-in.
3. Device/browser notification UI where the platform supports it.

Push actions are not assumed to be supported uniformly. If a platform cannot expose action buttons, tapping the notification opens the authenticated Mudaala destination and the in-app action surface.

## Recommendation principles

1. **Real shop facts only.** Derive recommendations from the merchant's own profile, active listings, photos, listing quality, and recorded engagement. Never fabricate demand, sales, or sharing activity.
2. **Next best action.** Select the highest-value incomplete action, not a random list of nags.
3. **Completion awareness.** Re-evaluate after product creation, photo upload, shop-profile edits, poster/share actions, and notification action completion.
4. **No false poster claims.** A poster can be generated from the existing shop identity/QR. Track an explicit merchant share action separately from a poster download; downloading is not proof it was shared externally.
5. **Habit support, not compulsion.** Streaks count meaningful merchant actions, not merely opening the app. No shame, guilt, fake urgency, or manipulative loss aversion.
6. **Frequency caps.** Scheduled opportunities at 08:00, 11:00, and 15:00 in the merchant's local timezone are opportunities, not guaranteed sends. Add at most one inactivity re-engagement reminder per local day, at a bounded randomized time. Event-triggered alerts are subject to priority, quiet hours, deduplication, and a daily cap.
7. **Respect and control.** Honour opt-in, quiet hours, snooze, archive, dismissal, and channel preferences. Critical account/security notices remain distinct from growth coaching.
8. **Outcome measurement.** Track delivered, displayed, opened, snoozed, dismissed, archived, completed, and resulting merchant/customer actions as separate events.

## Recommendation catalogue (initial)

| Signal from real shop data | Recommendation | Destination |
|---|---|---|
| Shop exists, zero active offer listings | Publish the first product | Publish form |
| Low active product count | Add another product | Publish form |
| Active listing has no photos | Add product photos | Edit listing/photo section |
| Shop profile lacks description or photo | Complete shop identity | My Shop/profile |
| Shop poster has not been generated/downloaded | Create the shop poster | Shop poster section |
| Poster generated but no share action recorded | Share the shop poster | Shop poster/share surface |
| New product was published with photos | Share the new product photos | Listing/share surface |
| Merchant has been inactive for the local day | Re-open the shop and review the next action | Merchant home |
| Shop actions completed | Celebrate genuine progress and suggest the next useful action | Relevant next action |

Recommendations must not be emitted where the required signal is unknown. For example, Mudaala must not claim that a poster was not shared unless it has a reliable explicit share event.

## Architecture

### 1. Shop signal layer

A server-side snapshot combines:
- BusinessProfile completeness and shop identity.
- Active offer listings, product photos, and listing freshness.
- Shop and listing daily analytics.
- Explicit merchant actions: poster generated/downloaded/shared, product created/edited, and profile completed.
- Merchant activity timestamps and local timezone/preferences.

Keep public buyer analytics distinct from merchant-side actions. A buyer sharing a listing is not the same as a merchant sharing their poster.

### 2. Recommendation engine

A deterministic, testable rules engine initially:
- Generates eligible recommendations from the snapshot.
- Assigns priority and an action destination.
- Suppresses already-completed, snoozed, dismissed, expired, and duplicate recommendations.
- Selects one primary action for each scheduled opportunity.
- Stores a reason code so the recommendation is explainable and measurable.

Do not introduce an LLM dependency for basic shop-state decisions. AI can be considered later for wording or deeper analysis only when grounded in verified data.

### 3. Notification orchestration

One central service handles:
- Immediate event triggers.
- 08:00 / 11:00 / 15:00 local-time opportunities.
- At most one randomized inactivity reminder per local day.
- Snooze scheduling and retry safety.
- Quiet hours, opt-in, deduplication, per-day caps, and idempotency.

Cloudflare Cron should call a secret-protected server endpoint. Do not run database logic directly in the Worker scheduled handler; preserve the existing authenticated internal sweep pattern.

### 4. Persistence and APIs

Extend the existing Notification model rather than creating a disconnected inbox. Add explicit category, priority, action URL/label, deduplication key, status/lifecycle timestamps, and scheduled/snoozed timestamps. Add a user-owned push subscription model with unique endpoints and safe subscription lifecycle handling.

Every read, update, snooze, archive, restore, completion, and subscription operation must be scoped to the authenticated user. Never accept arbitrary external action URLs from the client; action destinations are allowlisted internal paths.

### 5. Premium client experience

- Refine the existing notification centre into New, Action needed, Scheduled, Completed, and Archived views.
- Distinct editorial notification cards for insight, action, milestone, and reminder types.
- Strong hierarchy, restrained motion, warm paper/cream surfaces, botanical green, mango-gold accents, and existing Mudaala typography.
- Primary action button, clear dismiss/archive controls, and snooze menu.
- Bell unread count and a subtle unread arrival animation.
- Mobile-first, accessible keyboard/touch targets, reduced-motion support, and low-data loading states.

### 6. Measurement

Capture separate, privacy-conscious events for:
- recommendation_created
- notification_scheduled
- push_subscribed / push_unsubscribed
- notification_delivered / notification_opened
- notification_snoozed / dismissed / archived
- recommendation_completed
- resulting product_created, photo_added, poster_shared, profile_completed
- downstream shop views, calls, and WhatsApp clicks where attribution is reliable

Do not equate notification delivery/opening with business success. Do not expose one merchant's private performance data to another merchant.

## Delivery phases and release gates

### Phase 1 — Foundation
- Schema migration and Prisma model updates.
- Recommendation snapshot and deterministic rules with unit tests.
- Notification lifecycle APIs: read, archive/restore, snooze, dismiss, complete.
- In-app notification centre with actionable destinations.
- Explicit merchant event tracking for poster and product sharing.
- CI migration, API ownership/isolation, idempotency, and UI tests.

### Phase 2 — Push delivery
- Service worker and push subscription lifecycle.
- VAPID key generation and Cloudflare secret configuration; private keys never enter Git.
- Permission onboarding that explains value and can be declined.
- Delivery, expiry, retry, and invalid-subscription cleanup tests.
- Browser/device compatibility verification.

### Phase 3 — Scheduling and intelligence
- Local-time schedule opportunities at 08:00, 11:00, 15:00.
- Randomized inactivity reminder with one-per-local-day dedupe.
- Event-triggered recommendations and adaptive timing.
- Quiet hours, daily caps, and snooze queue.
- End-to-end tests with simulated clocks and multiple timezones.

### Phase 4 — Habit and optimization
- Meaningful-action streaks and progress celebrations.
- Recommendation outcome analytics and cohort retention.
- Controlled experiments on copy/timing, never on manipulative pressure.
- Tune recommendation priority using observed completion and business outcomes.

## Current repository facts and constraints

- Mudaala already has an authenticated in-app Notification model/API and a notification centre.
- The current Notification model supports only type/title/body/listingId/read/createdAt; it does not yet support action destinations, snoozing, archival, completion, or deduplication.
- The current app has a PWA manifest but no discovered push-subscription/service-worker implementation.
- Shop poster generation exists in the shop view, but a poster download/share is not proof of external sharing. Explicit merchant-side share events are needed.
- Existing Cloudflare Cron currently runs the maintenance sweep at 03:00 UTC (06:00 Uganda time). Schedule changes must be coordinated with the new orchestration endpoint and must preserve the existing expiry/price-snapshot sweep.
- Production currently uses Supabase/Postgres through the existing Prisma/Hyperdrive path. Do not add a second database or external notification vendor without a concrete need.
- No push provider secrets or VAPID credentials should be assumed to exist. Push delivery must remain disabled until keys are configured and opt-in flows are verified.

## Non-negotiable release criteria

- No production migration or deploy until PR validation passes.
- No production push sends during development or test.
- Every API action enforces user ownership.
- Scheduled and event-triggered generation is idempotent.
- Quiet hours, snooze, dedupe, and caps are tested.
- Push opt-in is explicit and revocable.
- Existing transactional/moderation notifications continue working.
- Automatic deployment rollback remains enabled.
- Post-deploy checks verify health, existing notifications, recommendation APIs, and no cross-account access.
