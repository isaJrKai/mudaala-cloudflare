import type { Prisma } from '@prisma/client'

export function publicCollectionVisibilityWhere(now: Date): Prisma.ProductCollectionWhereInput {
  return {
    isActive: true,
    AND: [
      { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
      { OR: [{ endsAt: null }, { endsAt: { gt: now } }] },
    ],
  }
}
