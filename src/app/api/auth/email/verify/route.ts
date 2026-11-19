import { z } from 'zod'
import { db } from '@/lib/db'
import { route, jsonOk, jsonError, parseBody, requireUser } from '@/lib/api'
import { normalizeAccountEmail, emailCodeMatches, EMAIL_CODE_MAX_ATTEMPTS } from '@/lib/email-auth'
import { sendGmailMessage } from '@/lib/gmail'

const schema = z.object({ email: z.string().trim().email().max(254), code: z.string().trim().regex(/^\\d{6}$/) })

export async function POST(request: Request) {
  return route(async () => {
    const user = await requireUser()
    const data = await parseBody(request, schema)
    const email = normalizeAccountEmail(data.email)
    const challenge = await db.emailAuthChallenge.findFirst({
      where: { userId: user.id, purpose: 'VERIFY_EMAIL', targetEmail: email, consumedAt: null, expiresAt: { gt: new Date() }, attempts: { lt: EMAIL_CODE_MAX_ATTEMPTS } },
      orderBy: { createdAt: 'desc' },
    })
    if (!challenge || !emailCodeMatches(data.code, challenge.codeHash)) {
      if (challenge) {
        await db.emailAuthChallenge.updateMany({
          where: { id: challenge.id, consumedAt: null, attempts: { lt: EMAIL_CODE_MAX_ATTEMPTS } },
          data: { attempts: { increment: 1 }, ...(challenge.attempts + 1 >= EMAIL_CODE_MAX_ATTEMPTS ? { consumedAt: new Date() } : {}) },
        })
      }
      return jsonError(400, 'That verification code did not work or has expired. Request a new code.')
    }

    let previousEmail: string | null = null
    try {
      const verified = await db.$transaction(async (tx) => {
        // Serialize address replacement with login and password-reset code
        // redemption. Whichever operation gets this lock first wins safely.
        await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${user.id} FOR UPDATE`
        const currentUser = await tx.user.findUnique({ where: { id: user.id } })
        const currentChallenge = await tx.emailAuthChallenge.findUnique({ where: { id: challenge.id } })
        if (!currentUser || !currentChallenge || currentChallenge.consumedAt ||
          currentChallenge.expiresAt <= new Date() || currentChallenge.attempts >= EMAIL_CODE_MAX_ATTEMPTS ||
          currentChallenge.targetEmail !== email || !emailCodeMatches(data.code, currentChallenge.codeHash)) return false

        const claimed = await tx.emailAuthChallenge.updateMany({
          where: { id: currentChallenge.id, consumedAt: null, expiresAt: { gt: new Date() }, attempts: { lt: EMAIL_CODE_MAX_ATTEMPTS } },
          data: { consumedAt: new Date() },
        })
        if (claimed.count !== 1) return false
        previousEmail = currentUser.email && currentUser.emailVerifiedAt ? currentUser.email : null
        await tx.user.update({ where: { id: user.id }, data: { email, emailVerifiedAt: new Date() } })
        await tx.auditLog.create({ data: { actorId: user.id, action: 'ACCOUNT_EMAIL_VERIFIED', targetType: 'USER', targetId: user.id, reason: 'Account email verified' } })
        // Every outstanding code is bound to the old account-email state.
        await tx.emailAuthChallenge.updateMany({
          where: { userId: user.id, consumedAt: null },
          data: { consumedAt: new Date() },
        })
        // If an email-code login won the lock just before this replacement,
        // revoke that session as part of the same address-change transaction.
        await tx.session.deleteMany({ where: { userId: user.id, authMethod: 'EMAIL_CODE' } })
        return true
      })
      if (!verified) return jsonError(400, 'That verification code did not work or has expired. Request a new code.')
    } catch {
      return jsonError(409, 'That email address is already linked to another Mudaala account.')
    }

    if (previousEmail && previousEmail !== email) {
      try {
        await sendGmailMessage(
          previousEmail,
          'Your Mudaala account email was changed',
          'The verified email address on your Mudaala account was changed. If you did not make this change, sign in using your phone and password and contact Mudaala support.',
        )
      } catch {
        console.error('[email-auth] previous account email security notice could not be delivered')
      }
    }
    return jsonOk({ ok: true, email, emailVerified: true })
  })
}
