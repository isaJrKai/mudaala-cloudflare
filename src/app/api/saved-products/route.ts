import { z } from 'zod'
import { ApiError, jsonOk, parseBody, requireUser, route } from '@/lib/api'
import { db } from '@/lib/db'
import { deliverPushNotification } from '@/lib/push-delivery'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  return route(async () => {
    const user = await requireUser()
    const saved = await db.savedProduct.findMany({
      where: { userId: user.id },
      include: {
        listing: {
          select: {
            id: true, title: true, price: true, currency: true, county: true,
            area: true, photos: true, status: true, expiresAt: true,
            user: { select: { profile: { select: { businessName: true } } } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 40,
    })
    return jsonOk({ products: saved.filter((item) => item.listing.status === 'ACTIVE' && item.listing.expiresAt > new Date()) })
  })
}

export async function POST(request: Request) {
  return route(async () => {
    const user = await requireUser()
    const body = await parseBody(request, z.object({ listingId: z.string().min(1).max(128) }))
    try {
      const notification = await db.$transaction(async (tx) => {
        const listing = await tx.listing.findFirst({
          where: { id: body.listingId, type: 'OFFER', status: 'ACTIVE', isSeed: false, expiresAt: { gt: new Date() } },
          select: { id: true, userId: true, title: true },
        })
        if (!listing) throw new ApiError(404, 'This product is no longer available to save.')
        const existing = await tx.savedProduct.findUnique({
          where: { userId_listingId: { userId: user.id, listingId: listing.id } },
          select: { id: true },
        })
        if (existing) return null
        const count = await tx.savedProduct.count({ where: { userId: user.id } })
        if (count >= 40) throw new ApiError(409, 'Your account shortlist is full. Remove a saved product before adding another.')
        await tx.savedProduct.create({ data: { userId: user.id, listingId: listing.id } })

        // Likes stay private: the seller learns that someone liked the product,
        // never who the buyer is or what else they have saved. One alert per
        // product per UTC day prevents a popular listing from spamming its shop.
        if (listing.userId === user.id) return null
        const day = new Date().toISOString().slice(0, 10)
        const dedupeKey = `social:product-liked:${listing.id}:${day}`
        const created = await tx.notification.createMany({
          data: [{
            userId: listing.userId,
            type: 'PRODUCT_LIKED',
            category: 'SOCIAL',
            priority: 'NORMAL',
            title: 'Someone liked your product',
            body: `Someone showed interest in “${listing.title}”. Open the product to see what is getting attention.`,
            listingId: listing.id,
            actionUrl: `/#/listing/${encodeURIComponent(listing.id)}`,
            actionLabel: 'View product',
            source: 'BUYER_PRODUCT_LIKE',
            dedupeKey,
          }],
          skipDuplicates: true,
        })
        if (created.count === 0) return null
        return tx.notification.findUnique({
          where: { userId_dedupeKey: { userId: listing.userId, dedupeKey } },
          select: { id: true, userId: true, title: true, body: true, actionUrl: true, actionLabel: true, priority: true },
        })
      }, { isolationLevel: 'Serializable' })
      if (notification) await deliverPushNotification(notification.userId, notification)
    } catch (error) {
      if ((error as { code?: string })?.code === 'P2034') {
        throw new ApiError(409, 'Your shortlist changed in another session. Refresh it and try again.')
      }
      throw error
    }
    return jsonOk({ saved: true }, 201)
  })
}

export async function DELETE(request: Request) {
  return route(async () => {
    const user = await requireUser()
    const body = await parseBody(request, z.object({ listingId: z.string().min(1).max(128) }))
    await db.savedProduct.deleteMany({ where: { userId: user.id, listingId: body.listingId } })
    return jsonOk({ saved: false })
  })
}
