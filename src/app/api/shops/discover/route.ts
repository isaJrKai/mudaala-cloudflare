import { NextRequest } from 'next/server'
import { route, jsonOk, ApiError } from '@/lib/api'
import { db } from '@/lib/db'
import { hit } from '@/lib/rate-limit'
import { getClientIp } from '@/lib/client-ip'

// Lightweight public discovery payload for the Browse feed. The client sends
// only shop IDs already present in the public listings response; this route
// returns no phone numbers, account details, or private merchant data.
export async function GET(request: NextRequest) {
  return route(async () => {
    const rawIds = (request.nextUrl.searchParams.get('ids') ?? '')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean)
    const ids = [...new Set(rawIds)]

    if (ids.length === 0) return jsonOk({ shops: [] })
    if (ids.length > 8 || ids.some((id) => id.length > 64)) {
      throw new ApiError(400, 'Invalid shop discovery request')
    }

    const verdict = await hit(`shop-discovery:ip:${getClientIp(request)}`, 60, 60_000)
    if (!verdict.ok) {
      throw new ApiError(429, 'Shop discovery is temporarily busy. Please try again shortly')
    }

    const rows = await db.user.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        name: true,
        profile: {
          select: {
            businessName: true,
            photoUrl: true,
            category: true,
            area: true,
            county: true,
          },
        },
        showroomItems: {
          orderBy: { createdAt: 'desc' },
          take: 2,
          select: {
            id: true,
            title: true,
            description: true,
            category: true,
            price: true,
            currency: true,
            availability: true,
            photoUrl: true,
            createdAt: true,
          },
        },
      },
    })

    const byId = new Map(rows.map((row) => [row.id, row]))
    const shops = ids.flatMap((id) => {
      const row = byId.get(id)
      if (!row) return []
      return [{
        id: row.id,
        name: row.profile?.businessName?.trim() || row.name,
        photoUrl: row.profile?.photoUrl ?? null,
        category: row.profile?.category ?? null,
        area: row.profile?.area ?? null,
        county: row.profile?.county ?? null,
        showroomItems: row.showroomItems.map((item) => ({
          ...item,
          createdAt: item.createdAt.toISOString(),
        })),
      }]
    })

    return jsonOk({ shops })
  })
}
