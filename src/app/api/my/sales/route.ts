import { route, jsonOk, parseBody, requireUser, ApiError } from '@/lib/api'
import { db } from '@/lib/db'
import { saleCreateSchema } from '@/lib/business-records'

function serializeSale(sale: {
  id: string; status: string; channel: string; currency: string; soldAt: Date
  sourceListingId: string | null; sourceListingTitle: string | null
  notes: string | null; createdAt: Date
  items: { id: string; productId: string; productName: string; unit: string
    quantity: { toString(): string }; unitPrice: { toString(): string }
    unitCost: { toString(): string } | null; lineTotal: { toString(): string } }[]
}) {
  const items = sale.items.map((item) => ({
    ...item,
    quantity: Number(item.quantity),
    unitPrice: Number(item.unitPrice),
    unitCost: item.unitCost === null ? null : Number(item.unitCost),
    lineTotal: Number(item.lineTotal),
  }))
  const grossProfit = items.every((item) => item.unitCost !== null)
    ? Number(items.reduce((sum, item) => sum + item.lineTotal - (item.unitCost! * item.quantity), 0).toFixed(2))
    : null
  return {
    ...sale,
    soldAt: sale.soldAt.toISOString(),
    createdAt: sale.createdAt.toISOString(),
    items,
    revenue: Number(items.reduce((sum, item) => sum + item.lineTotal, 0).toFixed(2)),
    grossProfit,
  }
}

export async function GET(request: Request) {
  return route(async () => {
    const user = await requireUser()
    const url = new URL(request.url)
    const takeRaw = Number(url.searchParams.get('limit') || 50)
    const take = Number.isInteger(takeRaw) ? Math.min(100, Math.max(1, takeRaw)) : 50
    const sales = await db.sale.findMany({
      where: { userId: user.id },
      include: { items: true },
      orderBy: [{ soldAt: 'desc' }, { createdAt: 'desc' }],
      take,
    })
    return jsonOk({ sales: sales.map(serializeSale) })
  })
}

export async function POST(request: Request) {
  return route(async () => {
    const user = await requireUser()
    const data = await parseBody(request, saleCreateSchema)
    // A listing attribution is only valid when the seller says the sale came
    // through Mudaala. Enforce this before idempotency replay as well.
    if (data.sourceListingId && data.channel !== 'MUDAALA') {
      throw new ApiError(400, 'Choose “Found on Mudaala” as the sale channel to attribute a Mudaala listing')
    }
    const productIds = data.items.map((item) => item.productId)
    let result
    try {
      result = await db.$transaction(async (tx) => {
        if (data.idempotencyKey) {
          const previous = await tx.sale.findFirst({ where: { userId: user.id, idempotencyKey: data.idempotencyKey }, include: { items: true } })
          if (previous) {
            // An idempotency key identifies one immutable request. In particular,
            // a retry cannot add, remove or change its listing attribution.
            if ((previous.sourceListingId ?? null) !== (data.sourceListingId ?? null)) {
              throw new ApiError(409, 'This sale was already recorded with different listing attribution. Refresh your sales and try again.')
            }
            return { sale: previous, replayed: true }
          }
        }
        const sourceListing = data.sourceListingId
          ? await tx.listing.findFirst({
              where: { id: data.sourceListingId, userId: user.id, isSeed: false },
              select: { id: true, title: true },
            })
          : null
        if (data.sourceListingId && !sourceListing) {
          // Do not reveal whether an arbitrary listing belongs to another seller.
          throw new ApiError(404, 'That Mudaala listing could not be matched to this shop')
        }
        const products = await tx.businessProduct.findMany({ where: { userId: user.id, id: { in: productIds }, archived: false } })
        if (products.length !== productIds.length) throw new ApiError(400, 'One or more products are unavailable in your business catalogue')
        const byId = new Map(products.map((product) => [product.id, product]))
        const currencies = new Set(products.map((product) => product.currency))
        if (currencies.size !== 1) throw new ApiError(400, 'Record separate sales for products in different currencies')
        const created = await tx.sale.create({
          data: {
            userId: user.id,
            idempotencyKey: data.idempotencyKey ?? null,
            channel: data.channel,
            sourceListingId: sourceListing?.id ?? null,
            sourceListingTitle: sourceListing?.title ?? null,
            currency: products[0]!.currency,
            soldAt: data.soldAt ? new Date(data.soldAt) : new Date(),
            notes: data.notes?.trim() || null,
          },
        })
        for (const item of data.items) {
          const product = byId.get(item.productId)!
          const quantity = item.quantity
          const unitPrice = item.unitPrice ?? Number(product.sellingPrice)
          const lineTotal = (Math.round(quantity * unitPrice * 100) / 100).toFixed(2)
          if (product.trackInventory) {
            const changed = await tx.businessProduct.updateMany({
              where: { id: product.id, userId: user.id, archived: false, stockOnHand: { gte: quantity.toFixed(3) } },
              data: { stockOnHand: { decrement: quantity.toFixed(3) } },
            })
            if (changed.count !== 1) throw new ApiError(409, 'Not enough recorded stock for ' + product.name + '. Update stock before recording this sale.')
          }
          await tx.saleItem.create({
            data: {
              saleId: created.id, productId: product.id, productName: product.name, unit: product.unit,
              quantity: quantity.toFixed(3), unitPrice: unitPrice.toFixed(2),
              unitCost: product.costPrice === null ? null : Number(product.costPrice).toFixed(2), lineTotal,
            },
          })
          if (product.trackInventory) {
            await tx.stockMovement.create({
              data: { userId: user.id, productId: product.id, saleId: created.id, type: 'SALE', quantityDelta: (-quantity).toFixed(3), note: 'Recorded sale ' + created.id },
            })
          }
        }
        const sale = await tx.sale.findUniqueOrThrow({ where: { id: created.id }, include: { items: true } })
        return { sale, replayed: false }
      })
    } catch (error) {
      // If two retries arrive together, the unique key allows only one to
      // decrement stock. The losing request returns the winning record.
      if (data.idempotencyKey && typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002') {
        const previous = await db.sale.findFirst({ where: { userId: user.id, idempotencyKey: data.idempotencyKey }, include: { items: true } })
        if (previous) {
          if ((previous.sourceListingId ?? null) !== (data.sourceListingId ?? null)) {
            throw new ApiError(409, 'This sale was already recorded with different listing attribution. Refresh your sales and try again.')
          }
          return jsonOk({ sale: serializeSale(previous), replayed: true })
        }
      }
      throw error
    }
    return jsonOk({ sale: serializeSale(result.sale), replayed: result.replayed }, result.replayed ? 200 : 201)
  })
}
