# Buyer–seller chat

In-app direct messaging between a buyer and a seller, optionally anchored to
one listing. This is the first implemented slice of the messaging
infrastructure described in the agent resource pack brief (`0001mudaala.txt`)
and the WhatsApp system-design reference diagram — scoped deliberately per
that brief's own advice: *reuse existing infrastructure, avoid premature
services*. What ships is two tables, four polling endpoints, and one view.

## What is implemented

| Capability | How |
| --- | --- |
| Start a chat | "Message {shop}" button on any ad (buyer must be signed in; guests get the sign-in dialog) |
| Conversation identity | One conversation per (buyer, seller, listing); tapping twice reopens the same thread |
| General shop chats | `listingId` is optional — a shop-level thread when no ad is attached |
| Send / receive | Text messages, up to 2000 characters |
| Delivery states | `sent → delivered → read` as server timestamps (WhatsApp ticks: ✓ sent, ✓✓ delivered, blue ✓✓ read) |
| Unread counts | Per-conversation badges in the inbox + a total badge in the header/nav (polls every 15 s) |
| Notifications | A bell notification per message with a deep link into the thread |
| Seller inbox | The same inbox shows both roles — "Buyer inquiry" chips mark conversations where you are the seller |
| Access control | Only the two participants can read or write a conversation (enforced on every route) |
| Rate limits | 20 new conversations/hour/user, 60 messages/minute/user (shared `hit()` limiter) |

## Delivery-state semantics (the important honesty rule)

- **sent** — the message row exists.
- **delivered** — the OTHER participant's client fetched the thread (their
  poll grants the receipt; a sender never claims delivery itself).
- **read** — the OTHER participant had the thread open.

These are in-app receipts only. They say the message reached the other
logged-in session — nothing about offline devices, push, or WhatsApp.

## Transport: polling, not sockets (deliberate)

The thread refetches every 3 s while open; the inbox every 10 s; nav badges
every 15 s. Reasons:

1. The whole product deploys to Cloudflare Workers + Hyperdrive today;
   WebSockets there mean Durable Objects — new infrastructure, new billing,
   new failure modes. The brief says don't.
2. Polling behaves identically in dev, standalone Node, and Workers, so the
   sandbox preview exercises the real production path.
3. At Mudaala's current scale (thousands of trades, not billions of
   messages), 3-second polling of a ≤200-message thread is a one-indexed
   query per participant — `ChatMessage(conversationId, sentAt)`.

When scale demands it, the API shapes here are the contract; swapping the
transport for SSE/Durable Objects changes nothing above the endpoints.

## Data model (Prisma)

- `Conversation` — buyer, seller, optional listing, denormalized
  `lastMessageAt`/`lastMessagePreview` so the inbox renders from one query.
  Indexes: `(buyerId, lastMessageAt)`, `(sellerId, lastMessageAt)`.
- `ChatMessage` — body, `sentAt`, `deliveredAt?`, `readAt?`.
  Indexes: `(conversationId, sentAt)`, `(conversationId, senderId, readAt)`.

Both cascade on user deletion, so the seed-data cleanup path
(`scripts/remove-seed-data.ts`) needs no changes. The migration is
`20261114120000_buyer_seller_chat`.

## API surface

| Method & path | Purpose |
| --- | --- |
| `POST /api/chat/conversations` | Get-or-create `{ sellerId, listingId? }`; validates the listing belongs to the seller |
| `GET /api/chat/conversations` | Inbox (both roles), newest first, with unread counts |
| `GET /api/chat/conversations/[id]` | Full thread; grants delivered+read receipts for incoming messages |
| `POST /api/chat/conversations/[id]/messages` | Send; updates the conversation preview; best-effort bell notification |
| `GET /api/chat/conversations/[id]/messages?after=<ISO>` | Poll cursor for new messages; grants receipts |
| `GET /api/chat/unread-count` | Total unread for nav badges |

## Deploying to production (after merge)

1. CI's `tsc --noEmit` and build must pass (the code is Workers-runnable:
   no Node-only APIs added).
2. Apply the schema once against production: `npx prisma migrate deploy`
   with the production `DIRECT_URL` (adds two tables; no existing table is
   touched).
3. Nothing else: no env vars, no cron, no new services. (Sandbox previews of
   a standalone build additionally need `RATE_LIMIT_ALLOW_MEMORY=1` — see
   `docs/sandbox-preview.md`; the production Worker is unaffected.)

## Explicitly deferred (per the brief's roadmap)

- Media/attachments, voice notes
- E2E encryption (the reference diagram's green path)
- Offline queueing and multi-device fan-out (message state machine is ready
  for `pending/failed` extensions)
- Push delivery of chat messages (bell notifications exist; web-push for
  chat can reuse `PushSubscription`)
- Group chats, WhatsApp Business API bridge
