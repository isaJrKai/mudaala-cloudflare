import { jsonOk, requireSeller, route as apiRoute } from '@/lib/api'
import { db } from '@/lib/db'

export async function GET() {
  return apiRoute(async () => {
    const user = await requireSeller('Sign in as the shop owner to choose products')
    const rows = await db.listing.findMany({
      where: { userId: user.id, type: 'OFFER', status: 'ACTIVE', isSeed: false, expiresAt: { gt: new Date() } },
      orderBy: [{ refreshedAt: 'desc' }],
      take: 200,
      select: { id: true, title: true, category: true, price: true, currency: true, photos: true },
    })
    return jsonOk({
      products: rows.map((row) => {
        let photos: string[] = []
        try {
          const parsed: unknown = JSON.parse(row.photos)
          if (Array.isArray(parsed)) photos = parsed.filter((item): item is string => typeof item === 'string').slice(0, 4)
        } catch { /* malformed legacy photo data is omitted */ }
        return { ...row, photos }
      }),
    })
  })
}
