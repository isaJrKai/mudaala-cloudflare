import { route, jsonOk, parseBody, requireUser, ApiError } from '@/lib/api'
import { db } from '@/lib/db'
import { stockMovementCreateSchema } from '@/lib/validation'

export async function GET() {
  return route(async () => {
    const user = await requireUser()
    const [total, movements, linkedBalances, customBalances] = await Promise.all([
      db.stockMovement.count({ where: { userId: user.id } }),
      db.stockMovement.findMany({
        where: { userId: user.id },
        orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
        take: 100,
        select: {
          id: true, listingId: true, saleId: true, productTitle: true,
          quantityDelta: true, unit: true, reason: true, note: true,
          occurredAt: true, createdAt: true,
        },
      }),
      db.stockMovement.groupBy({
        by: ['listingId', 'unit'],
        where: { userId: user.id, listingId: { not: null } },
        _sum: { quantityDelta: true },
        _count: { _all: true },
      }),
      db.stockMovement.groupBy({
        by: ['productTitle', 'unit'],
        where: { userId: user.id, listingId: null },
        _sum: { quantityDelta: true },
        _count: { _all: true },
      }),
    ])
    const linkedIds = linkedBalances.map((balance) => balance.listingId).filter((id): id is string => Boolean(id))
    const listingNames = linkedIds.length
      ? await db.listing.findMany({ where: { id: { in: linkedIds }, userId: user.id }, select: { id: true, title: true } })
      : []
    const titleById = new Map(listingNames.map((listing) => [listing.id, listing.title]))
    const balances = [
      ...linkedBalances.map((balance) => ({
        listingId: balance.listingId,
        productTitle: (balance.listingId && titleById.get(balance.listingId)) || 'Deleted listing',
        unit: balance.unit,
        quantityOnHand: Number((balance._sum.quantityDelta ?? 0).toString()),
        movementCount: balance._count._all,
      })),
      ...customBalances.map((balance) => ({
        listingId: null,
        productTitle: balance.productTitle,
        unit: balance.unit,
        quantityOnHand: Number((balance._sum.quantityDelta ?? 0).toString()),
        movementCount: balance._count._all,
      })),
    ]
    return jsonOk({
      total,
      movements: movements.map((movement) => ({
        ...movement,
        quantityDelta: Number(movement.quantityDelta.toString()),
        occurredAt: movement.occurredAt.toISOString(),
        createdAt: movement.createdAt.toISOString(),
      })),
      balances: balances.sort((a, b) => a.productTitle.localeCompare(b.productTitle)),
    })
  })
}

export async function POST(request: Request) {
  return route(async () => {
    const user = await requireUser()
    const data = await parseBody(request, stockMovementCreateSchema)
    const listing = data.listingId
      ? await db.listing.findFirst({
          where: { id: data.listingId, userId: user.id },
          select: { id: true, title: true, unit: true },
        })
      : null
    if (data.listingId && !listing) throw new ApiError(404, 'That product was not found in your listings')

    const productTitle = listing?.title ?? data.productTitle?.trim()
    if (!productTitle) throw new ApiError(400, 'Enter the product name')
    const occurredAt = data.occurredAt ? new Date(data.occurredAt) : new Date()
    if (occurredAt.getTime() > Date.now() + 5 * 60_000) {
      throw new ApiError(400, 'Stock movement date cannot be in the future')
    }

    const movement = await db.stockMovement.create({
      data: {
        userId: user.id,
        listingId: listing?.id ?? null,
        productTitle,
        quantityDelta: data.quantityDelta,
        unit: listing ? listing.unit : (data.unit?.trim() || null),
        reason: data.reason,
        note: data.note?.trim() || null,
        occurredAt,
      },
    })
    return jsonOk({
      movement: {
        ...movement,
        quantityDelta: Number(movement.quantityDelta.toString()),
        occurredAt: movement.occurredAt.toISOString(),
        createdAt: movement.createdAt.toISOString(),
      },
    }, 201)
  })
}
