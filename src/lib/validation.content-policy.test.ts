import { describe, expect, test } from 'bun:test'
import { businessProfileSchema, containsMarketplaceEmoji } from './validation'

describe('Mudaala marketplace content policy', () => {
  test('detects common emoji, including cake, flags and keycaps', () => {
    expect(containsMarketplaceEmoji('Annet cakes 🎂')).toBe(true)
    expect(containsMarketplaceEmoji('Fresh fruit 🇺🇬')).toBe(true)
    expect(containsMarketplaceEmoji('Special 1️⃣ offer')).toBe(true)
  })

  test('preserves ordinary business-name punctuation and local wording', () => {
    expect(containsMarketplaceEmoji("Annet Cakes & Bakery")).toBe(false)
    expect(containsMarketplaceEmoji("O'Neil Cakes - Kampala")).toBe(false)
    expect(containsMarketplaceEmoji('Kampala Furniture & Interiors')).toBe(false)
  })

  test('rejects emoji in a business name with a clear correction message', () => {
    const result = businessProfileSchema.safeParse({
      businessName: 'Annet cakes 🎂',
      photoUrl: null,
      category: null,
      description: null,
      county: 'Kampala',
      area: null,
      phone: '0772345678',
      whatsapp: null,
      hours: null,
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path.includes('businessName') && issue.message.includes('Remove emojis'))).toBe(true)
    }
  })

  test('accepts the same shop name once only the emoji is removed', () => {
    const result = businessProfileSchema.safeParse({
      businessName: 'Annet cakes',
      photoUrl: null,
      category: null,
      description: null,
      county: 'Kampala',
      area: null,
      phone: '0772345678',
      whatsapp: null,
      hours: null,
    })
    expect(result.success).toBe(true)
  })
})
