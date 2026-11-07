import type {
  CommerceChannel,
  RecommendationSurface,
} from './contracts'

export const RECOMMENDATION_ENGINE_VERSION = 'related-products-v1'

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'this', 'that', 'your', 'you', 'are', 'was',
  'new', 'good', 'best', 'nice', 'quality', 'available', 'sale', 'sell', 'selling',
  'buy', 'bought', 'item', 'items', 'product', 'products', 'brand', 'size', 'price',
  'cheap', 'only', 'call', 'whatsapp', 'contact', 'delivery', 'please', 'more', 'very',
  'per', 'each', 'other', 'condition', 'perfect', 'original', 'used', 'use', 'one',
  'two', 'three', 'all', 'any', 'has', 'have', 'had', 'can', 'will', 'not', 'but',
  'our', 'out', 'its', 'into', 'than', 'then', 'they', 'them', 'their', 'who', 'what',
  'where', 'when', 'how', 'about', 'also', 'just', 'like', 'get', 'got', 'make',
  'made', 'less', 'under', 'over', 'offer',
])

export interface RecommendationListing {
  id: string
  userId: string
  type: string
  title: string
  description: string
  category: string
  price: number | null
  currency: string
  county: string
  area: string | null
  country: string
  status: string
  isSeed: boolean
  expiresAt: Date
  refreshedAt: Date
}

export interface RelatedListingCandidate extends RecommendationListing {
  unit: string | null
  photos: string
  publishedAt: Date
}

export type RelatedListingSource = RecommendationListing

export interface RelatedListingDecision {
  candidate: RelatedListingCandidate
  score: number
  reasonCode:
    | 'SIMILAR_STYLE_DETAILS'
    | 'SIMILAR_PRICE_CATEGORY'
    | 'SAME_CATEGORY_MATCHING_DETAILS'
    | 'SIMILAR_PRODUCT_DETAILS'
  reason: string
  engineVersion: typeof RECOMMENDATION_ENGINE_VERSION
  channel: CommerceChannel
  surface: RecommendationSurface
}

export interface RelatedListingOptions {
  context?: {
    channel: CommerceChannel
    surface: RecommendationSurface
  }
  now?: Date
  limit?: number
}

function tokens(value: string): Set<string> {
  return new Set(
    value.normalize('NFKD')
      .replace(/\p{M}/gu, '')
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((word) => word.length >= 3 && !STOP_WORDS.has(word)),
  )
}

function priceSimilarity(a: number | null, b: number | null, sameCurrency: boolean): number {
  if (a === null || b === null || !sameCurrency || a <= 0 || b <= 0) return 0
  const ratio = Math.max(a, b) / Math.min(a, b)
  if (ratio <= 1.25) return 1.25
  if (ratio <= 1.8) return 0.9
  if (ratio <= 3) return 0.35
  return 0
}

function isEligible(listing: RecommendationListing, now: number): boolean {
  return listing.status === 'ACTIVE'
    && listing.type === 'OFFER'
    && !listing.isSeed
    && listing.expiresAt.getTime() > now
}

function normalized(value: string | null | undefined): string {
  return (value ?? '').normalize('NFKD').replace(/\p{M}/gu, '').trim().toLowerCase()
}

/**
 * Deterministic, channel-neutral related-product baseline.
 *
 * This deliberately does not use popularity, merchant activity, follower
 * counts, or claimed sales as trust signals. Those require provenance and
 * evaluation before influencing ranking. V1 ranks catalogue relevance,
 * comparable price and coarse locality only.
 */
export function rankRelatedListings(
  source: RelatedListingSource,
  candidates: RelatedListingCandidate[],
  options: RelatedListingOptions = {},
): RelatedListingDecision[] {
  const now = (options.now ?? new Date()).getTime()
  const channel = options.context?.channel ?? 'WEB'
  const surface = options.context?.surface ?? 'PRODUCT_DETAIL'
  const limit = Math.max(0, Math.min(24, Math.floor(options.limit ?? 8)))

  if (!isEligible(source, now) || limit === 0) return []

  const sourceTokens = tokens(`${source.title} ${source.description}`)
  const ranked = candidates
    .filter((candidate) => candidate.id !== source.id
      && candidate.country === source.country
      && isEligible(candidate, now))
    .map((candidate) => {
      const candidateTokens = tokens(`${candidate.title} ${candidate.description}`)
      const shared = [...sourceTokens].filter((word) => candidateTokens.has(word))
      const unionSize = new Set([...sourceTokens, ...candidateTokens]).size || 1
      const overlap = shared.length / unionSize
      const sameCategory = normalized(candidate.category) === normalized(source.category)
      const sameCounty = normalized(candidate.county) === normalized(source.county)
      const sameArea = Boolean(source.area && candidate.area
        && normalized(candidate.area) === normalized(source.area))
      const sameCurrency = normalized(candidate.currency) === normalized(source.currency)
      const priceScore = priceSimilarity(source.price, candidate.price, sameCurrency)
      const detailScore = Math.min(shared.length, 4) * 1.15 + overlap * 2
      const score = detailScore
        + (sameCategory ? 2.25 : 0)
        + priceScore
        + (sameCounty ? 0.35 : 0)
        + (sameArea ? 0.25 : 0)
        + (candidate.userId !== source.userId ? 0.15 : 0)

      const qualifies = sameCategory
        ? shared.length > 0 || priceScore >= 0.9
        : shared.length >= 2 && detailScore >= 2.7
      if (!qualifies) return null

      let reasonCode: RelatedListingDecision['reasonCode'] = 'SIMILAR_PRODUCT_DETAILS'
      let reason = 'Similar product details'
      if (shared.length >= 2) {
        reasonCode = 'SIMILAR_STYLE_DETAILS'
        reason = 'Similar style and details'
      } else if (shared.length === 0 && sameCategory && priceScore >= 0.9) {
        reasonCode = 'SIMILAR_PRICE_CATEGORY'
        reason = 'Similar price and category'
      } else if (sameCategory && shared.length > 0) {
        reasonCode = 'SAME_CATEGORY_MATCHING_DETAILS'
        reason = 'Same category, with matching details'
      }

      return {
        candidate,
        score,
        reasonCode,
        reason,
        engineVersion: RECOMMENDATION_ENGINE_VERSION,
        channel,
        surface,
      } satisfies RelatedListingDecision
    })
    .filter((item): item is RelatedListingDecision => item !== null)
    .sort((a, b) => b.score - a.score
      || b.candidate.refreshedAt.getTime() - a.candidate.refreshedAt.getTime()
      || a.candidate.id.localeCompare(b.candidate.id))

  // Relevance remains primary, but one shop cannot occupy every first slot
  // when several shops offer relevant alternatives. Interleave seller queues
  // before giving any seller a second result.
  const sellerQueues = new Map<string, RelatedListingDecision[]>()
  for (const item of ranked) {
    const queue = sellerQueues.get(item.candidate.userId) ?? []
    queue.push(item)
    sellerQueues.set(item.candidate.userId, queue)
  }

  const sellers = [...sellerQueues.keys()].sort((a, b) => {
    const scoreDifference = sellerQueues.get(b)![0]!.score - sellerQueues.get(a)![0]!.score
    return scoreDifference || a.localeCompare(b)
  })
  const diversified: RelatedListingDecision[] = []
  let round = 0
  while (diversified.length < limit) {
    let added = false
    for (const sellerId of sellers) {
      const item = sellerQueues.get(sellerId)?.[round]
      if (!item) continue
      diversified.push(item)
      added = true
      if (diversified.length >= limit) break
    }
    if (!added) break
    round += 1
  }

  return diversified
}
