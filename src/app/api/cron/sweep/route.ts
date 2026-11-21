// Maintenance sweep endpoint - runs the real expiry + expiring-soon processes.
// In production this is called by a scheduler (cron / Supabase pg_cron) that
// presents the shared secret: header x-cron-secret must match CRON_SECRET.
// It is idempotent, so calling it repeatedly is safe. Fails closed: if
// CRON_SECRET is not configured the endpoint refuses to run rather than being
// world-open. (Expiry inside the app does not depend on this endpoint -
// public reads run the same sweep.)

import { createHash, timingSafeEqual } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { headers } from 'next/headers'
import { route, jsonOk, jsonError } from '@/lib/api'
import { expireOverdueListings, notifyExpiringSoon } from '@/lib/listings'
import { recordPriceSnapshots } from '@/lib/price-trends'

function secretMatches(presented: string | null, configured: string | undefined): boolean {
  if (!configured || !presented) return false
  // Hash both sides so length differences cannot leak via timing.
  const a = createHash('sha256').update(presented).digest()
  const b = createHash('sha256').update(configured).digest()
  return timingSafeEqual(a, b)
}

export async function POST() {
  return route(async () => {
    const hdrs = await headers()
    const presented = hdrs.get('x-cron-secret')
    const configured = process.env.CRON_SECRET

    if (!configured) {
      return jsonError(503, 'Sweep endpoint is not configured. Set CRON_SECRET to enable scheduled sweeps')
    }
    if (!secretMatches(presented, configured)) {
      return jsonError(403, 'Invalid cron secret')
    }

    const commerceExpiry = await db.$transaction(async (tx) => {
      // UPDATE ... RETURNING is atomic and races safely with seller acceptance:
      // the order row lock in /api/orders/[id] serializes both transitions.
      const expiredOrders = await tx.$queryRaw<Array<{ id: string; buyerId: string | null; sellerId: string; orderNumber: string }>>(Prisma.sql`
        UPDATE "CommerceOrder"
        SET "status" = 'EXPIRED', "updatedAt" = NOW()
        WHERE "status" = 'PENDING_SELLER' AND "expiresAt" IS NOT NULL AND "expiresAt" <= NOW()
        RETURNING "id", "buyerId", "sellerId", "orderNumber"
      `)
      const ids = expiredOrders.map((order) => order.id)
      if (ids.length) {
        await tx.stockReservation.updateMany({
          where: { orderId: { in: ids }, status: 'HELD' },
          data: { status: 'EXPIRED', releasedAt: new Date() },
        })
        for (const order of expiredOrders) {
          if (!order.buyerId) continue
          await tx.notification.create({
            data: {
              userId: order.buyerId,
              type: 'ORDER_EXPIRED',
              category: 'SYSTEM',
              priority: 'NORMAL',
              title: 'Order reservation expired',
              body: 'Order ' + order.orderNumber + ' was not confirmed in time. Any held stock is available again.',
              actionUrl: '/#/orders',
              actionLabel: 'View orders',
              dedupeKey: 'order-expired:' + order.id,
            },
          })
        }
      }
      return expiredOrders.length
    })

    const expired = await expireOverdueListings()
    const expiring = await notifyExpiringSoon()
    // Daily price medians - same sweep, derived honestly from ACTIVE listings.
    const priceSnapshots = await recordPriceSnapshots()
    return jsonOk({ expired, commerceOrdersExpired: commerceExpiry, expiringNotified: expiring, priceSnapshots })
  })
}
