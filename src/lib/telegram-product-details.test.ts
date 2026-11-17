import { describe, expect, test } from 'bun:test'
import { parseTelegramAttributes, resolveTelegramTaxonomyPath } from './telegram-product-details'

describe('Telegram product details', () => {
  test('resolves a full category path to the shared taxonomy node', () => {
    expect(resolveTelegramTaxonomyPath('Phones & Electronics > Phones > Smartphones')?.id).toBe('electronics-smartphones')
    expect(resolveTelegramTaxonomyPath('Clothes & Apparel > Clothing > Dresses')?.id).toBe('fashion-dresses')
    expect(resolveTelegramTaxonomyPath('Phones > Smartphones')).toBeUndefined()
  })

  test('parses category-specific enum and text attributes', () => {
    expect(parseTelegramAttributes('condition=used;storage=128GB;ram=8GB', 'electronics-smartphones')).toEqual({
      condition: 'USED',
      storage: '128GB',
      ram: '8GB',
    })
  })

  test('does not accept attributes outside the selected product type', () => {
    expect(parseTelegramAttributes('condition=USED;madeUp=value', 'electronics-smartphones')).toEqual({
      condition: 'USED',
    })
    expect(parseTelegramAttributes('brand=Apple', undefined)).toBeUndefined()
  })
})
