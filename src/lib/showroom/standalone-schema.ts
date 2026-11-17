import { z } from 'zod'
import { SHOWROOM_TEMPLATE_IDS } from './templates'

const photo = z.string().trim().min(1).max(1000).refine(
  (value) => value.startsWith('/uploads/') || /^https:\/\/\S+$/i.test(value),
  'Use a photo uploaded to Mudaala.',
)
const copy = (max: number) => z.string().trim().max(max)
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional()

export const showroomSectionSchema = z.object({
  heading: copy(100).optional(),
  body: copy(1200).optional(),
  photoUrl: photo.nullable().optional(),
}).strict()

const standaloneShowroomBaseSchema = z.object({
  templateId: z.enum(SHOWROOM_TEMPLATE_IDS as [string, ...string[]]),
  title: z.string().trim().min(2).max(100),
  headline: copy(140).nullable().optional(),
  introduction: copy(1000).nullable().optional(),
  story: copy(5000).nullable().optional(),
  logoUrl: photo.nullable().optional(),
  primaryColor: color,
  accentColor: color,
  coverPhotoUrl: photo.nullable().optional(),
  photos: z.array(photo).max(16).default([]),
  sections: z.array(showroomSectionSchema).max(8).default([]),
  listingIds: z.array(z.string().trim().min(1).max(128)).max(60).default([]),
  status: z.enum(['DRAFT', 'PUBLISHED']).optional(),
}).strict()

export const standaloneShowroomSchema = standaloneShowroomBaseSchema
  .refine((value) => new Set(value.photos).size === value.photos.length, {
    message: 'Remove duplicate photos.',
    path: ['photos'],
  })
  .refine((value) => new Set(value.listingIds).size === value.listingIds.length, {
    message: 'A product can only be linked once.',
    path: ['listingIds'],
  })

export const standaloneShowroomPatchSchema = standaloneShowroomBaseSchema.partial()
  .refine((value) => Object.keys(value).length > 0, 'Provide at least one field to update.')
  .refine((value) => !value.photos || new Set(value.photos).size === value.photos.length, {
    message: 'Remove duplicate photos.',
    path: ['photos'],
  })
  .refine((value) => !value.listingIds || new Set(value.listingIds).size === value.listingIds.length, {
    message: 'A product can only be linked once.',
    path: ['listingIds'],
  })

export type StandaloneShowroomInput = z.infer<typeof standaloneShowroomSchema>
