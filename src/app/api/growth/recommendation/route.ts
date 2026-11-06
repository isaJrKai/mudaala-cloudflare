import { jsonOk, requireUser, route } from '@/lib/api'
import { db } from '@/lib/db'
import { recommendNextMerchantAction } from '@/lib/merchant-growth'

function photoCount(raw: string): number {
  try {
    const photos: unknown = JSON.parse(raw)
    return Array.isArray(photos) ? photos.filter((photo) => typeof photo === 'string' && photo.length > 0).length : 0
  } catch {
    return 0
  }
}

/**
 * Return the current merchant's next best action, derived only from their
 * authenticated server-side shop records and explicit merchant events.
 */
export async function GET() {
  return route(async () => {
    const user = await requireUser('Sign in to see your shop recommendations')
    const [profile, listings, posterGenerated, posterShared] = await Promise.all([
      db.businessProfile.findUnique({
        where: { userId: user.id },
        select: {
          photoUrl: true,
          description: true,
          area: true,
          hours: true,
          whatsapp: true,
          shopCode: true,
        },
      }),
      db.listing.findMany({
        where: { userId: user.id, type: 'OFFER', status: 'ACTIVE' },
        select: { id: true, title: true, photos: true },
        orderBy: { publishedAt: 'desc' },
        take: 100,
      }),
      db.merchantGrowthEvent.findFirst({
        where: { userId: user.id, eventType: 'POSTER_GENERATED' },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      }),
      db.merchantGrowthEvent.findFirst({
        where: { userId: user.id, eventType: 'POSTER_SHARED' },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      }),
    ])

    const recommendation = recommendNextMerchantAction({
      shopExists: Boolean(profile),
      profile,
      activeProducts: listings.map((listing) => ({
        id: listing.id,
        title: listing.title,
        photoCount: photoCount(listing.photos),
      })),
      posterGeneratedAt: posterGenerated?.createdAt ?? null,
      posterSharedAt: posterShared?.createdAt ?? null,
    })

    return jsonOk({ recommendation })
  })
}
