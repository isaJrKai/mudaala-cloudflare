// POST /api/chat/conversations/[id]/messages - send a message (participants only).
// GET  /api/chat/conversations/[id]/messages?after=<ISO timestamp> - poll for
// messages sent after the cursor. The poll is the delivery receipt: when the
// recipient polls, their incoming messages flip to delivered (and read - an
// open thread is a read thread).

import { NextResponse } from 'next/server'
import { route, jsonOk, parseBody, ApiError, requireUser } from '@/lib/api'
import { chatMessageCreateSchema } from '@/lib/validation'
import { hit } from '@/lib/rate-limit'
import { db } from '@/lib/db'
import { getConversationForParticipant, serializeMessage, markIncomingMessages } from '@/lib/chat'

// 60 messages a minute is far above any real conversation and far below
// what a runaway script would want.
const SEND_MAX_PER_MINUTE = 60
const PREVIEW_LENGTH = 120

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return route(async () => {
    const user = await requireUser()
    const { id } = await params
    const data = await parseBody(request, chatMessageCreateSchema)

    const conversation = await getConversationForParticipant(id, user.id)

    const sendVerdict = await hit(`chat:send:${user.id}`, SEND_MAX_PER_MINUTE, 60 * 1000)
    if (!sendVerdict.ok) {
      return NextResponse.json(
        { error: 'You are sending messages too quickly. Please slow down a little.' },
        { status: 429, headers: { 'retry-after': String(sendVerdict.retryAfterSeconds) } },
      )
    }

    const body = data.body
    const result = await db.$transaction(async (tx) => {
      const message = await tx.chatMessage.create({
        data: { conversationId: id, senderId: user.id, body },
      })
      await tx.conversation.update({
        where: { id },
        data: { lastMessageAt: message.sentAt, lastMessagePreview: body.slice(0, PREVIEW_LENGTH) },
      })
      return message
    })

    // Best-effort bell notification for the other party. The message row is
    // the source of truth; a notification hiccup must never fail the send.
    const otherId = conversation.buyerId === user.id ? conversation.sellerId : conversation.buyerId
    try {
      await db.notification.create({
        data: {
          userId: otherId,
          type: 'CHAT_MESSAGE',
          category: 'SOCIAL',
          title: `${conversation.buyerId === user.id ? conversation.buyer.profile?.businessName?.trim() || conversation.buyer.name : conversation.seller.profile?.businessName?.trim() || conversation.seller.name} sent you a message`,
          body: body.slice(0, PREVIEW_LENGTH),
          actionUrl: `#/messages/${id}`,
          actionLabel: 'Open chat',
          dedupeKey: `chat-message-${result.id}`,
        },
      })
    } catch {
      // The inbox itself still shows the unread state; skip silently.
    }

    return jsonOk({ message: serializeMessage(result, user.id) }, 201)
  })
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return route(async () => {
    const user = await requireUser()
    const { id } = await params

    await getConversationForParticipant(id, user.id)

    const afterRaw = new URL(request.url).searchParams.get('after')
    let after: Date | undefined
    if (afterRaw) {
      after = new Date(afterRaw)
      if (Number.isNaN(after.getTime())) throw new ApiError(400, 'The "after" cursor must be an ISO timestamp')
    }

    await markIncomingMessages(id, user.id, 'read')
    const messages = await db.chatMessage.findMany({
      where: { conversationId: id, ...(after ? { sentAt: { gt: after } } : {}) },
      orderBy: { sentAt: 'asc' },
      take: 200,
    })

    return jsonOk({
      messages: messages.map((message) => serializeMessage(message, user.id)),
      serverTime: new Date().toISOString(),
    })
  })
}
