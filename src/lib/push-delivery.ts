import { db } from '@/lib/db'
import { sendWebPush, type PushPayload } from '@/lib/web-push'

type NotificationForPush = {
  id: string
  title: string
  body: string
  actionUrl: string | null
  actionLabel: string | null
  priority: string
}

export async function deliverPushNotification(userId: string, notification: NotificationForPush): Promise<void> {
  const subscriptions = await db.pushSubscription.findMany({
    where: { userId },
    select: { id: true, userId: true, endpoint: true, p256dh: true, auth: true },
  })
  if (subscriptions.length === 0) return

  const payload: PushPayload = {
    title: notification.title,
    body: notification.body,
    url: notification.actionUrl?.startsWith('/#/') ? notification.actionUrl : '/#/notifications',
    notificationId: notification.id,
    actionLabel: notification.actionLabel || 'Open Mudaala',
    priority: notification.priority === 'HIGH' ? 'HIGH' : 'NORMAL',
  }

  await Promise.all(subscriptions.map(async (subscription) => {
    try {
      const result = await sendWebPush(subscription, payload)
      if ('skipped' in result) return
      if (result.status === 404 || result.status === 410) {
        await db.pushSubscription.deleteMany({ where: { id: subscription.id, userId } })
        return
      }
      if (!result.ok) {
        console.warn('[growth-coach] push provider rejected delivery', { status: result.status })
      }
    } catch (error) {
      console.warn('[growth-coach] push delivery failed', error instanceof Error ? error.message : 'unknown error')
    }
  }))
}
