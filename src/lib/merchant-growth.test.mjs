import { describe, expect, it } from 'bun:test'
import { recommendMerchantActions, recommendNextMerchantAction } from './merchant-growth.ts'

const completeProfile = {
  photoUrl: 'https://example.test/shop.jpg',
  description: 'A neighbourhood shop',
  area: 'Kampala',
  hours: 'Mon-Sat',
  whatsapp: '+256700000000',
  shopCode: 'MD-1234',
}

const base = {
  shopExists: true,
  shopId: 'merchant-1',
  profile: completeProfile,
  posterGeneratedAt: null,
  posterSharedAt: null,
  posterShareInitiatedAt: null,
  latestPhotoAddedAt: null,
  latestPhotoListingId: null,
  latestPhotoListingTitle: null,
  productPhotosShareInitiatedAt: null,
}

describe('merchant Growth Coach recommendations', () => {
  it('does not invent a shop when no profile exists', () => {
    expect(recommendNextMerchantAction({
      ...base, shopExists: false, activeProducts: [], profile: null,
    })).toBeNull()
  })

  it('prioritizes the first product for an empty shop', () => {
    const result = recommendNextMerchantAction({ ...base, activeProducts: [] })
    expect(result?.type).toBe('GROWTH_ADD_FIRST_PRODUCT')
    expect(result?.actionUrl).toBe('/#/publish')
    expect(result?.priority).toBe('HIGH')
  })

  it('asks for photos on a real active product before profile polish', () => {
    const result = recommendNextMerchantAction({
      ...base,
      activeProducts: [{ id: 'listing-1', title: 'Rice', photoCount: 0 }],
      profile: { ...completeProfile, description: null },
    })
    expect(result?.type).toBe('GROWTH_ADD_PRODUCT_PHOTOS')
    expect(result?.actionUrl).toContain('/#/edit/listing-1')
  })

  it('recommends profile completion when product photos are present', () => {
    const result = recommendNextMerchantAction({
      ...base,
      activeProducts: [
        { id: 'listing-1', title: 'Rice', photoCount: 2 },
        { id: 'listing-2', title: 'Beans', photoCount: 1 },
        { id: 'listing-3', title: 'Sugar', photoCount: 1 },
      ],
      profile: { ...completeProfile, hours: null },
    })
    expect(result?.type).toBe('GROWTH_COMPLETE_PROFILE')
    expect(result?.body).toContain('1 missing shop detail')
  })

  it('distinguishes poster generation from an actual share event', () => {
    const snapshot = {
      ...base,
      activeProducts: [{ id: 'listing-1', title: 'Rice', photoCount: 1 }],
      posterGeneratedAt: new Date('2026-11-01T08:00:00Z'),
    }
    expect(recommendMerchantActions(snapshot).map((item) => item.type)).toContain('GROWTH_SHARE_POSTER')
    expect(recommendMerchantActions({ ...snapshot, posterSharedAt: new Date() }).map((item) => item.type)).not.toContain('GROWTH_SHARE_POSTER')
  })

  it('offers different eligible actions across the three daily slots', () => {
    const actions = recommendMerchantActions({
      ...base,
      profile: { ...completeProfile, hours: null },
      activeProducts: [{ id: 'listing-1', title: 'Rice', photoCount: 1 }],
    })
    expect(actions.map((item) => item.key)).toEqual([
      'complete-shop-profile',
      'create-shop-poster',
      'add-another-product',
    ])
  })

  it('recommends sharing product photos after a merchant adds them', () => {
    const actions = recommendMerchantActions({
      ...base,
      activeProducts: [{ id: 'listing-7', title: 'Fresh tomatoes', photoCount: 3 }],
      latestPhotoAddedAt: new Date('2026-11-06T07:00:00Z'),
      latestPhotoListingId: 'listing-7',
      latestPhotoListingTitle: 'Fresh tomatoes',
    })
    const share = actions.find((item) => item.type === 'GROWTH_SHARE_PRODUCT_PHOTOS')
    expect(share?.actionUrl).toBe('/#/listing/listing-7')
    expect(recommendMerchantActions({
      ...base,
      activeProducts: [{ id: 'listing-7', title: 'Fresh tomatoes', photoCount: 3 }],
      latestPhotoAddedAt: new Date('2026-11-06T07:00:00Z'),
      latestPhotoListingId: 'listing-7',
      latestPhotoListingTitle: 'Fresh tomatoes',
      productPhotosShareInitiatedAt: new Date('2026-11-06T07:30:00Z'),
    }).map((item) => item.type)).not.toContain('GROWTH_SHARE_PRODUCT_PHOTOS')
  })

  it('routes poster actions to the merchant shop', () => {
    const action = recommendMerchantActions({
      ...base,
      activeProducts: [{ id: 'listing-1', title: 'Rice', photoCount: 1 }],
    }).find((item) => item.type === 'GROWTH_CREATE_POSTER')
    expect(action?.actionUrl).toBe('/#/shop/merchant-1')
  })
})
