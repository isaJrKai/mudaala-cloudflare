# Mudaala Telegram Commerce Assistant — Operating & Implementation Specification

**Status:** Product decisions finalized; implementation specification  
**Repository:** `isaJrKai/mudaala-cloudflare`  
**Canonical product:** Mudaala — buy and sell near you  
**Document purpose:** Define the shared shopper/merchant Telegram experience, buyer–seller messaging, and implementation boundaries for the existing Mudaala codebase.

---

## 1. Product direction

Mudaala is a local commerce discovery and connection platform, not a checkout-first marketplace and not a bank. Its core flow is:

Shop joins → receives MU-CODE and QR → publishes products → shares shop → shoppers discover → shoppers contact or visit the seller.

Telegram is an additional access channel to the existing Mudaala platform. It must not create a second catalogue, merchant database, permissions system or marketplace backend.

**One Mudaala bot serves both shoppers and merchants.** A person can be both. Shopper and merchant are conversation modes, not mutually exclusive account types or authorization grants.

### Final operating decisions

| Area | Decision | Implementation meaning |
|---|---|---|
| Shopper registration | Both | Guest browsing and enquiries are allowed; registration unlocks persistent account features. |
| Seller contact | Choice | Buyer chooses Telegram-mediated Mudaala messaging, WhatsApp or phone where the seller has supplied those contact methods. |
| Saved products | Both | Temporary guest shortlist and persistent registered-user wishlist. |
| Availability | Both | Seller maintains a listing availability status; seller separately confirms availability in an individual enquiry. |
| Shopper follow-up | Permission | Follow-up only when the shopper explicitly consents to that specific follow-up. |

A registered shopper does not automatically become a merchant. A merchant can also shop. Backend authorization is checked for every privileged operation.

---

## 2. Critical product decision: buyer–seller messaging inside the same bot

The buyer and seller should be able to communicate through the same Mudaala Telegram bot. This is a **bot-mediated private messaging relay**, not a shared Telegram group and not direct exposure of personal Telegram accounts.

### Example journey

1. Buyer asks the bot: “Find black sneakers in Ntinda, size 42.”
2. Mudaala searches actual eligible listings in the existing catalogue.
3. The bot returns product cards with shop, area, price and seller-reported availability.
4. Buyer selects a product and taps **Message seller**.
5. Mudaala opens or creates a private enquiry conversation tied to that listing and seller.
6. Buyer sends a message through the bot.
7. The bot relays the message to the selected seller's linked Telegram account.
8. Seller replies to the bot; Mudaala relays the reply to the buyer.
9. Buyer receives a notification in their bot chat that the seller replied.
10. Both sides can find the conversation under **Recent messages**.

The buyer and seller each see their own private chat with the Mudaala bot. The bot routes messages between them using a server-side conversation record. They do not see each other's Telegram IDs, usernames, phone numbers or unrelated conversations unless they explicitly choose to share contact details.

### Telegram platform constraint

A Telegram bot cannot start a private conversation with a user who has never opened the bot and pressed Start. Therefore:

- Before a seller can receive Telegram-relayed enquiries, the seller must link Telegram to their Mudaala account and start the bot.
- If the seller has not connected Telegram, show another available contact option (WhatsApp or phone), or let the buyer leave an enquiry for the seller to see in the Mudaala merchant inbox.
- Do not claim a Telegram message was delivered until Telegram confirms the send operation.
- Handle blocked bots, inaccessible chats and delivery failures with a visible fallback status.
- Do not create fake seller identities or pretend the bot is the seller.

This limitation must be explained during merchant Telegram linking.

### Is this turning Mudaala into another marketplace?

No. Mudaala is facilitating discovery and communication. It is not required to take payment, hold funds, process checkout, guarantee stock, arrange delivery or become the seller of record. Those can remain outside the initial messaging scope.

The product is a **local discovery and connection network with a lightweight enquiry inbox**.

---

## 3. Shared architecture

All channels must call the same Mudaala application services:

- Telegram bot: conversational search, enquiry messages and notifications.
- Telegram Mini App: richer product browsing, shortlist and conversation inbox.
- Mudaala website: public discovery, account wishlist and conversation inbox where supported.

Architecture:

```text
Telegram Bot ─┐
Mini App ─────┼── Conversation Gateway
Website ──────┘       │
                      ├── Identity resolution
                      ├── Shopper / merchant mode routing
                      ├── Session isolation and rate limits
                      └── Intent orchestration
                              │
                    Shared Mudaala application services
                    ├── Discovery
                    ├── Saved products
                    ├── Enquiries and message relay
                    ├── Listing availability
                    ├── Merchant operations
                    └── Notifications
                              │
                    Existing Prisma / PostgreSQL
                    Existing listing, shop and user records
```

Groq interprets natural language and drafts responses. It does not authorize users, execute arbitrary SQL or directly mutate business records. Deterministic application services perform all reads and writes.

---

## 4. Existing codebase components to inspect and reuse

The existing implementation and prior Telegram work identify these integration points. Before implementation, verify the current default-branch contents and exact signatures; branch-specific files may differ.

### Authentication and identity
- Existing auth/session utilities and registration/login routes.
- Telegram Mini App session validation using signed Telegram `initData`.
- Existing secure Telegram account-linking flow and one-time linking code.
- Existing user and merchant profile records.

Reuse these. Do not collect passwords, OTPs or recovery credentials in Telegram messages.

### Catalogue and discovery
- Existing Prisma listing and business profile models.
- Existing listing API and listing search/serialization service.
- Existing search interpretation, validation and product synonym utilities.
- Existing public product image storage and listing eligibility/moderation checks.

Discovery must query the existing published catalogue. No duplicate bot catalogue and no AI-invented products or sellers.

### Infrastructure
- Existing Prisma database client and Supabase/Postgres.
- Existing Cloudflare Worker deployment and environment bindings.
- Existing shared rate limiter / Cloudflare Durable Object binding.
- Existing notification records and delivery infrastructure where suitable.
- Existing AppSetting key/value storage may support small configuration values, but should not become the long-term relational message store.

### Existing gaps to verify
- Current conversational assistant history is not yet sufficient for isolated shopper and merchant contexts.
- A real discovery tool must be connected to the conversational flow.
- Persistent saved-product wishlist may require a new model.
- A dedicated availability state is needed; listing lifecycle status is not stock availability.
- A durable enquiry and buyer–seller message relay is needed.
- A merchant must be able to link Telegram and initiate the bot before bot-mediated messages can be delivered.

---

## 5. Conversation identity and mode isolation

Use separate conversation contexts for the same Telegram identity:

```text
telegram:shopper:{telegram_user_id_hash}
telegram:merchant:{telegram_user_id_hash}
```

Store Telegram IDs in the form required for delivery in a protected identity mapping, not in public URLs or client-visible keys. Hashing is useful for lookup keys but does not replace access control.

Mode selection is only a conversational preference. Every merchant action must independently verify the linked Mudaala user, shop ownership and permission.

The bot should start with clear options:
- **Find products / Shop**
- **Manage my shop**

A person can switch modes without losing either conversation history. Do not merge shopper search history into merchant context.

---

## 6. Shopper discovery

Support natural-language requests such as “Find office chairs under UGX 300,000 in Ntinda.”

The model extracts a structured request; backend validation controls allowed fields and search execution. Example:

```json
{
  "intent": "product_discovery",
  "query": "office chairs",
  "location": {"type": "named_area", "value": "Ntinda"},
  "filters": {"max_price": 300000, "currency": "UGX"},
  "sort": "relevance"
}
```

Location modes:
- Named area supplied by shopper.
- Voluntarily shared coordinates.
- No location: ask the shopper or return broader results.

Never silently track, infer location from Telegram profile data or require location sharing.

Ranking can consider exact product relevance, distance when known, price fit, listing completeness, image quality, freshness and reliable trust/listing-integrity signals. Do not penalize a small merchant merely for having few followers. Do not sell undisclosed ranking placement.

Telegram quick results should show product image, name, price/currency, shop, area, availability and a product/Mini App link. Use the same discovery API and search parameters in the website and Mini App.

---

## 7. Saved products

Support both temporary guest shortlists and persistent account wishlists.

### Persistent model: SavedProduct
Suggested fields:
- `id`
- `userId`
- `listingId`
- `createdAt`

Add a unique constraint on `(userId, listingId)`.

Guest shortlist:
- Use an opaque guest/session token, not a raw Telegram ID in a public identifier.
- Apply expiry and size limits.
- Avoid retaining unnecessary personal information.
- On registration/login, validate listings and merge valid entries into the account wishlist without duplicates.
- Expire the temporary shortlist after successful migration or its retention window.

Saving a product is not a reservation or stock guarantee.

---

## 8. Enquiry and message relay

### Domain model

Use a durable conversation/enquiry record linked to a listing, buyer and selected merchant. Guest buyer identity may be nullable and represented by a protected guest token mapping.

Suggested entities:

**Enquiry**
- `id`
- `listingId`
- `merchantId`
- `shopperId` nullable
- `guestTokenHash` nullable
- `status`
- `contactChannel`
- `shopperConsentAt`
- `followUpConsentAt` nullable
- `createdAt`, `updatedAt`

**EnquiryMessage**
- `id`
- `enquiryId`
- `senderType` (SHOPPER or MERCHANT)
- `senderUserId` nullable for guest
- `body`
- `createdAt`
- `deliveryStatus`
- `telegramUpdateId` or idempotency key where appropriate

**TelegramIdentity**
- Link Telegram user/chat identity to a Mudaala account, with verified linking state and timestamps. Reuse the existing mapping if it already provides these guarantees; do not create a duplicate table unnecessarily.

Suggested enquiry states:
`INITIATED → CONFIRMED → OPEN → RESPONDED → RESOLVED`
Also support `CANCELLED`, `EXPIRED` and `DELIVERY_FAILED`.

Message delivery status should separately track `PENDING`, `SENT`, `FAILED` and, where available, Telegram API acknowledgement. Enquiry state and transport delivery state are different concepts.

### Message routing rules

- Only the buyer and selected merchant can read an enquiry.
- A merchant cannot see a shopper's other searches, shortlist or conversations with competitors.
- A seller receives only the listing and buyer message necessary to respond.
- The bot must not expose the other party's Telegram ID or username.
- A seller can only reply to enquiries belonging to their own shop.
- A buyer can only access their own enquiries.
- Guest conversations use an unguessable, protected session binding and must not be exposed through enumerable IDs.
- Validate listing eligibility and ownership at enquiry creation and on every protected operation.
- Use idempotency to prevent duplicate enquiries/messages from repeated webhook updates.
- Rate-limit messages and apply abuse reporting/blocking, spam detection and moderation rules.
- Keep an auditable event trail for message delivery and security-sensitive actions.

### Telegram relay behaviour

When the buyer sends a message:
1. Validate Telegram webhook/update authenticity and deduplicate the update.
2. Resolve the buyer's active conversation.
3. Verify that the conversation is open and buyer is a participant.
4. Persist the message.
5. Resolve the selected merchant's linked Telegram chat.
6. Send a clearly labelled forwarded message through the bot.
7. Persist delivery outcome.
8. Notify the buyer if delivery fails and offer an alternative contact route.

When the merchant replies:
1. Resolve the merchant identity and active enquiry context.
2. Verify shop ownership and participation.
3. Persist the reply.
4. Relay it to the buyer's Telegram chat if reachable.
5. Notify the buyer and update Recent messages.

Do not rely on a single global “current enquiry” variable. A merchant may have multiple simultaneous conversations. Use explicit conversation identifiers and inline buttons/deep links to open the correct thread.

### Merchant Telegram activation
A merchant must:
1. Link Telegram to their authenticated Mudaala account through the secure linking flow.
2. Open the bot and press Start.
3. Confirm that they want to receive Mudaala enquiry notifications.
4. Have the verified Telegram chat mapping stored.

If the merchant has not activated Telegram, keep the enquiry in the merchant inbox and use other permitted contact methods. Do not claim Telegram delivery.

---

## 9. Contact options

At product level, the shopper can choose:
- **Message seller on Mudaala** — preferred integrated experience; bot-mediated Telegram relay and shared Mudaala inbox.
- **WhatsApp seller** — open the seller's published WhatsApp contact after shopper action.
- **Call seller** — open the seller's published phone number after shopper action.

The choice must be explicit. Do not create a seller enquiry or notify the seller merely because the shopper viewed or saved a listing. For phone/WhatsApp, explain that the shopper is leaving Mudaala and that those external channels have their own privacy behaviour.

---

## 10. Recent messages and notifications

The buyer needs a **Recent messages** area, not just one-off bot replies.

It should show:
- Shop name and product context.
- Latest message preview.
- Last activity time.
- Unread indicator.
- Enquiry status.
- Link to reopen the conversation.

The merchant needs the equivalent **Enquiry inbox** showing the selected listing, buyer message, unread count and response action.

Notifications:
- New enquiry to selected merchant.
- Seller reply to buyer.
- Delivery failure or inaccessible Telegram chat.
- Listing moderation outcome to merchant.
- Follow-up only where separately consented.

Notification delivery can use the same bot, Mini App and in-app notification channels. Keep notifications concise and privacy-conscious. Do not send promotional messages based on private searches.

A lightweight enquiry inbox and asynchronous relay are the first release. Do not build typing indicators, read receipts, calls, group chats, media galleries or a full WhatsApp-like real-time chat platform in the first iteration. Add image attachments only after secure upload, moderation and retention policies are designed.

---

## 11. Availability

Keep listing lifecycle status separate from physical availability.

Add a dedicated availability field, for example:
- `IN_STOCK`
- `AVAILABLE_ON_ORDER`
- `OUT_OF_STOCK`
- `UNKNOWN`

Default to `UNKNOWN` unless the merchant explicitly declares availability.

Distinguish:
- **Listed:** listing is published and eligible.
- **Seller-reported available:** seller's current listing status says available.
- **Confirmed for this enquiry:** seller has explicitly confirmed stock for this buyer's enquiry.

Never infer stock from a listing being active or from an AI response. Consider an availability update audit history.

---

## 12. Follow-up consent

Ask the shopper whether they want Mudaala to check back about a specific enquiry. Store the answer, timestamp, scope and channel.

- No consent means no automated follow-up.
- Enquiry follow-up consent is not marketing consent.
- Provide an easy stop/opt-out mechanism.
- Do not send repeated reminders.
- A reasonable initial default is one check-in after 24 hours, only where consent was granted and the enquiry remains unresolved.
- Keep the seller's ability to reply separate from Mudaala's permission to send shopper follow-ups.

---

## 13. Merchant assistant

Reuse existing merchant profile, listing and analytics services. Bot intents may include:
- Show my shop.
- Show my products.
- Guide me through adding a product.
- Show actual listing status.
- Update availability.
- Show recent enquiries.
- Open an enquiry and reply.
- Show available analytics.

All writes must pass through existing or newly defined application services after server-side authentication, ownership checks, validation and audit logging. Groq must never write directly to Prisma.

---

## 14. Suggested implementation layout

Adapt names to existing conventions after inspecting the current branch; avoid duplicating existing services.

```text
src/
  app/api/
    telegram/webhook/route.ts             # Extend: role-aware routing and relay
    discovery/route.ts                    # New: shared discovery endpoint
    saved-products/route.ts               # New: wishlist operations
    enquiries/route.ts                    # New: create/list enquiries
    enquiries/[id]/route.ts               # New: read/update authorised enquiry
    enquiries/[id]/messages/route.ts      # New: send/list messages
    listings/[id]/availability/route.ts   # New: seller availability update

  lib/
    telegram-assistant.ts                 # Refactor: shopper + merchant prompts/tools
    telegram-conversation.ts              # New: isolated contexts
    telegram-router.ts                    # New: deterministic intent routing
    discovery.ts                          # New: shared discovery orchestration
    saved-products.ts                     # New: guest/account shortlists
    enquiries.ts                          # New: enquiry domain service
    enquiry-messaging.ts                  # New: message persistence and relay
    availability.ts                       # New: availability validation
    notifications.ts                      # Extend: enquiry notifications

  components/
    shopper/
      product-results.tsx
      saved-products.tsx
      recent-messages.tsx
      enquiry-thread.tsx
    merchant/
      enquiry-inbox.tsx
      enquiry-thread.tsx

prisma/
  schema.prisma                           # Add only missing models/fields

docs/
  TELEGRAM_COMMERCE_ASSISTANT_IMPLEMENTATION.md
```

The API routes should be thin. Authorization, business rules and database mutations belong in reusable services called by Telegram, website and Mini App.

---

## 15. Security, privacy and cost controls

- Validate Telegram webhook authenticity and signed Mini App `initData`.
- Enforce ownership and participant checks on every enquiry/message read and write.
- Never trust a Telegram callback payload as proof of identity or permission.
- Use opaque IDs, idempotency keys and replay protection.
- Keep buyer and merchant conversation contexts isolated.
- Protect Telegram chat identifiers and guest session tokens.
- Apply per-user, per-chat and global rate limits.
- Add message length limits, abuse controls and reporting/blocking.
- Store only necessary conversation data; define retention and deletion policies.
- Keep Groq API credentials in Worker secrets and verify the actual Cloudflare runtime binding access before deployment.
- Bound model input/history/output and track actual token usage. Use deterministic routes for common actions; enforce shared token budgets atomically rather than using request count as a token proxy.
- AI can suggest a tool call, but backend services validate every parameter and permission.

---

## 16. Delivery phases

### Phase 1 — Conversation foundation
- Refactor Telegram routing into shopper and merchant modes.
- Isolate histories and identity mappings.
- Preserve secure linking and Mini App authentication.
- Add deterministic help and mode switching.
- Verify Groq secret access and sensible usage controls.

### Phase 2 — Real discovery
- Reuse existing listing search and validation.
- Support product, budget and named-area queries.
- Support voluntarily shared location.
- Return real product results in Telegram.
- Link to the same result set in the Mini App and website.

### Phase 3 — Saved products
- Add persistent wishlist.
- Add temporary guest shortlist.
- Merge guest shortlist after registration.
- Add save/remove actions and expiry handling.

### Phase 4 — Enquiries and Telegram relay
- Add enquiry and message persistence.
- Add buyer contact choice.
- Add merchant Telegram activation.
- Implement private bot-mediated message relay.
- Add buyer Recent messages and merchant Enquiry inbox.
- Add delivery status, retries and fallback contact methods.

### Phase 5 — Availability and follow-up
- Add seller availability status.
- Add per-enquiry seller confirmation.
- Add follow-up consent and opt-out.
- Add audit trail and notification controls.

### Phase 6 — Advanced intelligence
- Improve query interpretation and ranking using real outcomes.
- Add richer search only when Postgres capabilities are insufficient.
- Consider external social discovery only after internal discovery, messaging and trust are reliable.

---

## 17. Release acceptance criteria

1. Guest can search products without registration.
2. Shopper and merchant can use the same Telegram bot.
3. One linked user can switch modes without history crossover.
4. Search results are real, eligible Mudaala listings.
5. Shopper can save products as guest and registered user.
6. Guest shortlist can be merged after registration.
7. Buyer can choose Telegram-mediated messaging, WhatsApp or phone.
8. Seller receives a Telegram relay only after activating the bot and linking their account.
9. Buyer and seller see only their own enquiry conversations.
10. Buyer has Recent messages and receives seller-reply notifications.
11. Merchant has an enquiry inbox and can reply to the correct thread.
12. Only the selected merchant is notified of an enquiry.
13. Telegram delivery failures are visible and do not falsely appear successful.
14. Listing availability is distinct from listing lifecycle status.
15. Follow-up is never sent without explicit permission.
16. Unauthorized AI-suggested writes are rejected by backend authorization.
17. Duplicate webhook updates do not create duplicate enquiries or messages.
18. Security tests cover forged updates, expired sessions, cross-merchant access, guest-token guessing, blocked bots and notification privacy.

---

## 18. First implementation scope

Do not implement all phases in one PR.

Start with:
1. A current-code audit of Telegram webhook, account linking, listing search, Prisma models, notifications and Worker environment bindings.
2. Shopper/merchant conversation isolation.
3. Deterministic intent routing and secure role checks.
4. Real listing discovery from the existing catalogue.
5. Telegram product result cards and Mini App handoff.

Then implement saved products and the enquiry/message relay as subsequent independently testable PRs.

**Product principle:** Mudaala connects a buyer to a real local seller. The bot is the communication bridge; the existing Mudaala platform remains the source of truth. Discovery and messaging do not require Mudaala to own checkout, payment, fulfilment or delivery.
