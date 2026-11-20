import { z } from 'zod'
import { ApiError, jsonOk, parseBody, requireUser, route } from '@/lib/api'
import { db } from '@/lib/db'
import { hit } from '@/lib/rate-limit'
import { enquiryTransitionAllowed, type EnquiryStatus } from '@/lib/enquiry-lifecycle'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

const statusSchema = z.object({
  status: z.enum(['OPEN', 'RESOLVED', 'CANCELLED']),
})

// Enquiry lifecycle. The status column has existed since the first schema,
// but nothing could ever write it — merchant inboxes accumulated OPEN rows
// forever. Rules (kept deliberately small):
//   OPEN → RESOLVED   merchant only (the question was answered / deal done)
//   OPEN → CANCELLED  either participant (withdrawn; terminal for both)
//   RESOLVED → OPEN   either participant (the conversation reopens honestly)
//   CANCELLED → …     terminal: a withdrawn enquiry never auto-revives
// Both participants may act: a shopper closing their own question is as
// legitimate as a merchant closing it.
export async function PATCH(request: Request, { params }: Params) {
  return route(async () => {
    const user = await requireUser()
    const { id } = await params
    const limit = await hit('enquiry:status:user:' + user.id, 30, 60 * 60 * 1000)
    if (!limit.ok) throw new ApiError(429, 'Status changes are limited. Please try again later.')
    const body = await parseBody(request, statusSchema)

    // 404 for any enquiry the caller does not participate in — identical to a
    // missing enquiry, so no existence is leaked across tenant boundaries.
    const enquiry = await db.enquiry.findFirst({
      where: { id, OR: [{ merchantId: user.id }, { shopperId: user.id }] },
      select: { id: true, status: true, merchantId: true },
    })
    if (!enquiry) throw new ApiError(404, 'Enquiry not found.')

    const isMerchant = enquiry.merchantId === user.id
    if (!enquiryTransitionAllowed(enquiry.status as EnquiryStatus, body.status, isMerchant)) {
      throw new ApiError(409, `Cannot move a ${enquiry.status.toLowerCase()} enquiry to ${body.status.toLowerCase()}.`)
    }

    await db.enquiry.update({ where: { id }, data: { status: body.status } })
    return jsonOk({ id, status: body.status })
  })
}
