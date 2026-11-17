import { ApiError, jsonOk, route as apiRoute } from '@/lib/api'
import { db } from '@/lib/db'

type Params = { params: Promise<{ slug: string }> }

function readArray(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch { return [] }
}

export async function GET(_request: Request, { params }: Params) {
  return apiRoute(async () => {
    const { slug } = await params
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 80) {
      throw new ApiError(404, 'Showroom not found')
    }
    const now = new Date()
    const showroom = await db.shopShowroom.findFirst({
      where: { slug, status: 'PUBLISHED', publishedAt: { lte: now } },
      include: {
        user: {
          select: {
            id: true,
            profile: {
              select: {
                businessName: true, photoUrl: true, coverPhotoUrl: true, category: true,
                description: true, county: true, area: true, phone: true, whatsapp: true,
                hours: true, shopCode: true, websiteUrl: true,
              },
            },
          },
        },
      },
    })
    if (!showroom || !showroom.user.profile) throw new ApiError(404, 'Showroom not found')

    const listingIds = readArray(showroom.listingIds).slice(0, 60)
    const listings = listingIds.length ? await db.listing.findMany({
      where: {
        id: { in: listingIds },
        userId: showroom.userId,
        type: 'OFFER',
        status: 'ACTIVE',
        isSeed: false,
        expiresAt: { gt: now },
      },
      select: {
        id: true, title: true, description: true, category: true, brand: true, model: true,
        price: true, compareAtPrice: true, currency: true, priceNegotiable: true,
        availabilityStatus: true, photos: true, publishedAt: true,
      },
    }) : []

    const byId = new Map(listings.map((listing) => [listing.id, listing]))
    const orderedListings = listingIds.flatMap((id) => {
      const listing = byId.get(id)
      if (!listing) return []
      return [{
        ...listing,
        photos: readArray(listing.photos).slice(0, 4),
        publishedAt: listing.publishedAt.toISOString(),
      }]
    })
    const profile = showroom.user.profile
    let photos: string[] = []
    let sections: unknown[] = []
    try { photos = readArray(showroom.photos) } catch { /* empty gallery */ }
    try {
      const parsed: unknown = JSON.parse(showroom.content)
      if (Array.isArray(parsed)) sections = parsed
    } catch { /* empty sections */ }

    return jsonOk({
      showroom: {
        id: showroom.id, slug: showroom.slug, templateId: showroom.templateId,
        templateVersion: showroom.templateVersion, title: showroom.title,
        headline: showroom.headline, introduction: showroom.introduction, story: showroom.story,
        logoUrl: showroom.logoUrl, primaryColor: showroom.primaryColor, accentColor: showroom.accentColor,
        coverPhotoUrl: showroom.coverPhotoUrl, photos, sections,
        publishedAt: showroom.publishedAt?.toISOString() ?? null,
      },
      shop: {
        id: showroom.user.id,
        name: profile.businessName,
        logoUrl: profile.photoUrl,
        coverPhotoUrl: profile.coverPhotoUrl,
        category: profile.category,
        description: profile.description,
        area: profile.area,
        county: profile.county,
        phone: profile.phone,
        whatsapp: profile.whatsapp,
        hours: profile.hours,
        shopCode: profile.shopCode,
        websiteUrl: profile.websiteUrl,
      },
      products: orderedListings,
    })
  })
}
