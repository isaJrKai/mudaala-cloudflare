import { route, jsonOk, parseBody, requireSeller, ApiError } from '@/lib/api'
import { db } from '@/lib/db'
import { businessProductUpdateSchema, serializeProduct, type SerializedBusinessProduct } from '@/lib/business-records'

type Context = { params: Promise<{ id: string }> }

// The unique violation could come from the (userId, sku) pair or the
// listingId column; the constraint target names the truth.
function conflictIsListing(error: unknown): boolean {
  const target = (error as { meta?: { target?: string[] | string } }).meta?.target
  return (Array.isArray(target) ? target.join(',') : String(target ?? '')).includes('listingId')
}

export async function PATCH(request: Request, context: Context) {
  return route(async () => {
    const user = await requireSeller()
    const { id } = await context.params
    const data = await parseBody(request, businessProductUpdateSchema)
    const existing = await db.businessProduct.findFirst({ where: { id, userId: user.id } })
    if (!existing) throw new ApiError(404, 'Product not found')

    // Link (or relink/unlink) the catalogue record to one of the seller's OWN
    // listings. Unlinking is a plain null; linking validates ownership so a
    // product can never point at another merchant's ad.
    if (data.listingId) {
      const linked = await db.listing.findFirst({ where: { id: data.listingId, userId: user.id }, select: { id: true } })
      if (!linked) throw new ApiError(404, 'That listing was not found in your catalogue')
    }

    let product: SerializedBusinessProduct
    try {
      await db.businessProduct.update({
        where: { id },
        data: {
          ...(data.name !== undefined ? { name: data.name } : {}),
          ...(data.sku !== undefined ? { sku: data.sku?.trim() || null } : {}),
          ...(data.unit !== undefined ? { unit: data.unit } : {}),
          ...(data.sellingPrice !== undefined ? { sellingPrice: data.sellingPrice.toFixed(2) } : {}),
          ...(data.costPrice !== undefined ? { costPrice: data.costPrice === null ? null : data.costPrice.toFixed(2) } : {}),
          ...(data.trackInventory !== undefined ? { trackInventory: data.trackInventory } : {}),
          ...(data.reorderLevel !== undefined ? { reorderLevel: data.reorderLevel.toFixed(3) } : {}),
          ...(data.archived !== undefined ? { archived: data.archived } : {}),
          ...(data.listingId !== undefined ? { listingId: data.listingId } : {}),
        },
      })
      const row = await db.businessProduct.findUniqueOrThrow({
        where: { id },
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
    return jsonOk({ product })
  })
}
