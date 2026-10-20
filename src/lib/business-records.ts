import { z } from 'zod'

const money = z.number().finite().min(0).max(100_000_000)
  .refine((value) => Math.round(value * 100) === value * 100, 'Money must have at most two decimal places')
const quantity = z.number().finite().min(0.001).max(10_000_000)
  .refine((value) => Math.round(value * 1000) === value * 1000, 'Quantity must have at most three decimal places')

export const businessProductCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  sku: z.string().trim().max(60).optional().nullable(),
  unit: z.string().trim().min(1).max(24).default('piece'),
  currency: z.enum(['UGX']).default('UGX'),
  sellingPrice: money,
  costPrice: money.nullable().optional(),
  openingStock: z.number().finite().min(0).max(10_000_000)
    .refine((value) => Math.round(value * 1000) === value * 1000, 'Quantity must have at most three decimal places')
    .default(0),
  trackInventory: z.boolean().default(true),
})

export const businessProductUpdateSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  sku: z.string().trim().max(60).nullable().optional(),
  unit: z.string().trim().min(1).max(24).optional(),
  sellingPrice: money.optional(),
  costPrice: money.nullable().optional(),
  trackInventory: z.boolean().optional(),
  archived: z.boolean().optional(),
}).refine((value) => Object.keys(value).length > 0, 'Nothing to update')

export const stockMovementSchema = z.object({
  type: z.enum(['RESTOCK', 'RETURN', 'ADJUSTMENT', 'DAMAGE', 'CORRECTION']),
  quantity: quantity,
  direction: z.enum(['ADD', 'REMOVE']).optional(),
  note: z.string().trim().max(300).optional().nullable(),
}).refine((value) => value.type !== 'ADJUSTMENT' || value.direction !== undefined, {
  message: 'Choose whether this adjustment adds or removes stock',
  path: ['direction'],
})

export const saleCreateSchema = z.object({
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
