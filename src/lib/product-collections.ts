import { z } from 'zod'

const coverPhotoUrlSchema = z.string().trim().max(500).refine(
  (value) => value.startsWith('/uploads/') || /^https?:\/\/\S+$/i.test(value),
  'Choose an uploaded photo or a valid HTTP(S) image URL',
).nullable()

export const productCollectionCreateSchema = z.object({
  title: z.string().trim().min(1, 'Enter a collection title').max(80),
  description: z.string().trim().max(500).nullable().optional(),
  coverPhotoUrl: coverPhotoUrlSchema.optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(10000).optional(),
}).strict()

export const productCollectionUpdateSchema = z.object({
  title: z.string().trim().min(1, 'Enter a collection title').max(80).optional(),
  description: z.string().trim().max(500).nullable().optional(),
  coverPhotoUrl: coverPhotoUrlSchema.optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(10000).optional(),
}).strict().refine((value) => Object.keys(value).length > 0, 'Provide at least one collection field to update')

export const productCollectionItemCreateSchema = z.object({
  listingId: z.string().trim().min(1).max(128),
  sortOrder: z.number().int().min(0).max(10000).optional(),
}).strict()

const reorderItemSchema = z.object({
  id: z.string().trim().min(1).max(128),
  sortOrder: z.number().int().min(0).max(10000),
}).strict()

export const productCollectionReorderSchema = z.object({
  items: z.array(reorderItemSchema).min(1).max(100),
}).strict().refine((value) => new Set(value.items.map((item) => item.id)).size === value.items.length, 'A collection may appear only once in a reorder request')

export const productCollectionItemReorderSchema = productCollectionReorderSchema
