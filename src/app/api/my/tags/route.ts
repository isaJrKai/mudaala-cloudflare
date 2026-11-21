import { route, jsonOk, parseBody, requireSeller, ApiError } from '@/lib/api'
import { createTagSchema } from '@/lib/shop-tags'
import { createOwnerTag, listOwnerTags } from '@/lib/shop-tags-server'
import { hit } from '@/lib/rate-limit'

const HOUR_MS = 60 * 60 * 1000

export async function GET() {
  return route(async () => {
    const user = await requireSeller()
    return jsonOk(await listOwnerTags(user.id))
  })
}

export async function POST(request: Request) {
  return route(async () => {
    const user = await requireSeller()
    const data = await parseBody(request, createTagSchema)
    const verdict = await hit(`shop-tag-create:user:${user.id}`, 20, HOUR_MS)
    if (!verdict.ok) throw new ApiError(429, 'Too many new tags. Please try again later.')
    await createOwnerTag(user.id, data.label)
    return jsonOk(await listOwnerTags(user.id), 201)
  })
}
