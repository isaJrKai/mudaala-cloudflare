// POST /api/chat/conversations - start (or reopen) a chat with a seller.
// GET  /api/chat/conversations - the signed-in inbox: both roles, newest
// first, with unread counts. One query renders the whole list.
//
// Idempotent on purpose: messaging a seller about the same ad twice reopens
// the same conversation instead of spawning duplicates.

import { NextResponse } from 'next/server'
import { route, jsonOk, parseBody, ApiError, requireUser } from '@/lib/api'
import { chatConversationCreateSchema } from '@/lib/validation'
import { hit } from '@/lib/rate-limit'
import { db } from '@/lib/db'
import { conversationInclude, serializeConversation, conversationUnreadWhere } from '@/lib/chat'

// Starting conversations is free-form buyer behaviour, but not unbounded:
// a stray script should not be able to open thousands of chat threads.
const START_MAX_PER_HOUR = 20

export async function POST(request: Request) {
  return route(async () => {
    const user = await requireUser()
    const data = await parseBody(request, chatConversationCreateSchema)

    if (data.sellerId === user.id) {
      throw new ApiError(400, 'You cannot start a chat with your own account')
    }

    const startVerdict = await hit(`chat:start:${user.id}`, START_MAX_PER_HOUR, 60 * 60 * 1000)
    if (!startVerdict.ok) {
      return NextResponse.json(
        { error: 'You have started several chats recently. Please try again later.' },
        { status: 429, headers: { 'retry-after': String(startVerdict.retryAfterSeconds) } },
      )
    }

    const seller = await db.user.findUnique({ where: { id: data.sellerId }, select: { id: true } })
    if (!seller) throw new ApiError(404, 'That seller account no longer exists')

    // The listing is context for the conversation, so it must belong to the
    // seller being messaged - otherwise the thread header would lie.
    if (data.listingId) {
      const listing = await db.listing.findUnique({
        where: { id: data.listingId },
        select: { id: true, userId: true },
      })
      if (!listing || listing.userId !== data.sellerId) {
        throw new ApiError(400, 'That listing does not belong to this seller')
      }
    }

    const match = {
      buyerId: user.id,
      sellerId: data.sellerId,
      listingId: data.listingId ?? null,
    }
    const existing = await db.conversation.findFirst({ where: match, include: conversationInclude })
    if (existing) {
      return jsonOk({ conversation: serializeConversation(existing, user.id) })
    }

    const created = await db.conversation.create({
      data: match,
      include: conversationInclude,
    })
    return jsonOk({ conversation: serializeConversation(created, user.id) }, 201)
  })
}

export async function GET() {
  return route(async () => {
    const user = await requireUser()
    const conversations = await db.conversation.findMany({
      where: { OR: [{ buyerId: user.id }, { sellerId: user.id }] },
      orderBy: { lastMessageAt: 'desc' },
      take: 100,
      include: conversationInclude,
    })
    const ids = conversations.map((conversation) => conversation.id)
    const unreadGroups = await db.chatMessage.groupBy({
      by: ['conversationId'],
      where: { ...conversationUnreadWhere(user.id), conversationId: { in: ids } },
      _count: { _all: true },
    })
    const unreadByConversation = new Map(unreadGroups.map((group) => [group.conversationId, group._count._all]))
    return jsonOk({
      conversations: conversations.map((conversation) =>
        serializeConversation(conversation, user.id, unreadByConversation.get(conversation.id) ?? 0),
      ),
    })
  })
}
