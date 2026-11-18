import { z } from 'zod'
import { db } from '@/lib/db'
import { route, jsonOk, parseBody } from '@/lib/api'
import { hit, RESET_IP_MAX, RESET_WINDOW_MS } from '@/lib/rate-limit'
import { getClientIp } from '@/lib/client-ip'
import { normalizeAccountEmail, issueEmailCode } from '@/lib/email-auth'

const schema = z.object({ email: z.string().trim().email().max(254) })
const OK = { ok: true, message: 'If a verified Mudaala account uses that email, a password reset code is on its way.' }

export async function POST(request: Request) {
  return route(async () => {
    const data = await parseBody(request, schema)
    const email = normalizeAccountEmail(data.email)
    const ip = getClientIp(request)
    const ipBudget = await hit(`email-reset:ip:${ip}`, RESET_IP_MAX, RESET_WINDOW_MS)
    const emailBudget = await hit(`email-reset:address:${email}`, 3, RESET_WINDOW_MS)
    if (!ipBudget.ok || !emailBudget.ok) return jsonOk(OK)
    const user = await db.user.findFirst({ where: { email, emailVerifiedAt: { not: null } } })
    if (user) {
      try {
        await issueEmailCode(user.id, email, 'PASSWORD_RESET', 'Reset your Mudaala password', 'Use this code to reset the password on your Mudaala account.')
      } catch {
        console.error('[email-auth] password reset delivery unavailable')
      }
    }
    return jsonOk(OK)
  })
}
