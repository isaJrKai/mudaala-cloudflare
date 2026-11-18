import type { Prisma } from '@prisma/client'
import { publicListingOwnerWhere } from '@/lib/shop-visibility'

export function publicCollectionVisibilityWhere(now: Date): Prisma.ProductCollectionWhereInput {
  return {
    isActive: true,
    user: { is: publicListingOwnerWhere },
    AND: [
      { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
      { OR: [{ endsAt: null }, { endsAt: { gt: now } }] },
    ],
  }
}
