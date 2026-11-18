import { z } from 'zod'
import { ApiError, jsonOk, parseBody, route } from '@/lib/api'
import { db } from '@/lib/db'
import { getClientIp } from '@/lib/client-ip'
import { hit } from '@/lib/rate-limit'
import { normalizePhone } from '@/lib/validation'
import { chooseSmsProvider, generateResetCode, hashResetCode, hashPhoneForVerification } from '@/lib/sms'
import { hasSameRequestOrigin } from '@/lib/google-oidc'

const CHALLENGE_TTL_MS = 10 * 60 * 1000
const RESPONSE = {
  ok: true,
  message: 'If the details match an active restriction, a verification code has been sent to the registered phone.',
} as const

const schema = z.object({
  targetType: z.enum(['USER', 'SHOP', 'LISTING']),
  targetReference: z.string().trim().min(1).max(120).optional(),
  contact: z.string().trim().min(1).max(30),
})

export async function POST(request: Request) {
  return route(async () => {
    if (!hasSameRequestOrigin(request)) throw new ApiError(403, 'Start phone verification from the Mudaala website')
    const data = await parseBody(request, schema)
    const phone = normalizePhone(data.contact)
    if (!phone) throw new ApiError(400, 'Enter the registered Mudaala phone number, including its country code')

    const ip = getClientIp(request)
    const [phoneLimit, ipLimit] = await Promise.all([
      hit(`appeal-phone:send:phone:${phone}`, 3, 60 * 60 * 1000),
      hit(`appeal-phone:send:ip:${ip}`, 8, 60 * 60 * 1000),
    ])
    if (!phoneLimit.ok || !ipLimit.ok) throw new ApiError(429, 'Too many verification requests. Please try again later.')

    let owner: { id: string; phone: string } | null = null
    if (data.targetType === 'USER') {
      owner = await db.user.findFirst({
        where: { phone, suspendedAt: { not: null } },
        select: { id: true, phone: true },
      })
    } else if (data.targetType === 'SHOP') {
      const shopCode = (data.targetReference ?? '').toUpperCase()
      const shop = await db.businessProfile.findUnique({
        where: { shopCode },
        select: { moderationStatus: true, user: { select: { id: true, phone: true } } },
      })
      if (shop?.moderationStatus === 'HIDDEN' && shop.user.phone === phone) owner = shop.user
    } else {
      const listing = await db.listing.findUnique({
        where: { id: data.targetReference ?? '' },
        select: { status: true, user: { select: { id: true, phone: true } } },
      })
      if (listing?.status === 'HIDDEN' && listing.user.phone === phone) owner = listing.user
    }

    // Do not reveal whether a phone, account, shop or listing exists.
    if (owner) {
      const now = new Date()
      const code = generateResetCode()
      const challenge = await db.$transaction(async (tx) => {
        await tx.appealPhoneVerificationChallenge.updateMany({
          where: { userId: owner!.id, usedAt: null },
          data: { usedAt: now },
        })
        return tx.appealPhoneVerificationChallenge.create({
          data: {
            userId: owner!.id,
            phoneHash: hashPhoneForVerification(owner!.phone),
            codeHash: hashResetCode(code),
            expiresAt: new Date(now.getTime() + CHALLENGE_TTL_MS),
          },
          select: { id: true },
        })
      })

      try {
        await chooseSmsProvider().send(
          owner.phone,
          `Your Mudaala appeal verification code is ${code}. It expires in 10 minutes. Do not share this code with anyone.`,
        )
      } catch {
        await db.appealPhoneVerificationChallenge.updateMany({
          where: { id: challenge.id, usedAt: null },
          data: { usedAt: new Date() },
        })
        console.error('[appeals] phone verification SMS delivery failed')
      }
    }

    return jsonOk(RESPONSE)
  })
}
