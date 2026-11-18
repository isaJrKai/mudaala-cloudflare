import type { Prisma } from '@prisma/client'

// Public shop discovery requires a completed, active shop profile and an
// account that is not suspended.
export const publicShopOwnerWhere = {
  suspendedAt: null,
  profile: { is: { moderationStatus: 'ACTIVE' } },
} satisfies Prisma.UserWhereInput

// Listings and collections may belong to sellers who have not completed a
// shop profile yet. Exclude suspended users and profiles explicitly hidden
// by moderation, while allowing a missing profile and all active profiles.
export const publicListingOwnerWhere = {
  suspendedAt: null,
  NOT: {
    profile: {
      is: { moderationStatus: { not: 'ACTIVE' } },
    },
  },
} satisfies Prisma.UserWhereInput
