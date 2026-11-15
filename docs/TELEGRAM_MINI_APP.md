# Telegram Merchant Mini App

## Entry point

- Production URL: `https://mudaala.store/telegram`
- Telegram bot: [@MudaalaMerchantbot](https://t.me/MudaalaMerchantbot)
- The Mini App is served by the existing Next.js application and uses the existing Mudaala session, shop profile, listings and business analytics APIs. It does not create a second merchant or inventory database.

## Authentication

Telegram's Web App SDK supplies the raw `initData` string. The browser posts it to `POST /api/telegram/mini-app/session`. The server:

1. Validates Telegram's HMAC signature using the `TELEGRAM_BOT_TOKEN` Worker secret.
2. Rejects launch data older than ten minutes or dated materially in the future.
3. Resolves the Telegram user through the existing hashed Telegram-to-Mudaala account mapping.
4. Creates a normal Mudaala server-side session and sets the existing HttpOnly session cookie.
5. Returns no Telegram bot token or reusable session credential to browser JavaScript.

Only a Telegram account already linked through the one-time `/link CODE` flow can open the merchant workspace. The endpoint is rate-limited and responses are not cacheable.

## First Mini App slice

The current workspace provides:
- Shop identity, location and shop code.
- Active product count and recorded listing views.
- Recent products and catalogue access.
- Shortcuts to existing product creation, catalogue, business insights and account screens.
- Public shop link.

The existing Mudaala APIs remain the source of truth. Product creation, editing and deletion continue through the existing validated application flows. This Mini App shell does not introduce direct database writes or bypass moderation.

## BotFather configuration

After the branch is merged and the production deployment succeeds:

1. Open BotFather → `/mybots` → `@MudaalaMerchantbot`.
2. Open **Bot Settings → Configure Mini App**.
3. Set the Mini App URL to `https://mudaala.store/telegram`.
4. Save it.
5. Set the Menu Button URL to the same address and its title to **My Shop** if configuring the menu button separately.

Do not configure BotFather to point at the new route until the route is deployed and the live endpoint has been checked.

## Verification checklist

- Open the Mini App from the bot's menu button on Telegram mobile.
- Confirm linked merchant sees their own shop and listings.
- Confirm unlinked Telegram account receives a clear link-first message.
- Confirm opening `https://mudaala.store/telegram` in a normal browser does not authenticate without Telegram-signed launch data.
- Confirm one merchant cannot access another merchant's listings or analytics.
- Test at narrow mobile viewport and Telegram's in-app webview.
