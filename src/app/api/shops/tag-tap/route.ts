import { route, jsonOk, parseBody, ApiError } from '@/lib/api'
import { getSessionUser } from '@/lib/auth'
import { getClientIp } from '@/lib/client-ip'
import { hit } from '@/lib/rate-limit'
import { normalizeTagCode, tagTapSchema } from '@/lib/shop-tags'
import { recordTagTap } from '@/lib/shop-tags-server'

const HOUR_MS = 60 * 60 * 1000
const MAX_TAPS_PER_IP_PER_HOUR = 120
const MAX_TAPS_PER_TAG_PER_HOUR = 1000

// Public beacon fired by the shop page when it opens from a tag link. Always
// answers 200 for well-formed requests whether or not a tag matched, so it
// cannot be used to probe which tag codes exist.
export async function POST(request: Request) {
  return route(async () => {
    const data = await parseBody(request, tagTapSchema)
    const tagCode = normalizeTagCode(data.t)
    if (!tagCode) return jsonOk({ recorded: false })

    const ip = getClientIp(request)
    const ipVerdict = await hit(`shop-tag-tap:ip:${ip}`, MAX_TAPS_PER_IP_PER_HOUR, HOUR_MS)
    if (!ipVerdict.ok) throw new ApiError(429, 'Too many interactions. Please try again later.')
    // A per-tag ceiling blunts someone inflating a rival's numbers; over it we just stop counting.
    const tagVerdict = await hit(`shop-tag-tap:tag:${tagCode}`, MAX_TAPS_PER_TAG_PER_HOUR, HOUR_MS)
    if (!tagVerdict.ok) return jsonOk({ recorded: false })

    const viewer = await getSessionUser()
    const recorded = await recordTagTap({ tagCode, via: data.v ?? 'nfc', viewerId: viewer?.id })
    return jsonOk({ recorded })
  })
}
