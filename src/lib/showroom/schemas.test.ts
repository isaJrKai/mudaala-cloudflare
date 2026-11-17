import { describe, expect, it } from 'bun:test'
import { showroomCreateSchema, showroomUpdateSchema } from './schemas'

const ok = { title: 'Summer fashion', listingIds: ['a', 'b'] }

describe('showroomCreateSchema', () => {
  it('accepts the minimal valid payload', () => expect(showroomCreateSchema.safeParse(ok).success).toBe(true))
  it('rejects empty/short titles, emoji, and unknown fields', () => {
    expect(showroomCreateSchema.safeParse({ ...ok, title: 'ab' }).success).toBe(false)
    expect(showroomCreateSchema.safeParse({ ...ok, title: 'Summer \u{1F525} sale' }).success).toBe(false)
    expect(showroomCreateSchema.safeParse({ ...ok, slug: 'my-own-slug' }).success).toBe(false) // slug is server-assigned
    expect(showroomCreateSchema.safeParse({ ...ok, userId: 'someone-else' }).success).toBe(false) // owner is never client-supplied
    expect(showroomCreateSchema.safeParse({ ...ok, status: 'PUBLISHED' }).success).toBe(false) // publish is a separate step
  })
  it('bounds products: 1..60, no duplicates', () => {
    expect(showroomCreateSchema.safeParse({ ...ok, listingIds: [] }).success).toBe(false)
    expect(showroomCreateSchema.safeParse({ ...ok, listingIds: ['a', 'a'] }).success).toBe(false)
    expect(showroomCreateSchema.safeParse({ ...ok, listingIds: Array.from({ length: 61 }, (_, i) => `id${i}`) }).success).toBe(false)
    expect(showroomCreateSchema.safeParse({ ...ok, listingIds: Array.from({ length: 60 }, (_, i) => `id${i}`) }).success).toBe(true)
  })
  it('bounds the introduction and highlights, validates purpose and style', () => {
    expect(showroomCreateSchema.safeParse({ ...ok, introduction: 'x'.repeat(601) }).success).toBe(false)
    expect(showroomCreateSchema.safeParse({ ...ok, introduction: 'x'.repeat(600) }).success).toBe(true)
    expect(showroomCreateSchema.safeParse({ ...ok, highlights: ['a', 'b', 'c', 'd'] }).success).toBe(false)
    expect(showroomCreateSchema.safeParse({ ...ok, purpose: 'NOPE' }).success).toBe(false)
    expect(showroomCreateSchema.safeParse({ ...ok, styleKey: 'not-a-style' }).success).toBe(false)
    expect(showroomCreateSchema.safeParse({ ...ok, styleKey: 'room-story' }).success).toBe(true)
    expect(showroomCreateSchema.safeParse({ ...ok, styleKey: null }).success).toBe(true)
  })
})

describe('showroomUpdateSchema', () => {
  it('requires at least one field and allows publish/unpublish', () => {
    expect(showroomUpdateSchema.safeParse({}).success).toBe(false)
    expect(showroomUpdateSchema.safeParse({ status: 'PUBLISHED' }).success).toBe(true)
    expect(showroomUpdateSchema.safeParse({ status: 'ARCHIVED' }).success).toBe(false)
  })
  it('still forbids slug and owner changes', () => {
    expect(showroomUpdateSchema.safeParse({ slug: 'x-y-z' }).success).toBe(false)
    expect(showroomUpdateSchema.safeParse({ userId: 'u' }).success).toBe(false)
  })
})
