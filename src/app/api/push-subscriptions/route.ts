import { z } from 'zod'
import { ApiError, jsonOk, requireUser, route } from '@/lib/api'
import { db } from '@/lib/db'

const subscriptionSchema = z.object({
  endpoint: z.string().url().max(2048).refine((value) => {
    const url = new URL(value)
    if (url.protocol !== 'https:') return false
    const host = url.hostname.toLowerCase()
    return host === 'fcm.googleapis.com'
      || host === 'android.googleapis.com'
      || host === 'updates.push.services.mozilla.com'
      || host === 'push.services.mozilla.com'
      || host.endsWith('.push.services.mozilla.com')
      || host === 'web.push.apple.com'
      || host.endsWith('.push.apple.com')
      || host === 'notify.windows.com'
      || host.endsWith('.notify.windows.com')
  }, 'Unsupported browser push service'),
  keys: z.object({
    p256dh: z.string().min(80).max(100),
    auth: z.string().min(16).max(32),
  }),
  expirationTime: z.number().int().positive().nullable().optional(),
})

export async function GET() {
  return route(async () => {
    await requireUser('Sign in to enable device notifications')
    const publicKey = process.env.VAPID_PUBLIC_KEY
    if (!publicKey) throw new ApiError(503, 'Device notifications are not configured yet')
    return jsonOk({ publicKey })
  })
}

export async function POST(request: Request) {
  return route(async () => {
    const user = await requireUser('Sign in to enable device notifications')
    const body = await request.json().catch(() => {
      throw new ApiError(400, 'Send a valid push subscription')
    })
    const parsed = subscriptionSchema.safeParse(body)
    if (!parsed.success) throw new ApiError(400, 'Invalid browser push subscription')
    const { endpoint, keys, expirationTime } = parsed.data
    const subscription = await db.pushSubscription.upsert({
      where: { endpoint },
      create: {
        userId: user.id,
        endpoint,
        p256dh: keys.p256dh,
        auth: keys.auth,
        expirationTime: expirationTime ? new Date(expirationTime) : null,
        userAgent: request.headers.get('user-agent')?.slice(0, 240) ?? null,
      },
      update: {
        userId: user.id,
        p256dh: keys.p256dh,
        auth: keys.auth,
        expirationTime: expirationTime ? new Date(expirationTime) : null,
        userAgent: request.headers.get('user-agent')?.slice(0, 240) ?? null,
      },
      select: { id: true },
    })
    return jsonOk({ subscribed: true, subscriptionId: subscription.id }, 201)
  })
}

export async function DELETE(request: Request) {
  return route(async () => {
    const user = await requireUser('Sign in to manage device notifications')
    const body = await request.json().catch(() => {
      throw new ApiError(400, 'Send a valid push subscription')
    })
    if (typeof body !== 'object' || body === null || !('endpoint' in body) || typeof body.endpoint !== 'string') {
      throw new ApiError(400, 'Subscription endpoint is required')
    }
    const deleted = await db.pushSubscription.deleteMany({
      where: { userId: user.id, endpoint: body.endpoint },
    })
    return jsonOk({ unsubscribed: deleted.count > 0 })
  })
}
