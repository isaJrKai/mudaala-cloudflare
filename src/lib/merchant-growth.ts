/**
 * Deterministic, explainable merchant recommendations.
 *
 * This module deliberately accepts a server-built snapshot rather than querying
 * the database itself. That keeps the decision rules unit-testable and prevents
 * client-supplied shop facts from influencing recommendations.
 */
export type MerchantGrowthSnapshot = {
  shopExists: boolean
  activeProducts: Array<{ id: string; title: string; photoCount: number }>
  profile: {
    photoUrl: string | null
    description: string | null
    area: string | null
    hours: string | null
    whatsapp: string | null
    shopCode: string | null
  } | null
  posterGeneratedAt: Date | null
  posterSharedAt: Date | null
}

export type GrowthRecommendation = {
  key: string
  type: 'GROWTH_ADD_FIRST_PRODUCT' | 'GROWTH_ADD_PRODUCT_PHOTOS' | 'GROWTH_COMPLETE_PROFILE' | 'GROWTH_CREATE_POSTER' | 'GROWTH_SHARE_POSTER' | 'GROWTH_ADD_PRODUCT'
  title: string
  body: string
  actionLabel: string
  actionUrl: string
  priority: 'NORMAL' | 'HIGH'
  reason: string
}

const DESTINATIONS = {
  publish: '/#/publish',
  profile: '/#/account',
  poster: '/#/home',
} as const

/**
 * Return the single highest-priority useful action. No recommendation is
 * emitted for a signal the snapshot cannot establish.
 */
export function recommendNextMerchantAction(snapshot: MerchantGrowthSnapshot): GrowthRecommendation | null {
  if (!snapshot.shopExists || !snapshot.profile) return null

  if (snapshot.activeProducts.length === 0) {
    return {
      key: 'add-first-product',
      type: 'GROWTH_ADD_FIRST_PRODUCT',
      title: 'Give customers something to discover',
      body: 'Your shop is ready. Add your first product with a clear photo and price.',
      actionLabel: 'Add your first product',
      actionUrl: DESTINATIONS.publish,
      priority: 'HIGH',
      reason: 'NO_ACTIVE_PRODUCTS',
    }
  }

  const withoutPhotos = snapshot.activeProducts.find((product) => product.photoCount === 0)
  if (withoutPhotos) {
    return {
      key: `add-photos:${withoutPhotos.id}`,
      type: 'GROWTH_ADD_PRODUCT_PHOTOS',
      title: 'Show customers what you sell',
      body: `Add a photo to “${withoutPhotos.title}” so customers can see it before contacting you.`,
      actionLabel: 'Add product photos',
      actionUrl: `/#/edit/${encodeURIComponent(withoutPhotos.id)}`,
      priority: 'HIGH',
      reason: 'ACTIVE_PRODUCT_WITHOUT_PHOTO',
    }
  }

  const profile = snapshot.profile
  const missingProfileDetails = [
    !profile.photoUrl,
    !profile.description?.trim(),
    !profile.area?.trim(),
    !profile.hours?.trim(),
    !profile.whatsapp?.trim(),
  ].filter(Boolean).length

  if (missingProfileDetails > 0) {
    return {
      key: 'complete-shop-profile',
      type: 'GROWTH_COMPLETE_PROFILE',
      title: 'Make your shop easier to trust',
      body: `Complete ${missingProfileDetails} missing shop detail${missingProfileDetails === 1 ? '' : 's'} so customers know who you are and how to reach you.`,
      actionLabel: 'Complete my shop',
      actionUrl: DESTINATIONS.profile,
      priority: 'NORMAL',
      reason: 'SHOP_PROFILE_INCOMPLETE',
    }
  }

  if (!snapshot.posterGeneratedAt) {
    return {
      key: 'create-shop-poster',
      type: 'GROWTH_CREATE_POSTER',
      title: 'Put your shop on the map',
      body: 'Create your Mudaala shop poster with its QR code, ready to share or print.',
      actionLabel: 'Create shop poster',
      actionUrl: DESTINATIONS.poster,
      priority: 'NORMAL',
      reason: 'POSTER_NOT_GENERATED',
    }
  }

  if (!snapshot.posterSharedAt) {
    return {
      key: 'share-shop-poster',
      type: 'GROWTH_SHARE_POSTER',
      title: 'Help customers find your shop',
      body: 'Your shop poster is ready. Share it on WhatsApp or print it where customers can see it.',
      actionLabel: 'Share shop poster',
      actionUrl: DESTINATIONS.poster,
      priority: 'NORMAL',
      reason: 'POSTER_NOT_SHARED',
    }
  }

  return null
}
