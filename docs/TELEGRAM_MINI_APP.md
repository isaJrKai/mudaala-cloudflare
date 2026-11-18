# Mudaala Merchant inside Telegram

## Product intent

Telegram is the seller's operating surface, not a miniature customer marketplace. The Mini App is a merchant workspace for operating an existing Mudaala shop. Public shop discovery and customer-facing browsing remain on the Mudaala website.

The bot is the entry point and notification/conversation channel. The Mini App is the shop environment. Both use the same Mudaala account, shop profile, listing catalogue, storage, analytics, permissions and APIs. There is no second inventory or merchant database.

## Entry and onboarding

- Production Mini App URL: https://mudaala.store/telegram
- Bot: https://t.me/MudaalaMerchantbot
- The bot's /start, /help, /shop, and linked /products responses provide an **Open My Shop** Telegram Web App keyboard button.
- /shop opens the seller workspace. /publicshop is the explicit command for the public customer-facing shop link.

A new merchant can create an account in the Mini App using the existing POST /api/auth/register flow, including the existing Ugandan phone validation, password rules, age/Terms/Privacy confirmation and session creation. The Mini App then links the authenticated Mudaala account to the Telegram identity through POST /api/telegram/mini-app/link, and creates the shop profile through the existing PUT /api/profile route. A merchant with an existing account can sign in inside Telegram through POST /api/auth/login and link the same way.

The Mini App does not invent or duplicate a registration, merchant or shop data model. The profile endpoint generates the canonical MU-CODE and records the existing shop-created event and welcome notification.

## Authentication and account linking

The Telegram Web App SDK supplies raw initData. Both Mini App endpoints validate Telegram's HMAC signature with TELEGRAM_BOT_TOKEN, enforce a ten-minute freshness window, and derive the Telegram user ID only from the signed payload.

- POST /api/telegram/mini-app/session resolves an existing hashed Telegram-to-Mudaala account mapping and creates the existing HttpOnly Mudaala session.
- POST /api/telegram/mini-app/link requires an authenticated Mudaala session, rejects a Telegram identity already mapped to a different Mudaala account, and stores the hashed mapping.
- Neither endpoint returns the bot token or a reusable session credential to browser JavaScript.
- Registration and login remain subject to the existing rate limits, phone normalization, password checks and account rules.
- The Telegram account mapping is not treated as proof of phone ownership or legal business verification.

## Merchant workspace

The Mini App provides four seller-focused areas:

- **Home:** shop identity, MU-CODE, active listing count, recorded views, customer contact taps, shop visits, recent listings and common merchant actions.
- **Products:** the merchant's own catalogue, listing status, recorded views, price and edit/add actions. Existing Mudaala publishing and editing flows remain the write boundary.
- **Insights:** existing business analytics, including recorded listing/shop views, call and WhatsApp taps, shares, top listings and seller-recorded sales. Labels explicitly distinguish taps/views from confirmed calls, messages, unique reach or payment-verified sales.
- **My shop:** existing business profile details, edit route and public shop link sharing. Customer browsing is not embedded as a buyer marketplace.

Product create/edit actions open existing Mudaala routes in the same Telegram webview. This preserves the established validation, prohibited-item moderation, upload quarantine, storage, listing lifecycle and ownership rules. It is intentionally not a parallel product editor or direct database-write path.

## Brand and product rules

- Use the approved Mudaala market-stall M mark and official logo lockups. Do not use the retired leaf mark or add a black circular backing.
- Keep the established forest-green, mango/marigold, warm-paper and ink palette.
- Prioritise real seller tasks and real account data.
- No fabricated products, metrics, customer activity, trust claims or testimonials.
- No generic AI dashboard styling, gradients, glassmorphism, gratuitous 3D or decorative clutter.
- Public shop links are sharing destinations only; merchant management remains private and authenticated.
- The workspace must remain usable on small Android screens and slower connections.

## BotFather configuration

After the code is merged and the production deployment is verified:

1. Open BotFather → /mybots → @MudaalaMerchantbot.
2. Configure the Mini App URL as https://mudaala.store/telegram.
3. Configure the bot menu button as **My Shop** with the same URL if it is not already set.
4. Keep inline mode and Telegram Business mode disabled; neither is required for this merchant workspace.

The bot's reply-keyboard Web App button also provides an in-chat entry point and does not depend on the BotFather menu button.

## Verification gates

- Test a new Telegram identity: register, link, create shop profile and receive a MU-CODE.
- Test an existing unlinked account: sign in inside Telegram and link.
- Test an already-linked merchant: Mini App opens the correct shop and catalogue.
- Test that a Telegram identity already linked to another Mudaala account cannot be rebound.
- Test one merchant cannot access another merchant's listings, profile or analytics.
- Test product create/edit routes remain in Telegram's webview and preserve existing API validation.
- Test upload, photo quarantine/moderation and public retrieval through the existing production workflow.
- Test no initData or stale/invalid initData cannot create a session or link.
- Test small Android viewport, safe-area insets, keyboard behavior and slow network states.
- Test the actual Mini App from Telegram mobile after BotFather configuration. A successful CI/deploy run alone does not prove the Telegram client experience.
