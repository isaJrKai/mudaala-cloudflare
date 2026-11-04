# WhatsApp Merchant Assistant — implementation status

## Current slice: hardened webhook boundary

The first implementation slice adds `/api/whatsapp/webhook` with:

- Meta GET subscription challenge verification using the server-side `WHATSAPP_VERIFY_TOKEN`.
- Per-IP shared Durable Object rate limits for the public verification handshake and inbound webhook.
- POST verification of `X-Hub-Signature-256` against the exact raw request bytes before UTF-8 decoding or JSON parsing.
- A genuinely bounded streaming body reader with a 1 MB cap; the stream is cancelled as soon as the cap is exceeded, including when Content-Length is absent or inaccurate.
- Safe JSON parsing and extraction of inbound message IDs only.
- Atomic duplicate-delivery protection using the existing `AppSetting` primary key.
- Expired idempotency markers are cleaned in batches of at most 100 per accepted inbound delivery.
- No storage of message text, sender phone numbers, media URLs, access tokens or other message contents.

This endpoint acknowledges inbound messages and records their IDs. It does **not yet** link a merchant, download media, create a product draft, publish a listing, send a WhatsApp reply or provide a merchant UI. Those are later slices and must reuse Mudaala identity, image moderation/storage and listing-creation rules.

## Cloudflare Worker secrets

Set real values only as Cloudflare Worker secrets; never commit them:

- `WHATSAPP_VERIFY_TOKEN`: random verification string entered in Meta webhook configuration.
- `WHATSAPP_APP_SECRET`: Meta app secret used to validate inbound signatures.

Outbound messaging/media retrieval will additionally require:

- `WHATSAPP_ACCESS_TOKEN`: Meta test or system-user token.
- `WHATSAPP_PHONE_NUMBER_ID`: authorized WhatsApp phone-number ID.

Use Meta's test number until the production business number is eligible and explicitly connected. Do not migrate or unregister the existing WhatsApp Business app number as part of this work.

## Validation

```sh
bun test src/lib/whatsapp-webhook.test.mjs
npx tsc --noEmit
npm run lint
npm run build
```

The production route uses the existing shared Durable Object rate limiter and fails closed if it is unavailable. The 600 POST / 15-minute and 20 GET / 15-minute per-IP limits are conservative pilot defaults and must be reviewed against actual Meta webhook traffic before launch.

Before any deployment, configure test-environment secrets and complete Meta's signed test-message round trip. Production acceptance still requires merchant linking, media intake, draft confirmation, at-most-once publishing, replies, consent and real merchant acceptance.
