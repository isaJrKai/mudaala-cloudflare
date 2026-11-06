import { ApiError, jsonOk, requireUser, route } from '@/lib/api'
import { db } from '@/lib/db'

type Params = { params: Promise<{ id: string }> }

const snoozeMinutes = new Set([15, 30, 60, 1440])

export async function PATCH(request: Request, { params }: Params) {
  return route(async () => {
    const user = await requireUser('Sign in to manage your notifications')
    const { id } = await params
    const notification = await db.notification.findFirst({
      where: { id, userId: user.id },
      select: { id: true, archivedAt: true, dismissedAt: true, completedAt: true },
    })
    if (!notification) throw new ApiError(404, 'Notification not found')

    const body: unknown = await request.json().catch(() => {
      throw new ApiError(400, 'Request body must be valid JSON')
    })
    if (typeof body !== 'object' || body === null || !('action' in body) || typeof body.action !== 'string') {
      throw new ApiError(400, 'Choose a notification action')
    }

    const now = new Date()
    let data: {
      read?: boolean
      archivedAt?: Date | null
      dismissedAt?: Date | null
      completedAt?: Date | null
      snoozedUntil?: Date | null
    }

    switch (body.action) {
      case 'snooze': {
        if (!('minutes' in body) || typeof body.minutes !== 'number' || !snoozeMinutes.has(body.minutes)) {
          throw new ApiError(400, 'Choose 15, 30, 60, or 1440 minutes')
        }
        data = { read: true, snoozedUntil: new Date(now.getTime() + body.minutes * 60_000) }
        break
      }
      case 'archive':
        data = { read: true, archivedAt: now, snoozedUntil: null }
        break
      case 'restore':
        data = { archivedAt: null, dismissedAt: null, read: false }
        break
      case 'dismiss':
        data = { read: true, dismissedAt: now, snoozedUntil: null }
        break
      case 'complete':
        data = { read: true, completedAt: now, snoozedUntil: null }
        break
      default:
        throw new ApiError(400, 'Unsupported notification action')
    }

    const updated = await db.notification.updateMany({
      where: { id, userId: user.id },
      data,
    })
    if (updated.count !== 1) throw new ApiError(404, 'Notification not found')
    return jsonOk({ ok: true })
  })
}
