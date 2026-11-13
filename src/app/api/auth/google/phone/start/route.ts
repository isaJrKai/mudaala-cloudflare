import { ApiError, jsonOk, route, requireUser } from '@/lib/api'
import { getCurrentSessionToken } from '@/lib/auth'
import { db } from '@/lib/db'
import { hit } from '@/lib/rate-limit'
import { getClientIp } from '@/lib/client-ip'
import { chooseSmsProvider, generateResetCode, hashResetCode, hashPhoneForVerification } from '@/lib/sms'

const CHALLENGE_TTL_MS = 10 * 60 * 1000
const RECENT_AUTH_MS = 10 * 60 * 1000

export async function POST(request: Request) {
  return route(async () => {
    const user = await requireUser('Sign in before verifying your phone')
    const [userLimit, ipLimit] = await Promise.all([
      hit(`google-phone:start:user:${user.id}`, 3, 60 * 60 * 1000),
      hit(`google-phone:start:ip:${getClientIp(request)}`, 8, 60 * 60 * 1000),
    ])
    if (!userLimit.ok || !ipLimit.ok) {
      throw new ApiError(429, 'Too many verification messages. Please try again later')
    }

    const token = await getCurrentSessionToken()
    const session = token ? await db.session.findUnique({
      where: { id: token },
      select: { userId: true, createdAt: true, expiresAt: true },
    }) : null
    const now = new Date()
    if (!session || session.userId !== user.id || session.expiresAt <= now ||
      now.getTime() - session.createdAt.getTime() > RECENT_AUTH_MS) {
      throw new ApiError(403, 'Sign in again before verifying the phone on this account')
    }

    const code = generateResetCode()
    await db.phoneVerificationChallenge.updateMany({
      where: { userId: user.id, usedAt: null },
      data: { usedAt: now },
    })
    const challenge = await db.phoneVerificationChallenge.create({
      data: {
        userId: user.id,
        phoneHash: hashPhoneForVerification(user.phone),
        codeHash: hashResetCode(code),
        expiresAt: new Date(now.getTime() + CHALLENGE_TTL_MS),
      },
    })

    try {
      await chooseSmsProvider().send(
        user.phone,
        `Your Mudaala security code is ${code}. It expires in 10 minutes. Do not share this code with anyone.`,
      )
    } catch {
      await db.phoneVerificationChallenge.updateMany({
        where: { id: challenge.id, usedAt: null },
        data: { usedAt: new Date() },
      })
      console.error('[auth/google] phone verification SMS delivery failed')
      throw new ApiError(503, 'We could not send the security code. Please try again later')
    }

    return jsonOk({ ok: true, message: 'A security code has been sent to your registered phone.' })
  })
}
