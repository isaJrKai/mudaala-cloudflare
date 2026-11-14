// Mudaala - buyer-seller chat server helpers.
// Shared by the chat API routes: participant authorization, delivery/read
// receipts, and the serialized shapes the client mirrors in src/lib/client.ts.
//
// Transport is polling, not sockets - the whole product runs on Cloudflare
// Workers today, and polling needs no new infrastructure anywhere it deploys
// (dev, standalone Node, Workers + Hyperdrive). Delivery semantics:
//   sent      - the row exists
//   delivered - the OTHER participant's client fetched the thread
//   read      - the OTHER participant had the thread open
// (In-app receipts only; offline push fan-out is future work, see docs.)

import { ApiError } from './api'
import { db } from './db'
import type { ChatMessage, Conversation, Prisma } from '@prisma/client'

// The only party fields the inbox/thread ever render. No phone numbers:
// chat replaces the "call this stranger" leap with a message first.
const partySelect = {
  id: true,
  name: true,
  profile: { select: { businessName: true, photoUrl: true } },
} satisfies Prisma.UserSelect

export const conversationInclude = {
  buyer: { select: partySelect },
  seller: { select: partySelect },
  listing: { select: { id: true, title: true } },
} satisfies Prisma.ConversationInclude

export type ConversationWithParties = Prisma.ConversationGetPayload<{ include: typeof conversationInclude }>

export function serializeMessage(message: ChatMessage, viewerId: string) {
  return {
    id: message.id,
    conversationId: message.conversationId,
    senderId: message.senderId,
    body: message.body,
    sentAt: message.sentAt.toISOString(),
    deliveredAt: message.deliveredAt?.toISOString() ?? null,
    readAt: message.readAt?.toISOString() ?? null,
    // Server-derived so the UI never trusts a client-side comparison.
    mine: message.senderId === viewerId,
  }
}

export type SerializedChatMessage = ReturnType<typeof serializeMessage>

export function serializeConversation(conversation: ConversationWithParties, viewerId: string, unreadCount = 0) {
  const role: 'buyer' | 'seller' = conversation.buyerId === viewerId ? 'buyer' : 'seller'
  const other = role === 'buyer' ? conversation.seller : conversation.buyer
  return {
    id: conversation.id,
    role,
    other: {
      id: other.id,
      name: other.name,
      // Same display rule as the listing page: named shop wins over account name.
      shopName: other.profile?.businessName?.trim() || other.name,
      photoUrl: other.profile?.photoUrl ?? null,
    },
    listing: conversation.listing ? { id: conversation.listing.id, title: conversation.listing.title } : null,
    lastMessagePreview: conversation.lastMessagePreview,
    lastMessageAt: conversation.lastMessageAt.toISOString(),
    unreadCount,
  }
}

// Every chat route funnels through here: 404 when it does not exist, 403 for
// anyone who is not the buyer or the seller. No exceptions.
export async function getConversationForParticipant(conversationId: string, userId: string): Promise<ConversationWithParties> {
  const conversation = await db.conversation.findUnique({
    where: { id: conversationId },
    include: conversationInclude,
  })
  if (!conversation) throw new ApiError(404, 'Conversation not found')
  if (conversation.buyerId !== userId && conversation.sellerId !== userId) {
    throw new ApiError(403, 'This conversation is private')
  }
  return conversation
}

// Read implies delivered: opening the thread is the strongest receipt, so
// both timestamps land together. The other participant's poll is what flips
// MY sent messages to delivered/read - receipts are always granted by the
// receiving side, never claimed by the sender.
export async function markIncomingMessages(conversationId: string, recipientId: string, level: 'delivered' | 'read'): Promise<void> {
  const now = new Date()
  if (level === 'delivered') {
    await db.chatMessage.updateMany({
      where: { conversationId, senderId: { not: recipientId }, deliveredAt: null },
      data: { deliveredAt: now },
    })
    return
  }
  await db.chatMessage.updateMany({
    where: { conversationId, senderId: { not: recipientId }, deliveredAt: null },
    data: { deliveredAt: now },
  })
  await db.chatMessage.updateMany({
    where: { conversationId, senderId: { not: recipientId }, readAt: null },
    data: { readAt: now },
  })
}

export function conversationUnreadWhere(viewerId: string): Prisma.ChatMessageWhereInput {
  return {
    conversation: { OR: [{ buyerId: viewerId }, { sellerId: viewerId }] },
    senderId: { not: viewerId },
    readAt: null,
  }
}
