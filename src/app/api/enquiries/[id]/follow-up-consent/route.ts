import { z } from 'zod'
import { ApiError, jsonOk, parseBody, requireUser, route } from '@/lib/api'
import { db } from '@/lib/db'
import { hit } from '@/lib/rate-limit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

// Follow-up permission belongs to the shopper and this enquiry only.
// It is not implied by opening a listing, saving it, or starting a conversation.
export async function PATCH(request: Request, { params }: Params) {
  return route(async () => {
    const user = await requireUser()
    const { id } = await params
    const limit = await hit('enquiry:follow-up-consent:user:' + user.id, 20, 60 * 60 * 1000)
    if (!limit.ok) throw new ApiError(429, 'Consent changes are limited. Please try again later.')
    const body = await parseBody(request, z.object({ consent: z.boolean() }))
    const enquiry = await db.enquiry.findFirst({
      where: { id, shopperId: user.id, status: 'OPEN' },
      select: { id: true },
    })
    if (!enquiry) throw new ApiError(404, 'Open shopper enquiry not found.')
    const followUpConsentAt = body.consent ? new Date() : null
    await db.enquiry.update({
      where: { id },
      data: { followUpConsentAt },
    })
    return jsonOk({ followUpConsentAt })
  })
}
