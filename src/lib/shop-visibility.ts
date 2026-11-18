import type { Prisma } from '@prisma/client'

// Public discovery must respect both account-level suspension and shop-level
// moderation. Reuse this predicate across Browse, shop pages, QR lookup,
// collections, and published showrooms so no alternate URL bypasses a hide.
export const publicShopOwnerWhere = {
  suspendedAt: null,
  profile: { is: { moderationStatus: 'ACTIVE' } },
} satisfies Prisma.UserWhereInput

// Listings may be published before a seller completes a shop profile. Keep
// those listings public, while still excluding suspended accounts and shops
// explicitly hidden by moderation.
export const publicListingOwnerWhere = {
  suspendedAt: null,
  OR: [
    { profile: { is: { moderationStatus: 'ACTIVE' } } },
    { profile: { is: null } },
  ],
} satisfies Prisma.UserWhereInput
