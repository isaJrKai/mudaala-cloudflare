import { z } from 'zod'
import { db } from '@/lib/db'
import { route, jsonOk, jsonError, parseBody, requireUser } from '@/lib/api'
import { normalizeAccountEmail, issueEmailCode } from '@/lib/email-auth'

const schema = z.object({ email: z.string().trim().email().max(254) })

export async function POST(request: Request) {
  return route(async () => {
    const user = await requireUser()
    const data = await parseBody(request, schema)
    const email = normalizeAccountEmail(data.email)
    const owner = await db.user.findUnique({ where: { email }, select: { id: true } })
    if (owner && owner.id !== user.id) return jsonError(409, 'That email address is already linked to another Mudaala account.')
    try {
      await issueEmailCode(user.id, email, 'VERIFY_EMAIL', 'Verify your Mudaala email', 'Use this code to verify the private email address on your Mudaala account.')
    } catch {
      return jsonError(503, 'Email delivery is not available right now. Please try again later.')
    }
    return jsonOk({ ok: true, message: 'A verification code has been sent to that email address.' })
  })
}
