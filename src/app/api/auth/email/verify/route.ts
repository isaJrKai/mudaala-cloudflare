import { z } from 'zod'
import { db } from '@/lib/db'
import { route, jsonOk, jsonError, parseBody, requireUser } from '@/lib/api'
import { normalizeAccountEmail, emailCodeMatches, EMAIL_CODE_MAX_ATTEMPTS } from '@/lib/email-auth'

const schema = z.object({ email: z.string().trim().email().max(254), code: z.string().trim().regex(/^\d{6}$/) })

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
    try {
      const verified = await db.$transaction(async (tx) => {
        const claimed = await tx.emailAuthChallenge.updateMany({
          where: { id: challenge.id, consumedAt: null, expiresAt: { gt: new Date() }, attempts: { lt: EMAIL_CODE_MAX_ATTEMPTS } },
          data: { consumedAt: new Date() },
        })
        if (claimed.count !== 1) return false
        await tx.user.update({ where: { id: user.id }, data: { email, emailVerifiedAt: new Date() } })
        await tx.emailAuthChallenge.updateMany({ where: { userId: user.id, purpose: 'VERIFY_EMAIL', consumedAt: null }, data: { consumedAt: new Date() } })
        return true
      })
      if (!verified) return jsonError(400, 'That verification code did not work or has expired. Request a new code.')
    } catch {
      return jsonError(409, 'That email address is already linked to another Mudaala account.')
    }
    return jsonOk({ ok: true, email, emailVerified: true })
  })
}
