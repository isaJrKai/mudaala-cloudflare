# Telegram Product Contact — Implementation Contract

## Product decision

Mudaala uses one Telegram bot, `@MudaalaMerchantbot`, for both shoppers and merchants. A buyer can discover a real Mudaala listing on the website or Mini App and start a private conversation with that listing's seller through the same bot. The bot relays messages; it does not expose either person's Telegram identity to the other.

This is a local-commerce connection feature. It does not add Mudaala checkout, payment custody, delivery fulfilment or order ownership.

## Product-page button

Render a product-level **Message seller on Telegram** action only when the listing's seller has completed all of these steps:

1. Linked their Telegram account to the correct Mudaala account using the existing secure linking flow.
2. Opened `@MudaalaMerchantbot` and pressed Start, so the bot is allowed to message them.
3. Explicitly enabled Telegram enquiries for their shop.

The listing detail API exposes only a boolean capability such as `telegramContactEnabled`; never expose the seller's Telegram user ID, chat ID, username or internal AppSetting key in public listing data.

If Telegram enquiries are not enabled, do not render a disabled or misleading Telegram button. Keep the existing phone and WhatsApp actions.

The button belongs with the existing seller contact actions on the product detail page. Do not add a permanent Telegram tab to the global navigation. Product cards may show a compact Telegram contact affordance only if it does not clutter the card and the seller is enabled.

## Deep-link contract

Use a Telegram bot deep link with a short, opaque, server-validated start payload associated with the listing, for example:

```text
https://t.me/MudaalaMerchantbot?start=p_<opaque-token>
```

Do not place private seller IDs, chat IDs, phone numbers or other sensitive data in the URL. Telegram start payloads have a limited length; keep the payload within Telegram's documented limit. Prefer a random, expiring, one-time enquiry-start token stored server-side and bound to the listing. Do not trust a listing ID or user ID in a client-supplied payload as authorization.

When the buyer starts the bot:
1. Validate and consume/claim the token safely.
2. Confirm the listing still exists, is public, active, unexpired and eligible for contact.
3. Resolve the seller's opted-in Telegram chat mapping.
4. Explain which product and shop the buyer is contacting.
5. Create or resume a private enquiry thread only after the buyer confirms.
6. If the buyer has not started the bot before, Telegram's deep link opens the bot and the buyer presses Start; then the bot can continue the flow.

## Seller activation and controls

The existing one-time account-linking flow is the identity foundation. Extend it to record a protected merchant Telegram chat mapping and a distinct opt-in flag. Do not infer opt-in solely from an old account link.

Seller controls should live in the existing Account / shop settings area:
- Connect Telegram.
- Open bot / verify bot activation.
- Enable or disable Telegram enquiries.
- Disconnect Telegram.

A seller must be able to turn off Telegram enquiries without losing their Mudaala account or other contact methods. On disconnect, immediately stop creating Telegram relay attempts for that seller; existing enquiry records remain available in the Mudaala inbox.

## Messaging behaviour

Buyer and seller each message the same Mudaala bot in their own private Telegram chat. The server routes messages through an enquiry ID. It must support several concurrent enquiries per buyer and seller; never rely on a single current-conversation pointer.

- Buyer messages are delivered only to the selected seller.
- Seller replies are delivered only to the buyer who opened that enquiry.
- Both parties see product context and Recent messages / Enquiry inbox.
- Neither party sees the other's Telegram account identity unless voluntarily shared.
- The bot labels relayed messages clearly as buyer or seller messages.
- Persist messages before sending; track delivery state and retry safely.
- Deduplicate Telegram updates and outbound sends.
- A blocked bot, missing chat, disabled seller opt-in or delivery error must be visible and must not be reported as delivered.
- If seller Telegram is unavailable, preserve the enquiry in the merchant inbox and offer available phone/WhatsApp contact options.

## Shared website / Mini App contract

The product detail page, Telegram bot and Mini App use the same listing and enquiry services. Telegram is a channel, not a second source of truth.

Buyer Recent messages and seller Enquiry inbox should be backed by the same enquiry/message records. Access is participant-scoped on every API request.

## Build sequence

1. **Seller Telegram capability:** secure chat mapping, explicit opt-in setting, account controls, public boolean capability on listing detail.
2. **Product CTA:** render the button only for opted-in sellers; generate a safe, expiring listing-bound deep link.
3. **Buyer start flow:** resolve the deep link, show product context, ask buyer to confirm opening an enquiry.
4. **Private relay:** persist and route messages in both directions with idempotency and delivery states.
5. **Inbox and notifications:** buyer Recent messages, seller Enquiry inbox, unread counts and reply notifications.
6. **Hardening:** privacy, spam controls, abuse reporting, retention, delivery fallback and end-to-end tests.

## Release gates

- No button appears for sellers who have not completed linking, bot activation and opt-in.
- No seller Telegram identifier appears in public API responses or page source.
- A forged, expired, reused or listing-mismatched deep-link token cannot create an enquiry.
- Only the selected seller receives a buyer's enquiry.
- Only the buyer and selected seller can read the thread.
- Multiple simultaneous conversations route correctly.
- Disabling Telegram enquiries prevents new Telegram relay delivery.
- Telegram delivery failures are represented truthfully.
- Existing phone/WhatsApp contact continues to work.
- No checkout, payment custody or delivery promises are introduced by this feature.
