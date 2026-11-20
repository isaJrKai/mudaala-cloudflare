import { z } from 'zod'

const money = z.number().finite().min(0).max(100_000_000)
  .refine((value) => Math.round(value * 100) === value * 100, 'Money must have at most two decimal places')
const quantity = z.number().finite().min(0.001).max(10_000_000)
  .refine((value) => Math.round(value * 1000) === value * 1000, 'Quantity must have at most three decimal places')
const stockThreshold = z.number().finite().min(0).max(10_000_000)
  .refine((value) => Math.round(value * 1000) === value * 1000, 'Quantity must have at most three decimal places')

export const businessProductCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  sku: z.string().trim().max(60).optional().nullable(),
  unit: z.string().trim().min(1).max(24).default('piece'),
  currency: z.enum(['UGX']).default('UGX'),
  sellingPrice: money,
  costPrice: money.nullable().optional(),
  reorderLevel: stockThreshold.default(0),
  openingStock: z.number().finite().min(0).max(10_000_000)
    .refine((value) => Math.round(value * 1000) === value * 1000, 'Quantity must have at most three decimal places')
    .default(0),
  trackInventory: z.boolean().default(true),
  // Optional link to one of the seller's own listings: makes the stock
  // record and the public ad point at the same real product. Validated for
  // ownership in the routes; uniqueness is enforced by the schema column.
  listingId: z.string().trim().min(1).max(64).optional().nullable(),
})

export const businessProductUpdateSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  sku: z.string().trim().max(60).nullable().optional(),
  unit: z.string().trim().min(1).max(24).optional(),
  sellingPrice: money.optional(),
  costPrice: money.nullable().optional(),
  trackInventory: z.boolean().optional(),
  reorderLevel: stockThreshold.optional(),
  archived: z.boolean().optional(),
  // Link (string), relink (different string) or unlink (null). One product
  // links to at most one listing and one listing to at most one product.
  listingId: z.string().trim().min(1).max(64).nullable().optional(),
}).refine((value) => Object.keys(value).length > 0, 'Nothing to update')

export const stockMovementSchema = z.object({
  type: z.enum(['RESTOCK', 'RETURN', 'ADJUSTMENT', 'DAMAGE', 'CORRECTION']),
  quantity: quantity,
  direction: z.enum(['ADD', 'REMOVE']).optional(),
  note: z.string().trim().max(300).optional().nullable(),
}).refine((value) => !['ADJUSTMENT', 'CORRECTION'].includes(value.type) || value.direction !== undefined, {
  message: 'Choose whether this adjustment adds or removes stock',
  path: ['direction'],
})

export const saleCreateSchema = z.object({
  idempotencyKey: z.string().uuid().optional(),
  channel: z.enum(['MUDAALA', 'WHATSAPP', 'PHONE', 'IN_PERSON', 'OTHER']).default('OTHER'),
  soldAt: z.string().datetime().optional(),
  notes: z.string().trim().max(500).optional().nullable(),
  items: z.array(z.object({
    productId: z.string().min(1).max(64),
    quantity,
    unitPrice: money.optional(),
  })).min(1).max(50),
}).refine((value) => new Set(value.items.map((item) => item.productId)).size === value.items.length, {
  message: 'Add each product only once per sale',
  path: ['items'],
})

export const saleVoidSchema = z.object({
  reason: z.string().trim().min(3).max(300),
})

export const listingEngagementSchema = z.object({
  event: z.enum(['CALL_CLICK', 'WHATSAPP_CLICK', 'SHARE_CLICK']),
})

// The one serializer for BusinessProduct rows (Prisma Decimal -> number,
// dates -> ISO). Both business-product routes used to carry private copies
// that drifted; keep this the single shape the dashboard consumes.
export interface SerializedBusinessProduct {
  id: string
  name: string
  sku: string | null
  unit: string
  currency: string
  sellingPrice: number
  costPrice: number | null
  stockOnHand: number
  reorderLevel: number
  trackInventory: boolean
  archived: boolean
  listingId: string | null
  listing: { id: string; title: string; status: string; availabilityStatus: string } | null
  createdAt: string
  updatedAt: string
}

interface ProductRowWithListing {
  id: string
  name: string
  sku: string | null
  unit: string
  currency: string
  sellingPrice: { toString(): string }
  costPrice: { toString(): string } | null
  stockOnHand: { toString(): string }
  reorderLevel: { toString(): string }
  trackInventory: boolean
  archived: boolean
  listingId: string | null
  listing: { id: string; title: string; status: string; availabilityStatus: string } | null
  createdAt: Date
  updatedAt: Date
}

export function serializeProduct(product: ProductRowWithListing): SerializedBusinessProduct {
  return {
    id: product.id,
    name: product.name,
    sku: product.sku,
    unit: product.unit,
    currency: product.currency,
    sellingPrice: Number(product.sellingPrice),
    costPrice: product.costPrice === null ? null : Number(product.costPrice),
    stockOnHand: Number(product.stockOnHand),
    reorderLevel: Number(product.reorderLevel),
    trackInventory: product.trackInventory,
    archived: product.archived,
    listingId: product.listingId,
    listing: product.listing,
    createdAt: product.createdAt.toISOString(),
    updatedAt: product.updatedAt.toISOString(),
  }
}

// True when a tracked product linked to a public ad has run out of stock while
// the ad still tells buyers it is available. The dashboard surfaces this
// honestly instead of silently flipping the public listing (an automatic
// public change needs its own reviewed product decision).
export function linkedAdShowsAvailableWhileOutOfStock(product: {
  trackInventory: boolean
  stockOnHand: number
  listing: { availabilityStatus: string } | null
}): boolean {
  return Boolean(
    product.trackInventory &&
    product.listing &&
    product.stockOnHand <= 0 &&
    product.listing.availabilityStatus !== 'OUT_OF_STOCK',
  )
}
