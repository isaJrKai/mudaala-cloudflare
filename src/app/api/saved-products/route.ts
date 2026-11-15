import { z } from 'zod'
import { ApiError, jsonOk, parseBody, requireUser, route } from '@/lib/api'
import { db } from '@/lib/db'

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
    const listing = await db.listing.findFirst({
      where: { id: body.listingId, type: 'OFFER', status: 'ACTIVE', isSeed: false, expiresAt: { gt: new Date() } },
      select: { id: true },
    })
    if (!listing) throw new ApiError(404, 'This product is no longer available to save.')
    const existing = await db.savedProduct.findUnique({ where: { userId_listingId: { userId: user.id, listingId: listing.id } }, select: { id: true } })
    if (!existing) {
      const count = await db.savedProduct.count({ where: { userId: user.id } })
      if (count >= 40) throw new ApiError(409, 'Your account shortlist is full. Remove a saved product before adding another.')
    }
    await db.savedProduct.upsert({
      where: { userId_listingId: { userId: user.id, listingId: listing.id } },
      create: { userId: user.id, listingId: listing.id },
      update: {},
    })
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
