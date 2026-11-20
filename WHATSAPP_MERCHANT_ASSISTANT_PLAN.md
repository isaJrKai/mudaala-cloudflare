# Mudaala WhatsApp Merchant Assistant — Technical Plan

Status: discovery complete; plan ready for review. This is a separate merchant module connected to Mudaala's existing backend, not a marketplace rewrite. No production schema changes or credentials have been made.

## Goal and decisions

Build one shared Mudaala WhatsApp Business assistant that serves many shop owners. Each sender is securely linked to their own Mudaala account. The first release accepts a photo or photo+caption, collects missing product details, previews the listing, publishes only after the merchant confirms, and replies with the product URL.

Merchant functions:
1. Add a product.
2. Manage existing products.
3. View shop performance.
4. Review customer activity.
5. Get their shop link and later actionable growth suggestions.

Start with Meta's test number and a Gemini API key in non-production. Core workflows must work without AI; AI is only a helper for photo understanding and draft copy.

## Repository and database inspection

Current implementation target for this work: `isaJrKai/mudaala-cloudflare` `main` (most recent inspected commit: `9b3a069c846bdf45929d33653215194e1791ee5e`, 2026-10-27). The separate `isaJrKai/mudaala` repository's main branch is older (latest inspected commit dated 2026-10-13) and does not contain the analytics/showroom implementation found in the current repository/database. Do not implement this feature in the older repository.

Connected Supabase project: `Mudaala`, region `eu-west-2`, status `ACTIVE_HEALTHY`. Read-only inspection found the expected current tables, including `ListingDailyAnalytics`, `ShopDailyAnalytics`, `ShopFollow`, `BusinessProduct`, `Sale`, `SaleItem`, `StockMovement`, `ProductCollection`, `ProductCollectionItem`, and `ShowroomItem`. Existing database rows were not changed.

Relevant existing code to reuse:
- `src/app/api/listings/route.ts`: canonical listing creation with authenticated owner, input validation, rate limiting, prohibited-item checks, country/currency/location rules, expiry, photo sanitization and saved-search notifications.
- `src/app/api/listings/[id]/route.ts`: listing detail and owner-only edit/status transitions.
- `src/app/api/upload/route.ts`: authenticated upload path with size and magic-byte checks, metadata stripping, content moderation, rate limiting and storage persistence.
- `src/lib/storage.ts`: `PhotoStorage` abstraction for local development and S3-compatible production storage (including Supabase Storage/R2).
- `src/lib/listing-analytics.ts`: daily aggregate events for shop/listing views, call clicks, WhatsApp clicks and shares. It stores aggregate counts, not viewer identities or raw event streams.
- `src/app/api/my/business-analytics/route.ts`: authenticated shop analytics, top listings, contact clicks and seller-recorded sales summaries.
- `src/lib/auth.ts` and `src/lib/api.ts`: existing session and API security patterns.
- `prisma/schema.prisma`: `User.phone` is unique and normalized E.164; `BusinessProfile.userId` uniquely identifies the shop owner; `Listing.userId` enforces listing ownership.

No existing WhatsApp webhook integration was found in the current repository.

## Proposed architecture

### 1. Meta webhook boundary
- Add a dedicated WhatsApp module and HTTPS webhook route; keep it separate from browser-session routes.
- Implement GET webhook challenge verification and POST signature verification with the Meta app secret.
- Validate inbound payload shape and acknowledge promptly; process messages safely and handle retries.
- Keep all Meta and Gemini secrets server-side; never use `NEXT_PUBLIC_*` for secrets.

### 2. Explicit merchant linking
- Do not trust a shop ID or phone number typed into chat.
- Generate an expiring one-time link code from an authenticated Mudaala account page/action; merchant sends that code from the WhatsApp number they want to link.
- Verify the code and sender, store a persistent link from normalized WhatsApp sender to `User.id`, and support unlink/revocation.
- Do not assume `User.phone` or public `BusinessProfile.phone` alone proves control of a WhatsApp number.
- All commands resolve the owner from the verified link on the server; all listing operations use that resolved `User.id`.

### 3. Product intake and publishing
- Accept a photo-only message or photo with caption.
- Fetch media from Meta with the server-side access token, enforce a strict byte limit, validate real image format, and use the existing moderation/storage path.
- Refactor reusable server-side image processing/storage out of the browser-session upload route if needed; do not call that route with fake cookies or bypass `requireUser`.
- Keep a persistent conversation draft so the bot can ask for missing name, price, category, district/area, quantity/unit and contact details.
- AI may suggest a title/description and identify likely product attributes, but it must never invent price, quantity, stock, or other facts. Merchant can edit the draft and must confirm before publication.
- Reuse the same domain validation and creation logic as `src/app/api/listings/route.ts`; extract shared service code rather than copying rules into the bot.
- Enforce existing prohibited-item policy, listing expiry, phone/location validation, rate limits and notification behavior.
- Reply with the resulting public listing URL.

### 4. Reliability and isolation
- Add persistent idempotency on Meta message IDs so webhook retries do not duplicate images, drafts or listings.
- Store conversation state with expiry and a clear cancel/reset command.
- Test unknown/unlinked sender, invalid signature, duplicate webhook, malformed media, missing price, prohibited product, rate limits, and cross-shop isolation.
- Never accept arbitrary `userId` from webhook payloads or chat text.

### 5. Shop analytics and activity
- Reuse the existing business-analytics endpoint/domain logic and daily aggregates rather than creating duplicate analytics tables.
- Show honest metrics: shop views, listing views, call-button taps, WhatsApp-button taps, shares and shop follows when available. Button taps are not proof of completed calls/messages/sales; views are not necessarily unique people.
- Keep customer identities private; show aggregate engagement unless a customer has deliberately shared information.
- The database has a `ShopFollow` relation; check the existing public shop routes before adding any follower notifications.

### 6. Menu and actionable nudges
- Menu: Add a product; My products; Shop performance; Customer activity; My shop link; Help.
- Use WhatsApp interactive list/reply-button messages where supported, plus text commands as a fallback.
- Add proactive nudges only after events are verified. Make them opt-in, frequency-capped, deduplicated, actionable, and compliant with Meta's message/template rules.
- Keep the first pilot inbound-led to minimize messaging costs.

### 7. AI provider
- Put Gemini behind a small server-side adapter, optional to the core flow.
- Use Gemini free-tier eligibility for a non-production pilot; confirm available model/quota before choosing a model.
- Add timeout, bounded input/output, graceful fallback and rate/cost caps. Never log API keys or send unnecessary customer information to the model.
- Do not use AI as the source of truth for product facts.

## Minimal release plan

1. Add configuration validation and webhook GET/POST routes with signature checks.
2. Add explicit WhatsApp account linking, unlinking and ownership tests.
3. Add persistent message deduplication and short-lived product drafts.
4. Reuse the current image moderation/storage service and listing creation rules.
5. Support photo/caption intake, missing-field prompts, preview, owner confirmation and published URL.
6. Add a read-only WhatsApp menu for existing shop analytics and shop link.
7. Only after core release is stable, add opt-in nudges and growth suggestions.

## Secrets/configuration

Expected server-only settings (names to finalize in implementation):
- `WHATSAPP_VERIFY_TOKEN`
- `WHATSAPP_APP_SECRET`
- `WHATSAPP_ACCESS_TOKEN` (Meta test token first)
- `WHATSAPP_PHONE_NUMBER_ID`
- `GEMINI_API_KEY` (optional)

Do not commit real values to GitHub. Use the non-production hosting environment for test credentials. Keep the existing database and photo-storage configuration unchanged.

## Verification gates

- Confirm the currently deployed Worker is connected to this repository/branch before any deployment.
- CI must pass: typecheck, lint, tests and production build.
- Run webhook integration tests with Meta's test app and a dedicated test merchant only.
- Verify one inbound photo creates one stored photo and at most one listing, owned by the linked account; verify another merchant cannot access/edit it.
- Verify analytics values against existing Mudaala metrics and labels.
- Deploy only after green CI and a staging end-to-end test. Do not claim production availability until a real test message has traversed Meta -> webhook -> existing storage/listing code -> WhatsApp reply.

## First release acceptance criteria

A linked test merchant sends a photo and price in WhatsApp, confirms a preview, and receives a working Mudaala listing URL. The image uses the existing storage backend, all existing listing safety rules still apply, duplicate webhook delivery does not duplicate the listing, analytics can be queried without new parallel tables, and the marketplace remains usable if WhatsApp or Gemini is unavailable.
