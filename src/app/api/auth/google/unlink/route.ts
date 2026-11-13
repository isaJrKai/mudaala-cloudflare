import { ApiError, jsonOk, route, requireUser } from '@/lib/api'
import { getCurrentSessionToken } from '@/lib/auth'
import { db } from '@/lib/db'
import { hit } from '@/lib/rate-limit'
import { getClientIp } from '@/lib/client-ip'
import { hashPhoneForVerification } from '@/lib/sms'
import { hasSameRequestOrigin } from '@/lib/google-oidc'

const RECENT_AUTH_MS = 10 * 60 * 1000

export async function DELETE(request: Request) {
  return route(async () => {
    if (!hasSameRequestOrigin(request)) throw new ApiError(403, 'This security action must be started from the Mudaala website')
    const user = await requireUser('Sign in before unlinking Google')
    const [userLimit, ipLimit] = await Promise.all([
      hit(`google-unlink:user:${user.id}`, 3, 60 * 60 * 1000),
      hit(`google-unlink:ip:${getClientIp(request)}`, 8, 60 * 60 * 1000),
    ])
    if (!userLimit.ok || !ipLimit.ok) {
      throw new ApiError(429, 'Too many Google unlink attempts. Please try again later')
    }

    const token = await getCurrentSessionToken()
    const session = token ? await db.session.findUnique({
      where: { id: token },
      select: { userId: true, authMethod: true, createdAt: true, expiresAt: true },
    }) : null
    const now = new Date()
    if (!session || session.userId !== user.id || session.authMethod !== 'PASSWORD' ||
      session.expiresAt <= now || now.getTime() - session.createdAt.getTime() > RECENT_AUTH_MS) {
      throw new ApiError(403, 'Sign in again with your Mudaala password before unlinking Google')
    }

    const phoneProof = await db.phoneVerificationChallenge.findFirst({
      where: {
        userId: user.id,
        phoneHash: hashPhoneForVerification(user.phone),
        proofConsumedAt: null,
        verifiedAt: { gte: new Date(now.getTime() - RECENT_AUTH_MS) },
        usedAt: { not: null },
        proofConsumedAt: null,
      },
      select: { id: true },
    })
    if (!phoneProof) {
      throw new ApiError(403, 'Verify control of your registered phone by SMS before unlinking Google')
    }

    const identity = await db.googleIdentity.findUnique({
      where: { userId_provider: { userId: user.id, provider: 'google' } },
      select: { id: true },
    })
    if (!identity) throw new ApiError(404, 'No Google account is linked to this Mudaala account')

    // Consume the one-use phone proof and unlink in the same transaction.
    // If the identity delete fails, the proof remains available for a retry.
    await db.$transaction(async (tx) => {
      const proofConsumed = await tx.phoneVerificationChallenge.updateMany({
        where: {
          id: phoneProof.id,
          userId: user.id,
          phoneHash: hashPhoneForVerification(user.phone),
          proofConsumedAt: null,
          verifiedAt: { gte: new Date(now.getTime() - RECENT_AUTH_MS) },
        },
        data: { proofConsumedAt: now },
      })
      if (proofConsumed.count !== 1) {
        throw new ApiError(409, 'That phone verification has already been used. Verify your phone again')
      }
      await tx.googleIdentity.delete({ where: { id: identity.id } })
      await tx.auditLog.create({
        data: {
          actorId: user.id,
          action: 'UNLINK_GOOGLE_IDENTITY',
          targetType: 'USER',
          targetId: user.id,
        },
      })
    })

    return jsonOk({ ok: true, message: 'Google sign-in has been unlinked. You can still sign in with your Mudaala phone and password.' })
  })
}
