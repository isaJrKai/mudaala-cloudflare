import { route, jsonOk, requireUser } from '@/lib/api'
import { db } from '@/lib/db'
import { offerIsAvailable } from '@/lib/mvp-affiliates'

export async function GET() {
  return route(async () => {
    const user = await requireUser('Sign in to explore opportunities to become an MVP')
    const offers = await db.affiliateOffer.findMany({
      where: {
        merchantId: { not: user.id },
        status: 'ACTIVE',
        listing: { type: 'OFFER', status: 'ACTIVE', isSeed: false, expiresAt: { gt: new Date() }, user: { suspendedAt: null, profile: { is: { moderationStatus: 'ACTIVE', isSeed: false } } } },
      },
      include: {
        listing: {
          select: {
            id: true, title: true, description: true, price: true, currency: true, photos: true, category: true,
            county: true, area: true, expiresAt: true,
            user: { select: { id: true, name: true, profile: { select: { businessName: true, area: true, county: true } } } },
          },
        },
        partnerships: { where: { mvpId: user.id }, select: { id: true, status: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    })
    const now = new Date()
    return jsonOk({
      offers: offers.filter((offer) => offerIsAvailable(offer, now)).map((offer) => ({
        id: offer.id,
        commissionType: offer.commissionType,
        commissionValue: Number(offer.commissionValue),
        currency: offer.currency,
        applicationMode: offer.applicationMode,
        attributionWindowDays: offer.attributionWindowDays,
        termsText: offer.termsText,
        listing: offer.listing,
        existingPartnership: offer.partnerships[0] ?? null,
        merchantName: offer.listing.user.profile?.businessName?.trim() || offer.listing.user.name,
      })),
    })
  })
}
