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
    const [profile, listings, growthEvents] = await Promise.all([
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
      db.merchantGrowthEvent.findMany({
        where: {
          userId: user.id,
          eventType: { in: ['POSTER_GENERATED', 'POSTER_SHARED', 'POSTER_SHARE_INITIATED', 'PRODUCT_PHOTO_ADDED', 'PRODUCT_PHOTOS_SHARE_INITIATED'] },
        },
        orderBy: { createdAt: 'desc' },
        take: 40,
        select: { eventType: true, entityId: true, createdAt: true },
      }),
    ])

    const recommendation = recommendNextMerchantAction({
      shopExists: Boolean(profile),
      shopId: user.id,
      profile,
      activeProducts: listings.map((listing) => ({
        id: listing.id,
        title: listing.title,
        photoCount: photoCount(listing.photos),
      })),
      posterGeneratedAt: growthEvents.find((event) => event.eventType === 'POSTER_GENERATED')?.createdAt ?? null,
      posterSharedAt: growthEvents.find((event) => event.eventType === 'POSTER_SHARED')?.createdAt ?? null,
      posterShareInitiatedAt: growthEvents.find((event) => event.eventType === 'POSTER_SHARE_INITIATED')?.createdAt ?? null,
      latestPhotoAddedAt: growthEvents.find((event) => event.eventType === 'PRODUCT_PHOTO_ADDED')?.createdAt ?? null,
      latestPhotoListingId: growthEvents.find((event) => event.eventType === 'PRODUCT_PHOTO_ADDED')?.entityId ?? null,
      latestPhotoListingTitle: listings.find((listing) => listing.id === growthEvents.find((event) => event.eventType === 'PRODUCT_PHOTO_ADDED')?.entityId)?.title ?? null,
      productPhotosShareInitiatedAt: growthEvents.find((event) => event.eventType === 'PRODUCT_PHOTOS_SHARE_INITIATED' && event.entityId === growthEvents.find((item) => item.eventType === 'PRODUCT_PHOTO_ADDED')?.entityId)?.createdAt ?? null,
    })

    return jsonOk({ recommendation })
  })
}
