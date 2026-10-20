/**
 * Deterministic, privacy-safe rotation for the existing Browse featured-shop rail.
 * Only shops represented by eligible public listing results are candidates.
 * Sorting IDs before selecting makes the rotation stable for a given result set
 * and time window; no per-user tracking or persisted impressions are required.
 */
export const FEATURED_SHOP_ROTATION_INTERVAL_MS = 30 * 60 * 1000

type FeaturedShopListing = {
  user?: {
    id?: string | null
    profile?: { businessName?: string | null } | null
  } | null
}

export function eligibleFeaturedShopIds(
  listings: readonly FeaturedShopListing[] | null | undefined,
): string[] {
  const ids = new Set<string>()
  for (const listing of listings ?? []) {
    const owner = listing.user
    if (!owner?.id || !owner.profile?.businessName?.trim()) continue
    ids.add(owner.id)
  }
  return [...ids].sort((a, b) => a.localeCompare(b))
}

export function chooseFeaturedShopId(
  sortedEligibleIds: readonly string[],
  rotationBucket: number,
): string | null {
  if (sortedEligibleIds.length === 0) return null
  const bucket = Number.isFinite(rotationBucket) ? Math.max(0, Math.trunc(rotationBucket)) : 0
  return sortedEligibleIds[bucket % sortedEligibleIds.length] ?? null
}
