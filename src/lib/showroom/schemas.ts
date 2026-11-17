import { z } from 'zod'
import { containsMarketplaceEmoji } from '@/lib/validation'
import { findComposition } from './compositions'
import { MAX_HIGHLIGHTS, MAX_SHOWROOM_PRODUCTS } from './constants'
import { SHOWROOM_PURPOSES } from './types'

const id = z.string().trim().min(1).max(128)

const title = z.string().trim().min(3, 'Title must be at least 3 characters').max(80, 'Title must be 80 characters or fewer')
  .refine((v) => !containsMarketplaceEmoji(v), 'Please use words in the title, not emojis.')
const introduction = z.string().trim().max(600, 'Introduction must be 600 characters or fewer')
  .refine((v) => !containsMarketplaceEmoji(v), 'Please use words in the introduction, not emojis.')
const styleKey = z.string().trim().max(40)
  .refine((v) => findComposition(v) !== undefined, 'Choose one of the available presentation styles')
const listingIds = z.array(id).min(1, 'Choose at least one product').max(MAX_SHOWROOM_PRODUCTS, `A showroom can hold up to ${MAX_SHOWROOM_PRODUCTS} products`)
  .refine((v) => new Set(v).size === v.length, 'Each product can appear only once')
const highlights = z.array(id).max(MAX_HIGHLIGHTS, `Highlight up to ${MAX_HIGHLIGHTS} products`)
  .refine((v) => new Set(v).size === v.length, 'Each highlight can appear only once')

export const showroomCreateSchema = z.object({
  title,
  introduction: introduction.nullable().optional(),
  introSource: z.enum(['MERCHANT', 'SUGGESTED']).optional(),
  purpose: z.enum(SHOWROOM_PURPOSES).optional(),
  styleKey: styleKey.nullable().optional(),
  listingIds,
  highlights: highlights.optional(),
}).strict()

export const showroomUpdateSchema = z.object({
  title: title.optional(),
  introduction: introduction.nullable().optional(),
  introSource: z.enum(['MERCHANT', 'SUGGESTED']).optional(),
  purpose: z.enum(SHOWROOM_PURPOSES).optional(),
  styleKey: styleKey.nullable().optional(),
  listingIds: listingIds.optional(),
  highlights: highlights.optional(),
  status: z.enum(['DRAFT', 'PUBLISHED']).optional(),
}).strict().refine((v) => Object.keys(v).length > 0, 'Provide at least one field to update')

export type ShowroomCreateInput = z.infer<typeof showroomCreateSchema>
export type ShowroomUpdateInput = z.infer<typeof showroomUpdateSchema>
