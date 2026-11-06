import { z } from 'zod'
import { ApiError, jsonOk, requireUser, route } from '@/lib/api'
import { db } from '@/lib/db'

const eventSchema = z.object({
  eventType: z.enum([
    'SHOP_CREATED',
    'PRODUCT_CREATED',
    'PRODUCT_PHOTO_ADDED',
    'POSTER_GENERATED',
    'POSTER_SHARED',
    'POSTER_SHARE_INITIATED',
    'SHOP_OPENED',
    'RECOMMENDATION_COMPLETED',
  ]),
  entityId: z.string().trim().min(1).max(128).optional(),
  idempotencyKey: z.string().trim().min(8).max(128).optional(),
  metadata: z.record(z.string(), z.union([z.string().max(240), z.number(), z.boolean()])).optional(),
})

export async function POST(request: Request) {
  return route(async () => {
    const user = await requireUser('Sign in to record shop activity')
    let input: unknown
    try {
      input = await request.json()
    } catch {
      throw new ApiError(400, 'Send a valid JSON event')
    }
    const parsed = eventSchema.safeParse(input)
    if (!parsed.success) throw new ApiError(400, 'Invalid merchant activity event')

    const { eventType, entityId, idempotencyKey, metadata } = parsed.data
    if (idempotencyKey) {
      const existing = await db.merchantGrowthEvent.findUnique({
        where: { userId_idempotencyKey: { userId: user.id, idempotencyKey } },
      })
      if (existing) return jsonOk({ event: existing, duplicate: true })
    }

    const event = await db.merchantGrowthEvent.create({
      data: { userId: user.id, eventType, entityId, idempotencyKey, metadata },
    }).catch(async (error: unknown) => {
      // Concurrent retries can race after the preflight read. Resolve only the
      // caller's own idempotency key; all other database errors still surface.
      if (idempotencyKey) {
        const existing = await db.merchantGrowthEvent.findUnique({
          where: { userId_idempotencyKey: { userId: user.id, idempotencyKey } },
        })
        if (existing) return existing
      }
      throw error
    })

    return jsonOk({ event, duplicate: false }, 201)
  })
}
