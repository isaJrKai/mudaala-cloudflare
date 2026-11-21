import { z } from 'zod'
import { ApiError, jsonOk, parseBody, requireSeller, route } from '@/lib/api'
import { db } from '@/lib/db'
import { getOwnedListingOr404, sanitizePhotos } from '@/lib/listings'

type Params = { params: Promise<{ id: string }> }

const variantSchema = z.object({
  label: z.string().trim().min(1).max(120),
  options: z.record(z.string(), z.string().trim().min(1).max(80)).refine((value) => Object.keys(value).length > 0),
  sku: z.string().trim().min(1).max(64).nullable().optional(),
  price: z.number().finite().positive().nullable().optional(),
  stockQuantity: z.number().finite().min(0).nullable().optional(),
  trackInventory: z.boolean().default(false),
  availabilityStatus: z.enum(['UNKNOWN', 'IN_STOCK', 'AVAILABLE_ON_ORDER', 'OUT_OF_STOCK']).default('UNKNOWN'),
  photos: z.array(z.string().trim().min(1).max(2048)).max(8).default([]),
})
const bodySchema = z.object({ variants: z.array(variantSchema).max(100) })

// Replace a listing's variant set as one owner-scoped transaction. Existing
// enquiries retain their JSON snapshot even if a seller later removes a variant.
export async function PUT(_request: Request, { params }: Params) {
  return route(async () => {
    const seller = await requireSeller()
    const { id } = await params
    const listing = await getOwnedListingOr404(id, seller.id)
    if (listing.type !== 'OFFER' || listing.status !== 'ACTIVE') {
      throw new ApiError(409, 'Only active offers can have purchasable variants.')
    }
    const body = await parseBody(_request, bodySchema)
    const seen = new Set<string>()
    const seenSkus = new Set<string>()
    for (const variant of body.variants) {
      if (variant.trackInventory && (variant.stockQuantity === undefined || variant.stockQuantity === null)) {
        throw new ApiError(400, 'Enter a stock quantity when inventory tracking is enabled.')
      }
      const key = JSON.stringify(Object.entries(variant.options)
        .map(([name, value]) => [name.trim().toLowerCase(), value.trim().toLowerCase()])
        .sort(([a], [b]) => String(a).localeCompare(String(b))))
      if (seen.has(key)) throw new ApiError(400, 'Each variant must have a unique option combination.')
      seen.add(key)
      const normalizedSku = variant.sku?.trim().toLowerCase()
      if (normalizedSku && seenSkus.has(normalizedSku)) throw new ApiError(400, 'Each SKU must be unique within this product.')
      if (normalizedSku) seenSkus.add(normalizedSku)
    }

    await db.$transaction(async (tx) => {
      await tx.listingVariant.deleteMany({ where: { listingId: id } })
      if (body.variants.length) {
        await tx.listingVariant.createMany({
          data: body.variants.map((variant, index) => ({
            listingId: id,
            label: variant.label,
            options: variant.options,
            sku: variant.sku || null,
            price: variant.price ?? null,
            stockQuantity: variant.stockQuantity ?? null,
            trackInventory: variant.trackInventory,
            availabilityStatus: variant.availabilityStatus,
            photos: JSON.stringify(sanitizePhotos(variant.photos)),
            sortOrder: index,
          })),
        })
      }
    }, { isolationLevel: 'Serializable' })

    const variants = await db.listingVariant.findMany({
      where: { listingId: id },
      orderBy: { sortOrder: 'asc' },
    })
    return jsonOk({ variants: variants.map((variant) => ({
      ...variant,
      photos: (() => { try { const parsed = JSON.parse(variant.photos); return Array.isArray(parsed) ? parsed : [] } catch { return [] } })(),
    })) })
  })
}
