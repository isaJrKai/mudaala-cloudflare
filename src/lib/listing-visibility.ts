// Shared expiry predicates for read paths. Scheduled maintenance owns the
// ACTIVE -> EXPIRED state transition; readers independently enforce visibility
// from the persisted deadline so a delayed sweep never leaks stale stock.
export function activeListingExpiryFilter(now: Date = new Date()) {
  return { expiresAt: { gt: now } } as const
}

export function visibleListingStatus(
  status: string,
  expiresAt: Date,
  now: Date = new Date(),
): string {
  return status === 'ACTIVE' && expiresAt.getTime() <= now.getTime() ? 'EXPIRED' : status
}
