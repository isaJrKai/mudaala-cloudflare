import { route, jsonOk, parseBody, requireSeller, ApiError } from '@/lib/api'
import { db } from '@/lib/db'
import { businessProductCreateSchema, serializeProduct, type SerializedBusinessProduct } from '@/lib/business-records'

export async function GET() {
  return route(async () => {
    const user = await requireSeller()
    const products = await db.businessProduct.findMany({
      where: { userId: user.id },
      orderBy: [{ archived: 'asc' }, { updatedAt: 'desc' }],
      include: { listing: { select: { id: true, title: true, status: true, availabilityStatus: true } } },
    })
    return jsonOk({ products: products.map(serializeProduct) })
  })
}

export async function POST(request: Request) {
  return route(async () => {
    const user = await requireSeller()
    const data = await parseBody(request, businessProductCreateSchema)

    // A product may link to one of the seller's OWN listings so the stock
    // record and the public ad describe the same real product.
    if (data.listingId) {
      const linked = await db.listing.findFirst({ where: { id: data.listingId, userId: user.id }, select: { id: true } })
      if (!linked) throw new ApiError(404, 'That listing was not found in your catalogue')
    }

    let product: SerializedBusinessProduct
    try {
      const createdId = await db.$transaction(async (tx) => {
        const row = await tx.businessProduct.create({
          data: {
            userId: user.id,
            name: data.name,
            sku: data.sku?.trim() || null,
            unit: data.unit,
            currency: data.currency,
            sellingPrice: data.sellingPrice.toFixed(2),
            costPrice: data.costPrice == null ? null : data.costPrice.toFixed(2),
            stockOnHand: data.openingStock.toFixed(3),
            reorderLevel: data.reorderLevel.toFixed(3),
            trackInventory: data.trackInventory,
            ...(data.listingId ? { listingId: data.listingId } : {}),
          },
        })
        if (data.openingStock > 0) {
          await tx.stockMovement.create({
            data: { userId: user.id, productId: row.id, type: 'OPENING', quantityDelta: data.openingStock.toFixed(3), note: 'Opening stock recorded when product was created' },
          })
        }
        return row.id
      })
      // Re-read with the linked listing so the response matches the list shape.
      const row = await db.businessProduct.findUniqueOrThrow({
        where: { id: createdId },
        include: { listing: { select: { id: true, title: true, status: true, availabilityStatus: true } } },
      })
      product = serializeProduct(row)
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002') {
        if (conflictIsListing(error)) throw new ApiError(409, 'That ad is already linked to another product')
        throw new ApiError(409, 'That SKU is already used by another product in your business')
      }
      throw error
    }
    return jsonOk({ product }, 201)
  })
}

// The unique violation could come from the (userId, sku) pair or the
// listingId column; the constraint target names the truth.
function conflictIsListing(error: unknown): boolean {
  const target = (error as { meta?: { target?: string[] | string } }).meta?.target
  return (Array.isArray(target) ? target.join(',') : String(target ?? '')).includes('listingId')
}
