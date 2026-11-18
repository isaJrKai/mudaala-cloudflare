import { z } from 'zod'
import { db } from '@/lib/db'
import { route, jsonOk, parseBody } from '@/lib/api'
import { hit, RESET_IP_MAX, RESET_WINDOW_MS } from '@/lib/rate-limit'
import { getClientIp } from '@/lib/client-ip'
import { normalizeAccountEmail, issueEmailCode } from '@/lib/email-auth'

const schema = z.object({ email: z.string().trim().email().max(254) })
const OK = { ok: true, message: 'If a verified Mudaala account uses that email, a sign-in code is on its way.' }

export async function POST(request: Request) {
  return route(async () => {
    const data = await parseBody(request, schema)
    const email = normalizeAccountEmail(data.email)
    const ip = getClientIp(request)
    const ipBudget = await hit(`email-login:ip:${ip}`, RESET_IP_MAX, RESET_WINDOW_MS)
    const emailBudget = await hit(`email-login:address:${email}`, 3, RESET_WINDOW_MS)
    if (!ipBudget.ok || !emailBudget.ok) return jsonOk(OK)
    const user = await db.user.findFirst({ where: { email, emailVerifiedAt: { not: null } } })
    if (user && !user.suspendedAt) {
      try {
        await issueEmailCode(user.id, email, 'PASSWORDLESS_LOGIN', 'Your Mudaala sign-in code', 'Use this code to sign in to your Mudaala account.')
      } catch {
        console.error('[email-auth] passwordless delivery unavailable')
      }
    }
    return jsonOk(OK)
  })
}
