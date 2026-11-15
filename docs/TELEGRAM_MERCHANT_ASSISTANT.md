# Telegram Merchant Assistant — first integration slice

## Scope

This opt-in channel reuses Mudaala's existing user, shop and listing records. It does not create a second inventory database or replace in-app chat, phone or WhatsApp contact.

Initial commands: `/start`, `/help`, `/link CODE`, `/shop` and `/products`. Product creation/editing and photo uploads are intentionally excluded until they can reuse the existing listing validation, prohibited-item checks, upload quarantine and image moderation pipeline.

## Product-quality guardrails

- Keep the bot and Mini App within Mudaala's existing product identity and design system. Do not introduce generic chatbot templates, AI-generated UI copy, decorative gradients, stock/placeholder imagery, emoji-heavy controls, or unrelated icon libraries.
- Do not fabricate shops, listings, prices, availability, seller ratings, customer activity or analytics. Product discovery must query active, non-seed Mudaala listings; seller-reported availability must remain clearly labelled as unverified.
- Use deterministic backend commands for search, linking, enquiries, replies, consent, and account changes. The language model may explain and guide, but it cannot write to the database, trigger an action, or claim an action succeeded.
- Keep model replies short, factual and explicit about uncertainty. If the model/provider is unavailable, use a plain, accurate fallback and preserve all deterministic bot commands.
- Do not add features merely to make the bot appear intelligent. Every surface must solve a real merchant or shopper task and be testable against actual backend behaviour.

## Secrets

Configure these as Cloudflare Worker Secrets, never vars or committed files: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET` and `GROQ_API_KEY`. The webhook secret must be 1–256 characters and use only letters, numbers, underscores or hyphens. `GROQ_API_KEY` is the key from the Groq Console; it is used only by the server-side Telegram assistant and must never be exposed to the browser or committed to Git.

## Conversational assistant\n\nOrdinary private-chat messages are routed to the Mudaala conversational assistant using Groq (`openai/gpt-oss-120b`). The assistant keeps a short, per-Telegram-user conversation history in `AppSetting`, keyed by a SHA-256 digest, with a 24-hour expiry and a bounded message count. Linked shop context is read-only and limited to public shop identity fields. The model cannot execute database writes, access credentials, or change shop data. Account creation and visual catalogue/photo work remain in the secure Mini App. If Groq is unavailable or the key is missing, the bot returns a safe fallback rather than the old “unknown command” response.\n\n## Registration

After deployment, register the webhook from a trusted local environment using `TELEGRAM_BOT_TOKEN` and `TELEGRAM_WEBHOOK_SECRET` as environment variables:

```sh
TELEGRAM_BOT_TOKEN='…' TELEGRAM_WEBHOOK_SECRET='…' node scripts/register-telegram-webhook.mjs
```

The helper sets `https://mudaala.store/api/telegram/webhook`, enables only message updates and supplies Telegram's `X-Telegram-Bot-Api-Secret-Token` header value. Never place the bot token in source control, logs or chat.

## Merchant flow

1. Sign in to Mudaala and open Account.
2. Generate a one-time code valid for 10 minutes.
3. Open [@MudaalaMerchantbot](https://t.me/MudaalaMerchantbot) and send `/link CODE`.
4. Use `/shop` or `/products`.

The code is random, stored only as a SHA-256 digest, single-use and short-lived. Telegram user IDs are hashed before database keys are created. Only private chats are accepted. The webhook verifies Telegram's secret header, enforces a 64 KiB streaming request-body limit, deduplicates update IDs, rate-limits chat traffic and periodically removes old Telegram-only link-code and update-marker records.

## Buyer account identity

A signed-in shopper's Telegram enquiry is attached to their Mudaala account only after the same Telegram identity has been linked with that account using the one-time `/link CODE` flow. The webhook verifies the account mapping both when the deep link is opened and again when the buyer confirms. A forwarded link cannot attach an enquiry to another person's account. Guest enquiries remain Telegram-identified and are available through `/messages` and `/respond`; they are not silently assigned to a browser account.

Telegram account linking is separate from seller enquiry opt-in. A linked shopper does not automatically become a merchant or receive merchant-only commands. Only an account with a shop profile can enable Telegram enquiries on its listings.

## Follow-up work\n\nThe first conversational slice answers natural-language questions and guides users to the correct secure workspace. The next slice can add explicitly allowlisted, server-validated shop-registration actions (using the existing `businessProfileSchema` and profile rules); do not allow the model to write to Prisma or bypass validation.

The Account UI includes the one-time code generation and copy flow. Disconnect/relink controls and product creation/editing/photo upload are later slices. Do not enable listing creation in Telegram by writing directly to Prisma; route it through the existing validated listing and photo-moderation services.
