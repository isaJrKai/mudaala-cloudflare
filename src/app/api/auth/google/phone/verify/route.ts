import { z } from 'zod'
import { ApiError, jsonOk, parseBody, route, requireUser } from '@/lib/api'
import { db } from '@/lib/db'
import { hit } from '@/lib/rate-limit'
import { getClientIp } from '@/lib/client-ip'
import { resetCodeMatches, hashPhoneForVerification } from '@/lib/sms'

const bodySchema = z.object({ code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code') })

export async function POST(request: Request) {
  return route(async () => {
    const user = await requireUser('Sign in before verifying your phone')
    const data = await parseBody(request, bodySchema)
    const [userLimit, ipLimit] = await Promise.all([
      hit(`google-phone:verify:user:${user.id}`, 5, 10 * 60 * 1000),
      hit(`google-phone:verify:ip:${getClientIp(request)}`, 12, 10 * 60 * 1000),
    ])
    if (!userLimit.ok || !ipLimit.ok) {
      throw new ApiError(429, 'Too many code attempts. Please wait before trying again')
    }

    const now = new Date()
    const challenge = await db.phoneVerificationChallenge.findFirst({
      where: { userId: user.id, phoneHash: hashPhoneForVerification(user.phone), usedAt: null, expiresAt: { gt: now }, attempts: { lt: 5 } },
      orderBy: { createdAt: 'desc' },
    })
    if (!challenge) throw new ApiError(400, 'That security code has expired. Request a new one')

    if (!resetCodeMatches(data.code, challenge.codeHash)) {
      const failed = await db.phoneVerificationChallenge.updateMany({
        where: { id: challenge.id, usedAt: null, attempts: { lt: 5 }, expiresAt: { gt: now } },
        data: { attempts: { increment: 1 }, ...(challenge.attempts >= 4 ? { usedAt: now } : {}) },
      })
      if (failed.count !== 1) throw new ApiError(409, 'That code has already been used. Request a new one')
      throw new ApiError(400, 'The security code is incorrect')
    }

    const consumed = await db.phoneVerificationChallenge.updateMany({
      where: { id: challenge.id, userId: user.id, usedAt: null, attempts: { lt: 5 }, expiresAt: { gt: now } },
      data: { usedAt: now, verifiedAt: now },
    })
    if (consumed.count !== 1) throw new ApiError(409, 'That code has expired or has already been used')

    await db.auditLog.create({
      data: {
        actorId: user.id,
        action: 'VERIFY_PHONE_FOR_GOOGLE_LINK',
        targetType: 'USER',
        targetId: user.id,
      },
    })
    return jsonOk({ ok: true, message: 'Phone ownership confirmed. Continue to Google.' })
  })
}
