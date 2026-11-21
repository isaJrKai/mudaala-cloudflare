import { NextResponse } from 'next/server'
import { route, ApiError } from '@/lib/api'
import { db } from '@/lib/db'
import { hit } from '@/lib/rate-limit'

type Context = { params: Promise<{ code: string }> }

export async function GET(request: Request, context: Context) {
  return route(async () => {
    const { code } = await context.params
    if (!/^[A-Za-z0-9_-]{16,128}$/.test(code)) throw new ApiError(404, 'This recommendation link is not available.')
    const referral = await db.affiliateReferral.findUnique({
      where: { code },
      include: {
        partnership: {
          include: {
            offer: {
              include: {
                listing: {
                  select: {
                    id: true, type: true, status: true, isSeed: true, expiresAt: true,
                    user: { select: { suspendedAt: true, profile: { select: { moderationStatus: true, isSeed: true } } } },
                  },
                },
              },
            },
          },
        },
      },
    })
    const now = new Date()
    const { partnership } = referral ?? {}
    const offer = partnership?.offer
    const listing = offer?.listing
    if (!referral || !partnership || partnership.status !== 'APPROVED' || !offer || offer.status !== 'ACTIVE' ||
      (offer.startsAt && offer.startsAt > now) || (offer.endsAt && offer.endsAt <= now) ||
      !listing || listing.type !== 'OFFER' || listing.status !== 'ACTIVE' || listing.isSeed ||
      listing.expiresAt <= now || listing.user.suspendedAt || listing.user.profile?.moderationStatus !== 'ACTIVE' || listing.user.profile?.isSeed) {
      throw new ApiError(404, 'This recommendation link is no longer active.')
    }

    const limit = await hit('mvp-referral:' + referral.id, 500, 60 * 60 * 1000)
    if (limit.ok) {
      await db.affiliateReferral.update({ where: { id: referral.id }, data: { clickCount: { increment: 1 }, lastClickedAt: now } })
    }

    const response = NextResponse.redirect(new URL('/l/' + listing.id, request.url), 302)
    response.cookies.set('mudaala_mvp_referral', referral.code, {
      httpOnly: true,
      secure: new URL(request.url).protocol === 'https:',
      sameSite: 'lax',
      path: '/',
      maxAge: offer.attributionWindowDays * 24 * 60 * 60,
    })
    return response
  })
}
