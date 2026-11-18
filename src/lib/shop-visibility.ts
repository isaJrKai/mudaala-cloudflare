import type { Prisma } from '@prisma/client'

// Public discovery must respect both account-level suspension and shop-level
// moderation. Reuse this predicate across Browse, shop pages, QR lookup,
// collections, and published showrooms so no alternate URL bypasses a hide.
export const publicShopOwnerWhere = {
  suspendedAt: null,
  profile: { is: { moderationStatus: 'ACTIVE' } },
} satisfies Prisma.UserWhereInput
