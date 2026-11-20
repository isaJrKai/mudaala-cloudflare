# WhatsApp Merchant Assistant — integration readiness

**Status:** Preparation only. No Meta account connection, credentials, production configuration, database migration, or deployment has been performed.

**Baseline:** `main` at `34db26b29a84f01b35f9f18e2f67f85c7b38279a` (31 October 2026).

## What exists today

- Draft PR [#206](https://github.com/isaJrKai/mudaala-cloudflare/pull/206) adds the Meta webhook subscription handshake, raw-body HMAC signature verification, payload size limit, inbound message-ID extraction, and short-lived duplicate markers.
- PR #206 deliberately does not link a merchant, retrieve media, create a product draft, publish a listing, or send a reply. It is still a draft and must be reviewed and validated before merge.
- The canonical listing flow is `src/app/api/listings/route.ts`. It enforces authenticated ownership, schema validation, rate limits, prohibited-item checks, phone/location rules, expiry and saved-search notifications.
- The canonical photo path is `src/app/api/upload/route.ts`. It requires a signed-in owner, validates image bytes and size, strips metadata, moderates images and stores them through the existing storage abstraction.
- The database already has `User`, `BusinessProfile`, `Listing` and `AppSetting`. `User.phone` is unique and E.164-normalized, but a stored phone number alone is not proof that the sender controls a WhatsApp account.
- The existing app uses request-scoped Prisma access in production. New webhook database work must execute inside the established request database scope and preserve existing least-privilege rules.

## Meta account status

**UNKNOWN — not observable from repository access.** GitHub access cannot establish whether the founder's Meta Business Portfolio, Meta Developer App, WhatsApp Business Account (WABA), phone number, business verification or permissions have been approved. No connected Meta account tool was available in this review.

Do not infer approval from a WhatsApp Business mobile-app account. The assistant needs the WhatsApp Business Platform / Cloud API. Do not unregister, migrate, or otherwise disturb the existing WhatsApp Business app number as part of preparation.

## Target merchant experience

1. A shop owner links their Mudaala shop to a WhatsApp sender they control.
2. The owner sends a product photo, optionally with a caption.
3. Mudaala retrieves the media securely and validates its size and actual image type.
4. The assistant asks for missing facts such as product name, price, price unit, category, quantity, district/area and availability. It must not invent price, stock or other factual details.
5. The assistant returns a clear preview and asks the owner to confirm.
6. Only an explicit confirmation publishes the listing through the same domain rules as the existing Mudaala listing flow.
7. The owner receives the public listing link and can request help or cancel a draft.

The core journey must remain usable without an AI provider. AI may suggest a title, description or likely category, but the merchant remains the source of truth.

## Implementation sequence

### Slice 0 — secure webhook foundation

- Review and validate PR #206 on its exact head.
- Keep Meta verification and signature checks server-side.
- Check that message-ID idempotency cannot cause an unbounded database scan or accept untrusted identifiers as keys.
- Do not deploy or configure production secrets as part of this slice.

### Slice 1 — merchant linking

- Add an authenticated Mudaala action that creates a high-entropy, single-use, short-expiry linking code.
- Bind the code to the authenticated `User.id`; store only a keyed hash, expiry, attempt counter and consumed state.
- The WhatsApp sender submits the code from the number they intend to link.
- Consume the code atomically; bind the normalized Meta sender identity to exactly one Mudaala user.
- Add authenticated unlink/revoke and relink flows.
- Never accept a `userId`, shop code, or phone number supplied in a chat as proof of ownership.
- Add cross-shop isolation, expiry, replay, brute-force and concurrent-consumption tests.

### Slice 2 — persistent conversation and product draft

- Add reviewed, additive schema for WhatsApp sender links, short-lived conversation state and product drafts only after the access model and retention policy are agreed.
- Store only the minimum sender identifiers and state needed to operate the assistant. Avoid retaining message text or media longer than required.
- Make draft states explicit: `COLLECTING`, `READY_FOR_CONFIRMATION`, `PUBLISHED`, `CANCELLED`, `EXPIRED`.
- Support clear cancel/reset commands, expiry and duplicate-message idempotency.
- Keep draft data private to the linked shop owner.

### Slice 3 — safe media intake and draft enrichment

- Retrieve media only through Meta's authenticated media endpoints using server-side credentials.
- Enforce response-size, timeout, MIME and magic-byte checks before processing.
- Reuse the existing moderation and storage rules. Do not bypass the authenticated upload route with fake cookies; extract a shared server-side media service if required.
- Strip EXIF/location metadata and avoid public media URLs or signed download URLs in logs.
- If AI is unavailable, ask the merchant for the missing fields and continue with a deterministic draft.

### Slice 4 — confirmed publishing

- Extract a shared listing-creation domain service from the current listing route before calling it from the webhook.
- Preserve all existing validation, rate limits, moderation, ownership, location/currency rules, expiry and notification behavior.
- Publish only after an explicit confirmation tied to the exact draft revision. Any material edit invalidates the previous confirmation.
- Enforce at-most-once listing creation under webhook retries and concurrent confirmations.
- Reply with the resulting public listing URL only after the database confirms publication.

### Slice 5 — read-only shop menu and engagement

- Reuse existing authenticated business analytics and shop-link logic; do not create parallel analytics tables.
- Label views and contact-button taps accurately. A WhatsApp tap is not proof a message was sent; a call tap is not proof a call connected; neither is proof of a sale.
- Add opt-in, frequency-capped reminders only after event sources and Meta template/consent requirements are verified.

## Configuration prerequisites (names only; values must never enter Git)

Webhook:
- `WHATSAPP_VERIFY_TOKEN`
- `WHATSAPP_APP_SECRET`

Cloud API:
- `WHATSAPP_ACCESS_TOKEN`
- `WHATSAPP_PHONE_NUMBER_ID`

Optional AI provider:
- `GEMINI_API_KEY` (or another explicitly selected provider)

Use a Meta test number and non-production secrets for the first end-to-end pilot. Keep credentials in the appropriate Cloudflare Worker secret store; never use `NEXT_PUBLIC_*`, repository files, commits, issues, screenshots or chat messages for secret values. Confirm token scopes and expiry/rotation before any pilot.

## Meta setup checklist — founder/account owner

- [ ] Confirm access to a Meta Business Portfolio.
- [ ] Create or select a Meta Developer App with the WhatsApp product.
- [ ] Create/select the WABA and use Meta's test number first.
- [ ] Confirm the app has the required WhatsApp webhook subscriptions and permissions.
- [ ] Configure the callback URL and verification token only in a non-production environment.
- [ ] Complete the webhook challenge and signed test-message round trip.
- [ ] Confirm business verification and production-number eligibility requirements in Meta.
- [ ] Decide explicitly whether to use a separate API number or an officially supported coexistence path; do not migrate the current app number by assumption.
- [ ] Approve the required Cloud API token, phone-number ID and app-secret handling.
- [ ] Only after staging acceptance, authorize production secrets and deployment separately.

## Release gates

- Exact-head CI passes typecheck, lint, unit/integration tests and production build.
- Webhook signature failures, malformed JSON, oversized payloads and retries are covered.
- Linking codes are single-use, expiring, rate-limited and cannot link another owner's shop.
- A sender cannot read or modify another shop's drafts or listings.
- Media is moderated and stored through the existing durable storage path.
- A confirmed draft creates at most one listing and no listing is created before confirmation.
- AI/provider/Meta downtime does not break ordinary Mudaala browsing, posting or account flows.
- Staging Meta test-number journey succeeds end-to-end before production is considered.
- Physical-device and real merchant acceptance is recorded separately from CI.
- Update `docs/MASTER_CHECKLIST.md` and issue #163 only after evidence exists.

## Explicit non-goals for preparation

- No production database migration or write.
- No production Worker secret/configuration change.
- No real merchant/customer messages or test customer records.
- No production deployment, phone-number migration or Meta account changes.
- No automatic replies or proactive marketing messages before consent, policy and template requirements are confirmed.
