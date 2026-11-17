import { describe, expect, test } from 'bun:test'
import { standaloneShowroomPatchSchema, standaloneShowroomSchema } from './standalone-schema'
import { SHOWROOM_TEMPLATES } from './templates'

describe('standalone showroom request schemas', () => {
  test('accepts a minimal seller-authored draft', () => {
    const result = standaloneShowroomSchema.safeParse({
      templateId: SHOWROOM_TEMPLATES[0].id,
      title: 'My shop collection',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.photos).toEqual([])
      expect(result.data.listingIds).toEqual([])
    }
  })

  test('rejects duplicate photos and duplicate linked listings', () => {
    const photo = '/uploads/shop-photo.webp'
    const photos = standaloneShowroomSchema.safeParse({
      templateId: SHOWROOM_TEMPLATES[0].id,
      title: 'My shop collection',
      photos: [photo, photo],
    })
    expect(photos.success).toBe(false)

    const listings = standaloneShowroomSchema.safeParse({
      templateId: SHOWROOM_TEMPLATES[0].id,
      title: 'My shop collection',
      listingIds: ['listing-a', 'listing-a'],
    })
    expect(listings.success).toBe(false)
  })

  test('accepts partial edits and rejects an empty patch', () => {
    expect(standaloneShowroomPatchSchema.safeParse({ title: 'Updated title' }).success).toBe(true)
    expect(standaloneShowroomPatchSchema.safeParse({}).success).toBe(false)
  })
})
