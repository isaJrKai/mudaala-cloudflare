/**
 * Deterministic, explainable merchant recommendations.
 *
 * This module deliberately accepts a server-built snapshot rather than querying
 * the database itself. That keeps the decision rules unit-testable and prevents
 * client-supplied shop facts from influencing recommendations.
 */
export type MerchantGrowthSnapshot = {
  shopExists: boolean
  shopId: string
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
  posterShareInitiatedAt: Date | null
  latestPhotoAddedAt: Date | null
  latestPhotoListingId: string | null
  latestPhotoListingTitle: string | null
  productPhotosShareInitiatedAt: Date | null
}

export type GrowthRecommendation = {
  key: string
  type: 'GROWTH_ADD_FIRST_PRODUCT' | 'GROWTH_ADD_PRODUCT_PHOTOS' | 'GROWTH_COMPLETE_PROFILE' | 'GROWTH_CREATE_POSTER' | 'GROWTH_SHARE_POSTER' | 'GROWTH_ADD_PRODUCT' | 'GROWTH_SHARE_PRODUCT_PHOTOS'
  title: string
  body: string
  actionLabel: string
  actionUrl: string
  priority: 'NORMAL' | 'HIGH'
  reason: string
}

const posterDestination = (shopId: string) => `/#/shop/${encodeURIComponent(shopId)}`

/** Return all currently eligible actions in priority order. */
export function recommendMerchantActions(snapshot: MerchantGrowthSnapshot): GrowthRecommendation[] {
  if (!snapshot.shopExists || !snapshot.profile) return []

  const recommendations: GrowthRecommendation[] = []
  const profile = snapshot.profile

  if (snapshot.activeProducts.length === 0) {
    recommendations.push({
      key: 'add-first-product',
      type: 'GROWTH_ADD_FIRST_PRODUCT',
      title: 'Give customers something to discover',
      body: 'Your shop is ready. Add your first product with a clear photo and price.',
      actionLabel: 'Add your first product',
      actionUrl: '/#/publish',
      priority: 'HIGH',
      reason: 'NO_ACTIVE_PRODUCTS',
    })
  } else {
    const withoutPhotos = snapshot.activeProducts.find((product) => product.photoCount === 0)
    if (withoutPhotos) {
      recommendations.push({
        key: `add-photos:${withoutPhotos.id}`,
        type: 'GROWTH_ADD_PRODUCT_PHOTOS',
        title: 'Show customers what you sell',
        body: `Add a photo to “${withoutPhotos.title}” so customers can see it before contacting you.`,
        actionLabel: 'Add product photos',
        actionUrl: `/#/edit/${encodeURIComponent(withoutPhotos.id)}`,
        priority: 'HIGH',
        reason: 'ACTIVE_PRODUCT_WITHOUT_PHOTO',
      })
    }
  }

  const missingProfileDetails = [
    !profile.photoUrl,
    !profile.description?.trim(),
    !profile.area?.trim(),
    !profile.hours?.trim(),
    !profile.whatsapp?.trim(),
  ].filter(Boolean).length

  if (missingProfileDetails > 0) {
    recommendations.push({
      key: 'complete-shop-profile',
      type: 'GROWTH_COMPLETE_PROFILE',
      title: 'Make your shop easier to trust',
      body: `Complete ${missingProfileDetails} missing shop detail${missingProfileDetails === 1 ? '' : 's'} so customers know who you are and how to reach you.`,
      actionLabel: 'Complete my shop',
      actionUrl: '/#/account',
      priority: 'NORMAL',
      reason: 'SHOP_PROFILE_INCOMPLETE',
    })
  }

  if (snapshot.latestPhotoAddedAt && snapshot.latestPhotoListingId && snapshot.latestPhotoListingTitle) {
    const recentShareAttempt = snapshot.productPhotosShareInitiatedAt && snapshot.productPhotosShareInitiatedAt >= snapshot.latestPhotoAddedAt
      ? Date.now() - snapshot.productPhotosShareInitiatedAt.getTime() < 24 * 60 * 60_000
      : false
    if (!recentShareAttempt) {
      recommendations.push({
        key: `share-product-photos:${snapshot.latestPhotoListingId}`,
        type: 'GROWTH_SHARE_PRODUCT_PHOTOS',
        title: 'Let customers see your new photos',
        body: `You added photos to “${snapshot.latestPhotoListingTitle}”. Share the product so customers can discover it.`,
        actionLabel: 'Share product photos',
        actionUrl: `/#/listing/${encodeURIComponent(snapshot.latestPhotoListingId)}`,
        priority: 'NORMAL',
        reason: 'PRODUCT_PHOTOS_ADDED_NOT_SHARED',
      })
    }
  }

  if (!snapshot.posterGeneratedAt) {
    recommendations.push({
      key: 'create-shop-poster',
      type: 'GROWTH_CREATE_POSTER',
      title: 'Put your shop on the map',
      body: 'Create your Mudaala shop poster with its QR code, ready to share or print.',
      actionLabel: 'Create shop poster',
      actionUrl: posterDestination(snapshot.shopId),
      priority: 'NORMAL',
      reason: 'POSTER_NOT_GENERATED',
    })
  } else if (!snapshot.posterSharedAt) {
    const shareAttemptIsRecent = snapshot.posterShareInitiatedAt && snapshot.posterShareInitiatedAt >= snapshot.posterGeneratedAt
      ? Date.now() - snapshot.posterShareInitiatedAt.getTime() < 24 * 60 * 60_000
      : false
    if (!shareAttemptIsRecent) {
      recommendations.push({
        key: 'share-shop-poster',
        type: 'GROWTH_SHARE_POSTER',
        title: 'Help customers find your shop',
        body: 'Your shop poster is ready. Share it on WhatsApp or print it where customers can see it.',
        actionLabel: 'Share shop poster',
        actionUrl: posterDestination(snapshot.shopId),
        priority: 'NORMAL',
        reason: 'POSTER_NOT_SHARED',
      })
    }
  }

  if (snapshot.activeProducts.length > 0 && snapshot.activeProducts.length < 3) {
    recommendations.push({
      key: 'add-another-product',
      type: 'GROWTH_ADD_PRODUCT',
      title: 'Give customers more choice',
      body: 'Add another product to make your shop more useful to people browsing nearby.',
      actionLabel: 'Add another product',
      actionUrl: '/#/publish',
      priority: 'NORMAL',
      reason: 'SMALL_PRODUCT_CATALOGUE',
    })
  }

  return recommendations
}

/** Return the single highest-priority useful action for the dashboard. */
export function recommendNextMerchantAction(snapshot: MerchantGrowthSnapshot): GrowthRecommendation | null {
  return recommendMerchantActions(snapshot)[0] ?? null
}
