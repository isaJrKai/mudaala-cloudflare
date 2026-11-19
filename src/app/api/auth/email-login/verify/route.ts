import { randomBytes } from 'node:crypto'
import { z } from 'zod'
import { db } from '@/lib/db'
import { route, jsonOk, jsonError, parseBody } from '@/lib/api'
import { setSessionCookie, toPublicUser } from '@/lib/auth'
import { bearerAuthEnabled } from '@/lib/env-flags'
import { hit, RESET_WINDOW_MS } from '@/lib/rate-limit'
import { getClientIp } from '@/lib/client-ip'
import { normalizeAccountEmail, emailCodeMatches, EMAIL_CODE_MAX_ATTEMPTS } from '@/lib/email-auth'

const schema = z.object({ email: z.string().trim().email().max(254), code: z.string().trim().regex(/^\\d{6}$/) })
const FAIL = 'That code did not work or has expired. Request a new sign-in code.'

export async function POST(request: Request) {
  return route(async () => {
    const data = await parseBody(request, schema)
    const email = normalizeAccountEmail(data.email)
    const ip = getClientIp(request)
    const ipBudget = await hit(`email-login:verify:ip:${ip}`, 30, RESET_WINDOW_MS)
    const emailBudget = await hit(`email-login:verify:address:${email}`, 10, RESET_WINDOW_MS)
    if (!ipBudget.ok || !emailBudget.ok) return jsonError(429, 'Too many sign-in attempts. Please wait and try again.')

    // Login and password recovery both lock the same User row. A recovery
    // cannot delete sessions and then have a paused login recreate one.
    const result = await db.$transaction(async (tx) => {
      const account = await tx.user.findFirst({
        where: { email, emailVerifiedAt: { not: null } },
        select: { id: true },
      })
      if (!account) return { status: 'invalid' as const }

      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${account.id} FOR UPDATE`
      const user = await tx.user.findUnique({ where: { id: account.id } })
      if (!user || user.suspendedAt || !user.emailVerifiedAt || normalizeAccountEmail(user.email ?? '') !== email) {
        return { status: user?.suspendedAt ? 'suspended' as const : 'invalid' as const }
      }

      const challenge = await tx.emailAuthChallenge.findFirst({
        where: { userId: user.id, purpose: 'PASSWORDLESS_LOGIN', targetEmail: email, consumedAt: null, expiresAt: { gt: new Date() }, attempts: { lt: EMAIL_CODE_MAX_ATTEMPTS } },
        orderBy: { createdAt: 'desc' },
      })
      if (!challenge || !emailCodeMatches(data.code, challenge.codeHash)) {
        if (challenge) {
          await tx.emailAuthChallenge.updateMany({
            where: { id: challenge.id, consumedAt: null, attempts: { lt: EMAIL_CODE_MAX_ATTEMPTS } },
            data: { attempts: { increment: 1 }, ...(challenge.attempts + 1 >= EMAIL_CODE_MAX_ATTEMPTS ? { consumedAt: new Date() } : {}) },
          })
        }
        return { status: 'invalid' as const }
      }

      const consumed = await tx.emailAuthChallenge.updateMany({
        where: { id: challenge.id, consumedAt: null, expiresAt: { gt: new Date() }, attempts: { lt: EMAIL_CODE_MAX_ATTEMPTS } },
        data: { consumedAt: new Date() },
      })
      if (consumed.count !== 1) return { status: 'invalid' as const }

      const token = randomBytes(32).toString('hex')
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
      await tx.session.create({ data: { id: token, userId: user.id, authMethod: 'EMAIL_CODE', expiresAt } })
      return { status: 'ok' as const, user, token, expiresAt }
    })

    if (result.status === 'suspended') return jsonError(403, 'This Mudaala account is currently restricted. Use the appeal process to request a review.')
    if (result.status !== 'ok') return jsonError(400, FAIL)

    await setSessionCookie(result.token, result.expiresAt)
    return jsonOk({ user: toPublicUser(result.user), ...(bearerAuthEnabled() ? { sessionToken: result.token } : {}) })
  })
}
