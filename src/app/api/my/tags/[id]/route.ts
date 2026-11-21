import { route, jsonOk, parseBody, requireSeller, ApiError } from '@/lib/api'
import { db } from '@/lib/db'
import { generateTagCode, updateTagSchema } from '@/lib/shop-tags'
import { listOwnerTags } from '@/lib/shop-tags-server'

type Context = { params: Promise<{ id: string }> }

// One endpoint for every tag change: rename, disable/enable, rotate the code
// (retires a lost or tampered tag; the new physical tag must be rewritten) and
// record that the physical tag has been write-protected.
export async function PATCH(request: Request, context: Context) {
  return route(async () => {
    const user = await requireSeller()
    const { id } = await context.params
    const data = await parseBody(request, updateTagSchema)

    const tag = await db.shopTag.findFirst({ where: { id, ownerId: user.id }, select: { id: true } })
    if (!tag) throw new ApiError(404, 'This tag was not found in your shop')

    await db.shopTag.update({
      where: { id: tag.id },
      data: {
        ...(data.label !== undefined ? { label: data.label } : {}),
        ...(data.status !== undefined ? { status: data.status } : {}),
        ...(data.locked !== undefined ? { lockedAt: data.locked ? new Date() : null } : {}),
        // Rotating wins: a new code means a new physical write, so it is unlocked again.
        ...(data.rotate ? { tagCode: generateTagCode(), lockedAt: null } : {}),
      },
    })
    return jsonOk(await listOwnerTags(user.id))
  })
}
