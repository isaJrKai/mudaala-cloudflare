import { randomBytes } from 'node:crypto'
import { route, jsonOk, requireUser, ApiError } from '@/lib/api'
import { db } from '@/lib/db'
import { offerIsAvailable } from '@/lib/mvp-affiliates'

type Context = { params: Promise<{ id: string }> }

export async function POST(_request: Request, context: Context) {
  return route(async () => {
    const user = await requireUser('Sign in to become an MVP')
    const { id } = await context.params
    const offer = await db.affiliateOffer.findUnique({
      where: { id },
      include: { listing: { select: { id: true, userId: true, status: true, type: true, isSeed: true, expiresAt: true, user: { select: { suspendedAt: true, profile: { select: { moderationStatus: true, isSeed: true } } } } } } },
    })
    const now = new Date()
    if (!offer || !offerIsAvailable(offer, now) || offer.listing.type !== 'OFFER' || offer.listing.status !== 'ACTIVE' || offer.listing.isSeed || offer.listing.expiresAt <= now || offer.listing.user.suspendedAt || offer.listing.user.profile?.moderationStatus !== 'ACTIVE' || offer.listing.user.profile?.isSeed) {
      throw new ApiError(404, 'This opportunity is no longer available.')
    }
    if (offer.merchantId === user.id) throw new ApiError(409, 'You cannot become an MVP for your own shop.')
    const existing = await db.affiliatePartnership.findUnique({
      where: { offerId_mvpId: { offerId: id, mvpId: user.id } },
      include: { referral: true },
    })
    if (existing) throw new ApiError(409, existing.status === 'PENDING' ? 'Your request is waiting for the shop to respond.' : 'You have already responded to this opportunity.')
    const approved = offer.applicationMode === 'OPEN'
    const partnership = await db.affiliatePartnership.create({
      data: {
        offerId: offer.id,
        mvpId: user.id,
        status: approved ? 'APPROVED' : 'PENDING',
        acceptedCommissionType: offer.commissionType,
        acceptedCommissionValue: offer.commissionValue,
        acceptedCurrency: offer.currency,
        acceptedTermsText: offer.termsText,
        acceptedAt: approved ? now : null,
        ...(approved ? { referral: { create: { code: randomBytes(18).toString('base64url') } } } : {}),
      },
      include: { referral: { select: { code: true } } },
    })
    return jsonOk({
      partnership: { id: partnership.id, status: partnership.status, referralUrl: partnership.referral ? 'https://mudaala.store/r/' + partnership.referral.code : null },
      message: approved ? 'You are now an MVP for this shop. Share your product link to get started.' : 'Your request has been sent to the shop.',
    }, 201)
  })
}
