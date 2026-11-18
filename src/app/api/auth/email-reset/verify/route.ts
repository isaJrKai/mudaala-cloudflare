import { z } from 'zod'
import { db } from '@/lib/db'
import { route, jsonOk, jsonError, parseBody } from '@/lib/api'
import { hashPassword } from '@/lib/auth'
import { passwordProblem } from '@/lib/validation'
import { clear, hit, RESET_WINDOW_MS } from '@/lib/rate-limit'
import { getClientIp } from '@/lib/client-ip'
import { normalizeAccountEmail, emailCodeMatches, EMAIL_CODE_MAX_ATTEMPTS } from '@/lib/email-auth'

const schema = z.object({
  email: z.string().trim().email().max(254),
  code: z.string().trim().regex(/^\\d{6}$/),
  newPassword: z.string().min(8).max(100),
})
const FAIL = 'That code did not work or has expired. Request a new code and try again.'

export async function POST(request: Request) {
  return route(async () => {
    const data = await parseBody(request, schema)
    const email = normalizeAccountEmail(data.email)
    const ip = getClientIp(request)
    const ipBudget = await hit(`email-reset:verify:ip:${ip}`, 30, RESET_WINDOW_MS)
    const emailBudget = await hit(`email-reset:verify:address:${email}`, 10, RESET_WINDOW_MS)
    if (!ipBudget.ok || !emailBudget.ok) return jsonError(429, 'Too many reset attempts. Wait before trying again.')
    const user = await db.user.findFirst({ where: { email, emailVerifiedAt: { not: null } } })
    const challenge = user ? await db.emailAuthChallenge.findFirst({
      where: { userId: user.id, purpose: 'PASSWORD_RESET', targetEmail: email, consumedAt: null, expiresAt: { gt: new Date() }, attempts: { lt: EMAIL_CODE_MAX_ATTEMPTS } },
      orderBy: { createdAt: 'desc' },
    }) : null
    if (!user || !challenge || !emailCodeMatches(data.code, challenge.codeHash)) {
      if (challenge) await db.emailAuthChallenge.updateMany({
        where: { id: challenge.id, consumedAt: null, attempts: { lt: EMAIL_CODE_MAX_ATTEMPTS } },
        data: { attempts: { increment: 1 }, ...(challenge.attempts + 1 >= EMAIL_CODE_MAX_ATTEMPTS ? { consumedAt: new Date() } : {}) },
      })
      return jsonError(400, FAIL)
    }
    const problem = passwordProblem(data.newPassword, user.phone)
    if (problem) return jsonError(400, problem, { newPassword: problem })
    const changed = await db.$transaction(async (tx) => {
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
    await clear(`login:fail:${user.phone}`)
    return jsonOk({ ok: true, message: 'Password updated. Sign in with your new password.' })
  })
}
