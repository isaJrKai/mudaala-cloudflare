// GET /api/chat/unread-count - the number of unread chat messages for the
// signed-in user, summed across conversations. Feeds the nav badge only;
// the inbox computes its own per-conversation counts.

import { route, jsonOk, requireUser } from '@/lib/api'
import { db } from '@/lib/db'
import { conversationUnreadWhere } from '@/lib/chat'

export async function GET() {
  return route(async () => {
    const user = await requireUser()
    const groups = await db.chatMessage.groupBy({
      by: ['conversationId'],
      where: conversationUnreadWhere(user.id),
      _count: { _all: true },
    })
    const unreadCount = groups.reduce((total, group) => total + group._count._all, 0)
    return jsonOk({ unreadCount })
  })
}
