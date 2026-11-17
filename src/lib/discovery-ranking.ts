/**
 * Explainable candidate ranking for the Mudaala discovery feed.
 * Scores use only marketplace context and measured listing/shop signals.
 * Exposure counts are optional until impression logging is wired; when
 * supplied they create a bounded fairness boost, never a relevance override.
 */
export interface DiscoveryCandidate {
  id: string
  userId: string
  category: string
  title: string
  description?: string | null
  county?: string | null
  area?: string | null
  publishedAt: Date
  refreshedAt?: Date
  viewCount?: number
  views7d?: number
  callClicks7d?: number
  whatsappClicks7d?: number
  shareClicks7d?: number
  exposureCount7d?: number
  isNewShop?: boolean
}

export interface DiscoveryContext {
  now?: Date
  category?: string
  query?: string
  county?: string
  area?: string
  excludeListingIds?: readonly string[]
  limit?: number
  /** Stable bucket supplied by the caller for repeatable page rotation. */
  rotationBucket?: number
}

export interface RankedDiscoveryCandidate {
  candidate: DiscoveryCandidate
  score: number
  reasons: string[]
  scoreBreakdown: {
    relevance: number
    freshness: number
    engagement: number
    locality: number
    exposureBalance: number
  }
}

const STOP_WORDS = new Set(['the','and','for','with','from','this','that','your','you','are','was','new','good','best','nice','quality','available','sale','sell','buy','item','items','product','products','price','cheap','only','call','whatsapp','contact','delivery','per','each','other','condition','used','use','one'])

function tokens(value: string): Set<string> {
  return new Set(value.normalize('NFKD').replace(/\p{Diacritic}/gu, '').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((word) => word.length >= 3 && !STOP_WORDS.has(word)))
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function ageHours(date: Date, now: Date): number {
  return Math.max(0, (now.getTime() - date.getTime()) / 3_600_000)
}

export function rankDiscoveryCandidates(
  candidates: readonly DiscoveryCandidate[],
  context: DiscoveryContext = {},
): RankedDiscoveryCandidate[] {
  const now = context.now ?? new Date()
  const excluded = new Set(context.excludeListingIds ?? [])
  const queryTokens = tokens(context.query ?? '')
  const scored = candidates
    .filter((candidate) => candidate.id && candidate.userId && !excluded.has(candidate.id))
    .map((candidate) => {
      const candidateTokens = tokens(candidate.title + ' ' + (candidate.description ?? ''))
      const overlap = [...queryTokens].filter((token) => candidateTokens.has(token)).length
      const relevance = context.query
        ? clamp(overlap / Math.max(1, queryTokens.size), 0, 1) * 40 + (context.category === candidate.category ? 8 : 0)
        : (context.category === candidate.category ? 32 : 0)
      const age = ageHours(candidate.refreshedAt ?? candidate.publishedAt, now)
      const freshness = 18 * Math.exp(-age / (24 * 7))
      const views = Math.max(0, candidate.views7d ?? candidate.viewCount ?? 0)
      const contacts = Math.max(0, candidate.callClicks7d ?? 0) + Math.max(0, candidate.whatsappClicks7d ?? 0)
      const shares = Math.max(0, candidate.shareClicks7d ?? 0)
      // Contacts matter more than passive views. Log-scaled values limit gaming.
      const engagement = clamp(Math.log1p(contacts) * 3.5 + Math.log1p(shares) * 1.4 + Math.log1p(views) * 0.45, 0, 18)
      const locality = context.area && candidate.area?.toLowerCase() === context.area.toLowerCase()
        ? 9
        : context.county && candidate.county?.toLowerCase() === context.county.toLowerCase() ? 5 : 0
      const exposure = Math.max(0, candidate.exposureCount7d ?? 0)
      const exposureBalance = clamp(9 - Math.log1p(exposure) * 2.2 + (candidate.isNewShop ? 3 : 0), 0, 10)
      const score = relevance + freshness + engagement + locality + exposureBalance
      const reasons: string[] = []
      if (context.query && overlap > 0) reasons.push('Matches your search')
      if (context.category === candidate.category) reasons.push('In your selected category')
      if (locality > 0) reasons.push('Available near you')
      if (candidate.isNewShop) reasons.push('Discover a newer shop')
      if (contacts > 0) reasons.push('Buyers are contacting this seller')
      return {
        candidate,
        score,
        reasons,
        scoreBreakdown: { relevance, freshness, engagement, locality, exposureBalance },
      }
    })
    .filter((item) => !context.query || item.scoreBreakdown.relevance >= 8)
    .sort((a, b) => b.score - a.score || a.candidate.id.localeCompare(b.candidate.id))

  // Group score-sorted candidates by seller, then take one product per shop
  // per round. This preserves a meaningful relevance order while avoiding a
  // repeated full-array sort for every result as the catalogue grows.
  const bySeller = new Map<string, RankedDiscoveryCandidate[]>()
  for (const item of scored) {
    const group = bySeller.get(item.candidate.userId) ?? []
    group.push(item)
    bySeller.set(item.candidate.userId, group)
  }
  const sellers = [...bySeller.entries()].sort(
    ([sellerA, productsA], [sellerB, productsB]) =>
      (productsB[0]?.score ?? 0) - (productsA[0]?.score ?? 0) || sellerA.localeCompare(sellerB),
  )
  const bucket = Math.max(0, Math.trunc(context.rotationBucket ?? 0))
  if (sellers.length > 1) {
    const rotation = bucket % Math.min(sellers.length, 5)
    sellers.push(...sellers.splice(0, rotation))
  }
  const output: RankedDiscoveryCandidate[] = []
  const limit = Math.max(1, Math.min(Math.trunc(context.limit ?? 24), scored.length || 1))
  for (let round = 0; output.length < limit; round += 1) {
    let added = false
    for (const [, products] of sellers) {
      const item = products[round]
      if (!item) continue
      output.push(item)
      added = true
      if (output.length >= limit) break
    }
    if (!added) break
  }
  return output
}
