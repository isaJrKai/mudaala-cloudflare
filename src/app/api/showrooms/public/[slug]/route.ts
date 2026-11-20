import { ApiError, jsonOk, requireSeller, route as apiRoute } from '@/lib/api'
import { loadPublicShowroom } from '@/lib/showroom/public-showroom'

type Params = { params: Promise<{ slug: string }> }

// Public showroom JSON. The payload itself comes from the shared loader
// (src/lib/showroom/public-showroom.ts) that also feeds the /showroom/[slug]
// server page, so the API and the SSR body can never disagree about what is
// published. A preview (?preview=1) is the owner's own view of an
// unpublished showroom and is always private/no-store.
export async function GET(request: Request, { params }: Params) {
  return apiRoute(async () => {
    const { slug } = await params
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 80) {
      throw new ApiError(404, 'Showroom not found')
    }
    const preview = new URL(request.url).searchParams.get('preview') === '1'
    const previewUser = preview ? await requireSeller('Sign in as the shop owner to preview this showroom') : null

    const payload = await loadPublicShowroom(slug, preview ? { previewForUserId: previewUser!.id } : {})
    if (!payload) throw new ApiError(404, 'Showroom not found')

    const response = jsonOk(payload)
    if (preview) response.headers.set('Cache-Control', 'private, no-store')
    return response
  })
}
