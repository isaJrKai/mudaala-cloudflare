import { z } from 'zod'
import { db } from '@/lib/db'
import { route, jsonOk, jsonError, parseBody } from '@/lib/api'
import { hashPassword } from '@/lib/auth'
import { passwordProblem } from '@/lib/validation'
import { clear, hit, RESET_WINDOW_MS } from '@/lib/rate-limit'
import { getClientIp } from '@/lib/client-ip'
import { normalizeAccountEmail, emailCodeMatches, EMAIL_CODE_MAX_ATTEMPTS } from '@/lib/email-auth'

const schema = z.object({ email: z.string().trim().email().max(254), code: z.string().trim().regex(/^\\d{6}$/), newPassword: z.string().min(8).max(100) })
const FAIL = 'That code did not work or has expired. Request a new code and try again.'

export async function POST(request: Request) {
  return route(async () => {
    const data = await parseBody(request, schema)
    const email = normalizeAccountEmail(data.email)
    const ip = getClientIp(request)
    const ipBudget = await hit(`email-reset:verify:ip:${ip}`, 30, RESET_WINDOW_MS)
    const emailBudget = await hit(`email-reset:verify:address:${email}`, 10, RESET_WINDOW_MS)
    if (!ipBudget.ok || !emailBudget.ok) return jsonError(429, 'Too many reset attempts. Wait before trying again.')

    const account = await db.user.findFirst({
      where: { email, emailVerifiedAt: { not: null } },
      select: { id: true, phone: true },
    })
    if (!account) return jsonError(400, FAIL)
    const problem = passwordProblem(data.newPassword, account.phone)
    if (problem) return jsonError(400, problem, { newPassword: problem })

    // Same per-user row lock as email login and email replacement: a reset
    // revokes every session, and no paused login can recreate one afterward.
    const changed = await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${account.id} FOR UPDATE`
      const user = await tx.user.findUnique({ where: { id: account.id } })
      if (!user || !user.emailVerifiedAt || normalizeAccountEmail(user.email ?? '') !== email) return false

      const challenge = await tx.emailAuthChallenge.findFirst({
        where: { userId: user.id, purpose: 'PASSWORD_RESET', targetEmail: email, consumedAt: null, expiresAt: { gt: new Date() }, attempts: { lt: EMAIL_CODE_MAX_ATTEMPTS } },
        orderBy: { createdAt: 'desc' },
      })
      if (!challenge || !emailCodeMatches(data.code, challenge.codeHash)) {
        if (challenge) {
          await tx.emailAuthChallenge.updateMany({
            where: { id: challenge.id, consumedAt: null, attempts: { lt: EMAIL_CODE_MAX_ATTEMPTS } },
            data: { attempts: { increment: 1 }, ...(challenge.attempts + 1 >= EMAIL_CODE_MAX_ATTEMPTS ? { consumedAt: new Date() } : {}) },
          })
        }
        return false
      }

      const consumed = await tx.emailAuthChallenge.updateMany({
        where: { id: challenge.id, consumedAt: null, expiresAt: { gt: new Date() }, attempts: { lt: EMAIL_CODE_MAX_ATTEMPTS } },
        data: { consumedAt: new Date() },
      })
      if (consumed.count !== 1) return false
      await tx.user.update({ where: { id: user.id }, data: { passwordHash: hashPassword(data.newPassword) } })
      await tx.session.deleteMany({ where: { userId: user.id } })
      await tx.passwordReset.deleteMany({ where: { userId: user.id, usedAt: null } })
      await tx.emailAuthChallenge.updateMany({ where: { userId: user.id, consumedAt: null }, data: { consumedAt: new Date() } })
      return true
    })
    if (!changed) return jsonError(400, FAIL)
    await clear(`login:fail:${account.phone}`)
    return jsonOk({ ok: true, message: 'Password updated. Sign in with your new password.' })
  })
}
