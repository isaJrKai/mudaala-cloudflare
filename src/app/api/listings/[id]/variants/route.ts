import { z } from 'zod'
import { ApiError, jsonOk, parseBody, requireSeller, route } from '@/lib/api'
import { db } from '@/lib/db'
import { getOwnedListingOr404, sanitizePhotos } from '@/lib/listings'

type Params = { params: Promise<{ id: string }> }

export async function GET(_request: Request, { params }: Params) {
  return route(async () => {
    const seller = await requireSeller()
    const { id } = await params
    await getOwnedListingOr404(id, seller.id)
    const [variants, products] = await Promise.all([
      db.listingVariant.findMany({
        where: { listingId: id },
        include: { businessProduct: { select: { id: true, name: true, sku: true, stockOnHand: true, trackInventory: true } } },
        orderBy: { sortOrder: 'asc' },
      }),
      db.businessProduct.findMany({
        where: { userId: seller.id, archived: false, trackInventory: true },
        select: { id: true, name: true, sku: true, stockOnHand: true, listingId: true, listingVariantId: true },
        orderBy: { name: 'asc' },
      }),
    ])
    return jsonOk({
      variants: variants.map((variant) => ({
        ...variant,
        businessProduct: variant.businessProduct ? { ...variant.businessProduct, stockOnHand: Number(variant.businessProduct.stockOnHand) } : null,
        photos: (() => { try { const parsed = JSON.parse(variant.photos); return Array.isArray(parsed) ? parsed : [] } catch { return [] } })(),
      })),
      inventoryProducts: products.map((product) => ({ ...product, stockOnHand: Number(product.stockOnHand) })),
    })
  })
}

const variantSchema = z.object({
  label: z.string().trim().min(1).max(120),
  options: z.record(z.string(), z.string().trim().min(1).max(80)).refine((value) => Object.keys(value).length > 0),
  sku: z.string().trim().min(1).max(64).nullable().optional(),
  price: z.number().finite().positive().nullable().optional(),
  stockQuantity: z.number().finite().min(0).nullable().optional(),
  trackInventory: z.boolean().default(false),
  availabilityStatus: z.enum(['UNKNOWN', 'IN_STOCK', 'AVAILABLE_ON_ORDER', 'OUT_OF_STOCK']).default('UNKNOWN'),
  photos: z.array(z.string().trim().min(1).max(2048)).max(8).default([]),
  businessProductId: z.string().trim().min(1).max(128).nullable().optional(),
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
      const existing = await tx.listingVariant.findMany({ where: { listingId: id } })
      const keptIds = new Set<string>()
      const optionKey = (options: Record<string, string>) => JSON.stringify(Object.entries(options)
        .map(([name, value]) => [name.trim().toLowerCase(), value.trim().toLowerCase()])
        .sort(([a], [b]) => String(a).localeCompare(String(b))))

      for (const [index, variant] of body.variants.entries()) {
        const incomingKey = optionKey(variant.options)
        const match = existing.find((entry) =>
          (variant.sku && entry.sku?.toLowerCase() === variant.sku.toLowerCase()) ||
          optionKey(entry.options as Record<string, string>) === incomingKey
        )
        const values = {
          label: variant.label,
          options: variant.options,
          sku: variant.sku || null,
          price: variant.price ?? null,
          stockQuantity: variant.stockQuantity ?? null,
          trackInventory: variant.trackInventory,
          availabilityStatus: variant.availabilityStatus,
          photos: JSON.stringify(sanitizePhotos(variant.photos)),
          sortOrder: index,
        }
        const saved = match
          ? await tx.listingVariant.update({ where: { id: match.id }, data: values })
          : await tx.listingVariant.create({ data: { listingId: id, ...values } })
        keptIds.add(saved.id)

        if (variant.businessProductId !== undefined) {
          if (variant.businessProductId === null) {
            await tx.businessProduct.updateMany({
              where: { userId: seller.id, listingVariantId: saved.id },
              data: { listingVariantId: null },
            })
          } else {
            const product = await tx.businessProduct.findFirst({
              where: { id: variant.businessProductId, userId: seller.id, archived: false },
            })
            if (!product) throw new ApiError(404, 'Choose a stock product from your own active inventory.')
            if (!product.trackInventory) throw new ApiError(409, 'Turn on inventory tracking for this stock product before linking it to a variant.')
            if (product.listingId && product.listingId !== id) {
              throw new ApiError(409, 'That stock product is already attached to another listing.')
            }
            if (product.listingVariantId && product.listingVariantId !== saved.id) {
              throw new ApiError(409, 'That stock product is already linked to another variant.')
            }
            await tx.businessProduct.update({
              where: { id: product.id },
              data: { listingVariantId: saved.id },
            })
            if (!saved.trackInventory) {
              await tx.listingVariant.update({ where: { id: saved.id }, data: { trackInventory: true } })
            }
          }
        }
      }

      await tx.listingVariant.deleteMany({
        where: { listingId: id, ...(keptIds.size ? { id: { notIn: [...keptIds] } } : {}) },
      })
    }, { isolationLevel: 'Serializable' })

    const variants = await db.listingVariant.findMany({
      where: { listingId: id },
      include: { businessProduct: { select: { id: true, name: true, sku: true, stockOnHand: true, trackInventory: true } } },
      orderBy: { sortOrder: 'asc' },
    })
    return jsonOk({ variants: variants.map((variant) => ({
      ...variant,
      businessProduct: variant.businessProduct ? { ...variant.businessProduct, stockOnHand: Number(variant.businessProduct.stockOnHand) } : null,
      photos: (() => { try { const parsed = JSON.parse(variant.photos); return Array.isArray(parsed) ? parsed : [] } catch { return [] } })(),
    })) })
  })
}
