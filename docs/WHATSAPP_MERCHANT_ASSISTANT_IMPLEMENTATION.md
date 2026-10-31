# WhatsApp Merchant Assistant — implementation status

## Current slice: secure webhook boundary

The first implementation slice adds `/api/whatsapp/webhook` with:

- Meta GET subscription challenge verification using `WHATSAPP_VERIFY_TOKEN`.
- POST verification of `X-Hub-Signature-256` against the exact raw request body using `WHATSAPP_APP_SECRET`.
- A 1 MB payload cap and safe JSON parsing.
- Extraction of inbound WhatsApp message IDs only.
- Atomic duplicate-delivery protection using the existing `AppSetting` primary key, with seven-day marker retention.
- No storage of message text, sender phone numbers, media URLs, access tokens, or other message contents in this first slice.

This endpoint acknowledges inbound messages and records their IDs. It does **not yet** link a merchant, download media, create a product draft, publish a listing, or send a WhatsApp reply. Those are subsequent slices and must reuse existing Mudaala identity, image moderation/storage, and listing creation rules.

## Cloudflare Worker secrets

Set these with `wrangler secret put` or the Cloudflare dashboard; never commit their values:

- `WHATSAPP_VERIFY_TOKEN`: a long random verification string chosen by Mudaala and entered unchanged in Meta's webhook configuration.
- `WHATSAPP_APP_SECRET`: the Meta app secret, used only to validate inbound webhook signatures.

The next outbound/API slice will additionally require:

- `WHATSAPP_ACCESS_TOKEN`: Meta system-user token or test token.
- `WHATSAPP_PHONE_NUMBER_ID`: the authorized WhatsApp phone-number ID.

Use Meta's test number until the production business number is eligible and explicitly connected. Do not migrate or unregister the existing WhatsApp Business app number as part of this work.

## Verification

Run:

```sh
bun test src/lib/whatsapp-webhook.test.mjs
npx tsc --noEmit
npm run lint
npm run build
```

Before deployment, configure the two webhook secrets in a non-production environment and complete Meta's webhook verification handshake. Production end-to-end acceptance still requires a real test message through Meta, deduplication on retry, merchant identity linking, and a reply.
