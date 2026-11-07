import { route, jsonOk } from '@/lib/api'
import { db } from '@/lib/db'
import { rankRelatedListings } from '@/lib/commerce-intelligence/recommendations'

type Params = { params: Promise<{ id: string }> }

function photosOf(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value)
    return Array.isArray(parsed)
      ? parsed.filter((photo): photo is string => typeof photo === 'string').slice(0, 8)
      : []
  } catch {
    return []
  }
}

export async function GET(_request: Request, { params }: Params) {
  return route(async () => {
    const { id } = await params
    const current = await db.listing.findUnique({
      where: { id },
      select: {
        id: true,
        userId: true,
        type: true,
        title: true,
        description: true,
        category: true,
        price: true,
        currency: true,
        county: true,
        area: true,
        country: true,
        status: true,
        isSeed: true,
        expiresAt: true,
        refreshedAt: true,
      },
    })

    if (!current) return jsonOk({ items: [] })

    const candidates = await db.listing.findMany({
      where: {
        status: 'ACTIVE',
        expiresAt: { gt: new Date() },
        type: 'OFFER',
        isSeed: false,
        id: { not: current.id },
        country: current.country,
      },
      orderBy: { refreshedAt: 'desc' },
      take: 160,
      select: {
        id: true,
        userId: true,
        type: true,
        title: true,
        description: true,
        category: true,
        price: true,
        currency: true,
        unit: true,
        county: true,
        area: true,
        country: true,
        status: true,
        isSeed: true,
        expiresAt: true,
        refreshedAt: true,
        photos: true,
        publishedAt: true,
      },
    })

    const decisions = rankRelatedListings(current, candidates, {
      context: { channel: 'WEB', surface: 'PRODUCT_DETAIL' },
      now: new Date(),
      limit: 8,
    })

    const items = decisions.map(({ candidate, reason }) => ({
      id: candidate.id,
      title: candidate.title,
      description: candidate.description,
      category: candidate.category,
      price: candidate.price,
      currency: candidate.currency,
      unit: candidate.unit,
      county: candidate.county,
      area: candidate.area,
      photos: photosOf(candidate.photos),
      publishedAt: candidate.publishedAt.toISOString(),
      reason,
    }))

    return jsonOk({ items })
  })
}
