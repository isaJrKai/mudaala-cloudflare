import { NextRequest } from 'next/server'
import { route, jsonOk, ApiError } from '@/lib/api'
import { db } from '@/lib/db'
import { hit } from '@/lib/rate-limit'
import { getClientIp } from '@/lib/client-ip'

// Public, sign-in-free shop-name search. Returns only fields needed to choose
// a shop; phone numbers and account details are never included.
export async function GET(request: NextRequest) {
  return route(async () => {
    const q = (request.nextUrl.searchParams.get('q') ?? '').trim()
    if (q.length < 2) throw new ApiError(400, 'Type at least 2 characters of the shop name')
    if (q.length > 80) throw new ApiError(400, 'Search text is too long')

    const verdict = await hit(`shop-search:ip:${getClientIp(request)}`, 60, 60_000)
    if (!verdict.ok) throw new ApiError(429, 'You are searching too quickly. Please try again shortly')

    const rows = await db.businessProfile.findMany({
      where: {
        OR: [
          { businessName: { contains: q, mode: 'insensitive' } },
          { user: { name: { contains: q, mode: 'insensitive' } } },
        ],
      },
      select: {
        userId: true,
        businessName: true,
        photoUrl: true,
        area: true,
        county: true,
        user: { select: { id: true, name: true, country: true } },
      },
      take: 40,
    })

    const needle = q.toLocaleLowerCase()
    const shops = rows
      .map((row) => ({
        id: row.user.id,
        name: row.businessName?.trim() || row.user.name,
        photoUrl: row.photoUrl ?? null,
        area: row.area ?? null,
        county: row.county ?? null,
        country: row.user.country ?? 'UG',
      }))
      .filter((shop, index, all) => all.findIndex((candidate) => candidate.id === shop.id) === index)
      .sort((a, b) => {
        const aName = a.name.toLocaleLowerCase()
        const bName = b.name.toLocaleLowerCase()
        const score = (name: string) => name === needle ? 0 : name.startsWith(needle) ? 1 : 2
        return score(aName) - score(bName) || aName.localeCompare(bName)
      })
      .slice(0, 8)

    return jsonOk({ shops })
  })
}
