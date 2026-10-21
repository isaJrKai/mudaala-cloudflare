// POST /api/feedback - private bug reports and user feedback.
// Guests may submit; submissions are rate-limited and only admins can read them.
// The client sends only a pathname, never an arbitrary URL or screenshot payload.
import { route, jsonOk, parseBody } from '@/lib/api'
import { feedbackCreateSchema } from '@/lib/validation'
import { getSessionUser } from '@/lib/auth'
import { getClientIp } from '@/lib/client-ip'
import { hit } from '@/lib/rate-limit'
import { db } from '@/lib/db'
import { NextResponse } from 'next/server'

const FEEDBACK_WINDOW_MS = 60 * 60 * 1000
const FEEDBACK_USER_MAX = 5
const FEEDBACK_IP_MAX = 8

export async function POST(request: Request) {
  return route(async () => {
    const data = await parseBody(request, feedbackCreateSchema)
    const ip = getClientIp(request)
    const user = await getSessionUser()
    // Always apply the IP bucket as well as the per-account bucket, so
    // creating multiple accounts does not bypass the guest/device limit.
    const ipVerdict = await hit(`feedback:ip:${ip}`, FEEDBACK_IP_MAX, FEEDBACK_WINDOW_MS)
    const userVerdict = user
      ? await hit(`feedback:user:${user.id}`, FEEDBACK_USER_MAX, FEEDBACK_WINDOW_MS)
      : { ok: true as const, retryAfterSeconds: 0 }
    const blocked = !ipVerdict.ok ? ipVerdict : !userVerdict.ok ? userVerdict : null
    if (blocked) {
      return NextResponse.json(
        { error: 'You have sent several feedback reports recently. Please try again later.' },
        { status: 429, headers: { 'retry-after': String(blocked.retryAfterSeconds) } },
      )
    }

    const adminIds = (process.env.ADMIN_USER_IDS ?? '').split(',').map((value) => value.trim()).filter(Boolean)
    const feedback = await db.$transaction(async (tx) => {
      const created = await tx.feedback.create({
        data: {
          reporterId: user?.id ?? null,
          category: data.category,
          title: data.title,
          description: data.description,
          pagePath: data.pagePath ?? null,
          contact: data.contact?.trim() || null,
          userAgent: request.headers.get('user-agent')?.slice(0, 500) ?? null,
        },
        select: { id: true, status: true, createdAt: true },
      })

      // Notify configured production admins in their existing in-app inbox.
      // Keep the comment/contact out of notifications; full details remain
      // private inside /admin. If the allowlist is empty, the admin inbox
      // still receives the submission and no arbitrary users are notified.
      if (adminIds.length > 0) {
        const admins = await tx.user.findMany({ where: { id: { in: adminIds } }, select: { id: true } })
        if (admins.length > 0) {
          await tx.notification.createMany({
            data: admins.map((admin) => ({
              userId: admin.id,
              type: 'NEW_FEEDBACK',
              title: 'New bug report or feedback',
              body: `New ${data.category.toLowerCase()} feedback: ${data.title}. Open the admin dashboard to review it.`,
            })),
          })
        }
      }
      return created
    })
    return jsonOk({ feedback: { id: feedback.id, status: feedback.status, createdAt: feedback.createdAt }, message: 'Thank you. Your feedback has been sent to the Mudaala admin team.' }, 201)
  })
}
