import { describe, expect, it } from 'bun:test'
import { recommendNextMerchantAction } from './merchant-growth.ts'

const completeProfile = {
  photoUrl: 'https://example.test/shop.jpg',
  description: 'A neighbourhood shop',
  area: 'Kampala',
  hours: 'Mon-Sat',
  whatsapp: '+256700000000',
  shopCode: 'MD-1234',
}

describe('recommendNextMerchantAction', () => {
  it('does not invent a shop when no profile exists', () => {
    expect(recommendNextMerchantAction({
      shopExists: false, activeProducts: [], profile: null,
      posterGeneratedAt: null, posterSharedAt: null,
    })).toBeNull()
  })

  it('prioritizes the first product for an empty shop', () => {
    const result = recommendNextMerchantAction({
      shopExists: true, shopId: 'merchant-1', activeProducts: [], profile: completeProfile,
      posterGeneratedAt: null, posterSharedAt: null,
    })
    expect(result?.type).toBe('GROWTH_ADD_FIRST_PRODUCT')
    expect(result?.actionUrl).toBe('/#/publish')
    expect(result?.priority).toBe('HIGH')
  })

  it('asks for photos on a real active product before profile polish', () => {
    const result = recommendNextMerchantAction({
      shopExists: true, shopId: 'merchant-1',
      activeProducts: [{ id: 'listing-1', title: 'Rice', photoCount: 0 }],
      profile: { ...completeProfile, description: null },
      posterGeneratedAt: null, posterSharedAt: null,
    })
    expect(result?.type).toBe('GROWTH_ADD_PRODUCT_PHOTOS')
    expect(result?.actionUrl).toContain('/#/edit/listing-1')
  })

  it('recommends profile completion only when the product catalogue has photos', () => {
    const result = recommendNextMerchantAction({
      shopExists: true,
      activeProducts: [{ id: 'listing-1', title: 'Rice', photoCount: 2 }],
      profile: { ...completeProfile, hours: null },
      posterGeneratedAt: null, posterSharedAt: null,
    })
    expect(result?.type).toBe('GROWTH_COMPLETE_PROFILE')
    expect(result?.body).toContain('1 missing shop detail')
  })

  it('distinguishes poster generation from an actual share event', () => {
    const snapshot = {
      shopExists: true,
      activeProducts: [{ id: 'listing-1', title: 'Rice', photoCount: 1 }],
      profile: completeProfile,
      posterGeneratedAt: new Date('2026-11-01T08:00:00Z'),
      posterSharedAt: null,
    }
    expect(recommendNextMerchantAction(snapshot)?.type).toBe('GROWTH_SHARE_POSTER')
    expect(recommendNextMerchantAction({ ...snapshot, posterSharedAt: new Date() })).toBeNull()
  })
})
