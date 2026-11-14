// GET /api/chat/conversations/[id] - the full thread, oldest first.
// Opening (or polling) the thread IS the read receipt: incoming messages
// flip to delivered+read on the way out, so the sender's ticks move the
// moment the other side is actually looking.

import { route, jsonOk, requireUser } from '@/lib/api'
import { db } from '@/lib/db'
import { getConversationForParticipant, serializeConversation, serializeMessage, markIncomingMessages } from '@/lib/chat'

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return route(async () => {
    const user = await requireUser()
    const { id } = await params

    const conversation = await getConversationForParticipant(id, user.id)
    await markIncomingMessages(id, user.id, 'read')
    const messages = await db.chatMessage.findMany({
      where: { conversationId: id },
      orderBy: { sentAt: 'asc' },
      take: 200,
    })

    return jsonOk({
      conversation: serializeConversation(conversation, user.id),
      messages: messages.map((message) => serializeMessage(message, user.id)),
    })
  })
}
