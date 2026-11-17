# Merchant Knowledge Base

Deterministic FAQ layer for the Telegram Merchant Assistant. Known questions are answered with **no AI call**. Lives in `src/lib/merchant-kb/`. It does not touch the webhook route, the listing publisher or the schema.

## Use from the router
```ts
import { merchantKb, renderReply } from '@/lib/merchant-kb'
const out = renderReply(merchantKb().match(text)) // { text, action?, useAI }
// useAI -> existing Groq fallback; action -> { kind: 'command' | 'miniapp' | 'workflow', value }
```
Results: `answer`, `unsupported` (not live yet; never stated as fact), `ambiguous` (ask "did you mean"), `no_match` (AI fallback).

## Status rules
`live` and `partial` are served (partial appends its `statusNote`). `unverified` and `planned` are never served. Every entry cites its source. A test asserts every `command` action exists in the real webhook route.

## Test
`bun run test:merchant-kb`

## Gaps that need backend work or owner confirmation
- `registration.resume` (unverified): Confirm Mini App saves an unfinished profile; resumable in-chat onboarding is not built
- `shop.change-name` (partial): In-chat profile edit with confirmation
- `shop.change-contact` (partial): In-chat contact edit with confirmation
- `shop.change-location-hours` (partial): In-chat location/hours edit
- `shop.change-photo` (partial): In-chat image change with moderation
- `products.post` (partial): PR #288 merged + verified (photo-to-product in chat)
- `products.change-price` (partial): In-chat edit via existing validated listing service + confirmation
- `products.soldout` (partial): In-chat availability update + confirmation
- `photos.rejected` (partial): Surface exact rejection reason in Telegram
- `pricing.momo` (partial): verify against source
- `pricing.negotiable` (unverified): Confirm whether negotiable/discount fields exist
- `pricing.fees` (unverified): Confirmed pricing policy from owner. Never guess.
- `discovery.not-appearing` (partial): verify against source
- `analytics.summary` (partial): In-chat analytics retrieval from business-analytics API (real figures only)
- `analytics.top-product` (partial): In-chat per-product analytics
- `analytics.contacts` (partial): In-chat contact analytics
- `sales.record` (partial): In-chat sale recording via business-records with confirmation
- `sales.export` (partial): Confirm export UI path and format
- `stock.update` (partial): In-chat stock update with confirmation
- `sales.expense` (unverified): Confirm expense records exist in business-records
- `growth.reminders` (partial): Growth Coach delivery to Telegram
