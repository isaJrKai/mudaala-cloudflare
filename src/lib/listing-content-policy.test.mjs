import { describe, expect, test } from 'bun:test'
import { listingCreateSchema } from './validation'

const cakeEmoji = String.fromCodePoint(127874)
const validListing = {
  type: 'OFFER',
  title: 'Fresh cake for sale',
  description: 'Freshly baked cake made today for your family.',
  category: 'food-groceries',
  price: 1000,
  compareAtPrice: null,
  currency: 'UGX',
  unit: 'piece',
  quantity: 10,
  county: 'Kampala',
  country: 'UG',
  area: null,
  contactPhone: '0772345678',
  contactWhatsapp: null,
  photos: [],
}

describe('Mudaala listing content policy', () => {
  test('rejects emoji in listing titles', () => {
    const result = listingCreateSchema.safeParse({ ...validListing, title: 'Fresh cake ' + cakeEmoji + ' for sale' })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path.includes('title') && issue.message.includes('Remove emojis'))).toBe(true)
    }
  })

  test('rejects emoji in listing descriptions', () => {
    const result = listingCreateSchema.safeParse({ ...validListing, description: 'Freshly baked cake made today ' + cakeEmoji + ' for your family.' })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path.includes('description') && issue.message.includes('remove emojis'))).toBe(true)
    }
  })

  test('accepts plain descriptive listing copy', () => {
    expect(listingCreateSchema.safeParse(validListing).success).toBe(true)
  })
})
