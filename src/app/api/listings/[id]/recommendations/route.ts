import { route, jsonOk } from '@/lib/api'
import { db } from '@/lib/db'

type Params = { params: Promise<{ id: string }> }

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'this', 'that', 'your', 'you', 'are', 'was',
  'new', 'good', 'best', 'nice', 'quality', 'available', 'sale', 'sell', 'selling',
  'buy', 'bought', 'item', 'items', 'product', 'products', 'brand', 'size', 'price',
  'cheap', 'only', 'call', 'whatsapp', 'contact', 'delivery', 'please', 'more', 'very',
  'per', 'each', 'other', 'condition', 'perfect', 'original', 'used', 'use', 'one',
  'two', 'three', 'all', 'any', 'has', 'have', 'had', 'can', 'will', 'not', 'but',
  'our', 'out', 'its', 'into', 'than', 'then', 'they', 'them', 'their', 'who', 'what',
  'where', 'when', 'how', 'about', 'also', 'just', 'like', 'get', 'got', 'make',
  'made', 'more', 'less', 'under', 'over', 'each', 'per', 'only', 'offer',
])

function tokens(value: string): Set<string> {
  return new Set(
    value.normalize('NFKD')
      .replace(/\p{Diacritic}/gu, '')
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((word) => word.length >= 3 && !STOP_WORDS.has(word)),
  )
}

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

function priceSimilarity(a: number | null, b: number | null, sameCurrency: boolean): number {
  if (a === null || b === null || !sameCurrency || a <= 0 || b <= 0) return 0
  const ratio = Math.max(a, b) / Math.min(a, b)
  if (ratio <= 1.25) return 1.25
  if (ratio <= 1.8) return 0.9
  if (ratio <= 3) return 0.35
  return 0
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
      },
    })

    // Never recommend from an unavailable, hidden, or fixture listing.
    if (!current || current.status !== 'ACTIVE' || current.expiresAt.getTime() <= Date.now() || current.type !== 'OFFER' || current.isSeed) {
      return jsonOk({ items: [] })
    }

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
        title: true,
        description: true,
        category: true,
        price: true,
        currency: true,
        unit: true,
        county: true,
        area: true,
        photos: true,
        publishedAt: true,
        refreshedAt: true,
      },
    })

    const sourceTokens = tokens(`${current.title} ${current.description}`)
    const ranked = candidates.map((candidate) => {
      const candidateTokens = tokens(`${candidate.title} ${candidate.description}`)
      const shared = [...sourceTokens].filter((word) => candidateTokens.has(word))
      const unionSize = new Set([...sourceTokens, ...candidateTokens]).size || 1
      const overlap = shared.length / unionSize
      const sameCategory = candidate.category === current.category
      const sameCounty = candidate.county === current.county
      const sameArea = Boolean(current.area && candidate.area && current.area.toLowerCase() === candidate.area.toLowerCase())
      const sameCurrency = candidate.currency === current.currency
      const priceScore = priceSimilarity(current.price, candidate.price, sameCurrency)

      // Shared words in titles/descriptions catch concrete details such as
      // colour, material, fit, style, model, and intended use. Category and
      // price help, but category alone is never enough to recommend an item.
      const detailScore = Math.min(shared.length, 4) * 1.15 + overlap * 2
      const score =
        detailScore +
        (sameCategory ? 2.25 : 0) +
        priceScore +
        (sameCounty ? 0.35 : 0) +
        (sameArea ? 0.25 : 0) +
        (candidate.userId !== current.userId ? 0.15 : 0)

      const qualifies = sameCategory
        ? shared.length > 0 || priceScore >= 0.9
        : shared.length >= 2 && detailScore >= 2.7

      let reason = 'Similar product details'
      if (shared.length >= 2) reason = 'Similar style and details'
      else if (shared.length === 0 && sameCategory && priceScore >= 0.9) reason = 'Similar price and category'
      else if (sameCategory && shared.length > 0) reason = 'Same category, with matching details'

      return {
        candidate,
        score,
        qualifies,
        reason,
        sharedCount: shared.length,
      }
    })

    const items = ranked
      .filter((item) => item.qualifies)
      .sort((a, b) => b.score - a.score || b.candidate.refreshedAt.getTime() - a.candidate.refreshedAt.getTime())
      .slice(0, 8)
      .map(({ candidate, reason }) => ({
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
