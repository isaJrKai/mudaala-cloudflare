import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { businessProfileSchema, containsMarketplaceEmoji } from './validation'

describe('Mudaala marketplace content policy', () => {
  it('detects cake emoji and common emoji forms', () => {
    assert.equal(containsMarketplaceEmoji('Annet cakes 🎂'), true)
    assert.equal(containsMarketplaceEmoji('Fresh fruit 🇺🇬'), true)
    assert.equal(containsMarketplaceEmoji('Special 1️⃣ offer'), true)
  })

  it('preserves ordinary punctuation and local business wording', () => {
    assert.equal(containsMarketplaceEmoji('Annet Cakes & Bakery'), false)
    assert.equal(containsMarketplaceEmoji("O'Neil Cakes - Kampala"), false)
    assert.equal(containsMarketplaceEmoji('Kampala Furniture & Interiors'), false)
  })

  it('rejects emoji in a business name with a clear correction message', () => {
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
    assert.equal(result.success, false)
    if (!result.success) {
      assert.ok(result.error.issues.some((issue) => issue.path.includes('businessName') && issue.message.includes('Remove emojis')))
    }
  })

  it('accepts the shop name once only the emoji is removed', () => {
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
    assert.equal(result.success, true)
  })
})
