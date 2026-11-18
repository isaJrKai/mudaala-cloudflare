import { z } from 'zod'
import { db } from '@/lib/db'
import { route, jsonOk, jsonError, parseBody } from '@/lib/api'
import { createSession, setSessionCookie, toPublicUser } from '@/lib/auth'
import { bearerAuthEnabled } from '@/lib/env-flags'
import { hit, RESET_WINDOW_MS } from '@/lib/rate-limit'
import { getClientIp } from '@/lib/client-ip'
import { normalizeAccountEmail, emailCodeMatches, EMAIL_CODE_MAX_ATTEMPTS } from '@/lib/email-auth'

const schema = z.object({ email: z.string().trim().email().max(254), code: z.string().trim().regex(/^\\d{6}$/) })

export async function POST(request: Request) {
  return route(async () => {
    const data = await parseBody(request, schema)
    const email = normalizeAccountEmail(data.email)
    const ip = getClientIp(request)
    const ipBudget = await hit(`email-login:verify:ip:${ip}`, 30, RESET_WINDOW_MS)
    const emailBudget = await hit(`email-login:verify:address:${email}`, 10, RESET_WINDOW_MS)
    if (!ipBudget.ok || !emailBudget.ok) return jsonError(429, 'Too many sign-in attempts. Please wait and try again.')
    const user = await db.user.findFirst({ where: { email, emailVerifiedAt: { not: null } } })
    const challenge = user ? await db.emailAuthChallenge.findFirst({
      where: { userId: user.id, purpose: 'PASSWORDLESS_LOGIN', targetEmail: email, consumedAt: null, expiresAt: { gt: new Date() }, attempts: { lt: EMAIL_CODE_MAX_ATTEMPTS } },
      orderBy: { createdAt: 'desc' },
    }) : null
    if (!user || !challenge || !emailCodeMatches(data.code, challenge.codeHash)) {
      if (challenge) await db.emailAuthChallenge.updateMany({
        where: { id: challenge.id, consumedAt: null, attempts: { lt: EMAIL_CODE_MAX_ATTEMPTS } },
        data: { attempts: { increment: 1 }, ...(challenge.attempts + 1 >= EMAIL_CODE_MAX_ATTEMPTS ? { consumedAt: new Date() } : {}) },
      })
      return jsonError(400, 'That code did not work or has expired. Request a new sign-in code.')
    }
    if (user.suspendedAt) return jsonError(403, 'This Mudaala account is currently restricted. Use the appeal process to request a review.')
    const consumed = await db.emailAuthChallenge.updateMany({
      where: { id: challenge.id, consumedAt: null, expiresAt: { gt: new Date() }, attempts: { lt: EMAIL_CODE_MAX_ATTEMPTS } },
      data: { consumedAt: new Date() },
    })
    if (consumed.count !== 1) return jsonError(400, 'That code did not work or has expired. Request a new sign-in code.')
    const session = await createSession(user.id)
    await setSessionCookie(session.token, session.expiresAt)
    return jsonOk({ user: toPublicUser(user), ...(bearerAuthEnabled() ? { sessionToken: session.token } : {}) })
  })
}
