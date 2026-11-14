# Telegram Merchant Assistant — first integration slice

## Scope

This opt-in channel reuses Mudaala's existing user, shop and listing records. It does not create a second inventory database or replace in-app chat, phone or WhatsApp contact.

Initial commands: `/start`, `/help`, `/link CODE`, `/shop` and `/products`. Product creation/editing and photo uploads are intentionally excluded until they can reuse the existing listing validation, prohibited-item checks, upload quarantine and image moderation pipeline.

## Secrets

Configure these as Cloudflare Worker Secrets, never vars or committed files: `TELEGRAM_BOT_TOKEN` and `TELEGRAM_WEBHOOK_SECRET`. The webhook secret must be 1–256 characters and use only letters, numbers, underscores or hyphens.

## Registration

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

The code is random, stored only as a SHA-256 digest, single-use and short-lived. Telegram user IDs are hashed before database keys are created. Only private chats are accepted.

## Follow-up work

The link-code API is ready for the Account UI integration. Disconnect/relink controls and product creation/editing/photo upload are later slices. Do not enable listing creation in Telegram by writing directly to Prisma; route it through the existing validated listing and photo-moderation services.
