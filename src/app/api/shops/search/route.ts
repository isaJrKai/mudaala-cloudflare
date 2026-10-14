import { NextRequest } from 'next/server'
import { route, jsonOk, ApiError } from '@/lib/api'
import { db } from '@/lib/db'
import { hit } from '@/lib/rate-limit'
import { getClientIp } from '@/lib/client-ip'
import { normalizeSearchText } from '@/lib/search'

// Public, sign-in-free shop-name search. Returns only fields needed to choose
// a shop; phone numbers and account details are never included.
export async function GET(request: NextRequest) {
  return route(async () => {
    const q = (request.nextUrl.searchParams.get('q') ?? '').trim()
    if (q.length < 2) throw new ApiError(400, 'Type at least 2 characters of the shop name')
    if (q.length > 80) throw new ApiError(400, 'Search text is too long')

    const verdict = await hit(`shop-search:ip:${getClientIp(request)}`, 60, 60_000)
    if (!verdict.ok) throw new ApiError(429, 'You are searching too quickly. Please try again shortly')

    // Match words, not only the exact raw phrase. "Karungi traders", "Karungi-Traders"
    // and different Unicode letter styles should lead to the same shop.
    const needle = normalizeSearchText(q)
    const tokens = [...new Set(needle.split(' ').filter((token) => token.length >= 2))]
    if (!needle || tokens.length === 0) return jsonOk({ shops: [] })

    const select = {
      id: true,
      name: true,
      country: true,
      profile: {
        select: { businessName: true, photoUrl: true, area: true, county: true },
      },
    } as const

    // First use indexed/DB-side substring candidates for arbitrary shop ages.
    // OR-ing individual words avoids requiring the exact spacing/punctuation
    // the customer typed. A second, bounded recent window catches Unicode
    // styling that PostgreSQL's raw text contains() cannot see.
    const [matchedCandidates, recentCandidates] = await Promise.all([
      db.user.findMany({
        where: {
          OR: tokens.flatMap((token) => [
            { name: { contains: token, mode: 'insensitive' as const } },
            { profile: { is: { businessName: { contains: token, mode: 'insensitive' as const } } } },
          ]),
        },
        select,
        orderBy: { updatedAt: 'desc' },
        take: 300,
      }),
      db.user.findMany({
        select,
        orderBy: { updatedAt: 'desc' },
        take: 500,
      }),
    ])

    const byId = new Map<string, (typeof matchedCandidates)[number]>()
    for (const row of matchedCandidates) byId.set(row.id, row)
    for (const row of recentCandidates) byId.set(row.id, row)

    const matches = (name: string) => {
      const normalized = normalizeSearchText(name)
      return normalized.includes(needle) || tokens.every((token) => normalized.includes(token))
    }
    const shops = [...byId.values()]
      .map((row) => {
        const businessName = row.profile?.businessName?.trim() || ''
        return {
          id: row.id,
          name: businessName || row.name,
          accountName: row.name,
          photoUrl: row.profile?.photoUrl ?? null,
          area: row.profile?.area ?? null,
          county: row.profile?.county ?? null,
          country: row.country ?? 'UG',
        }
      })
      .filter((shop) => matches(shop.name) || matches(shop.accountName))
      .map(({ accountName: _accountName, ...shop }) => shop)
      .sort((a, b) => {
        const score = (name: string) => {
          const normalized = normalizeSearchText(name)
          return normalized === needle ? 0 : normalized.startsWith(needle) ? 1 : normalized.includes(needle) ? 2 : 3
        }
        return score(a.name) - score(b.name) || a.name.localeCompare(b.name)
      })
      .slice(0, 8)

    return jsonOk({ shops })
  })
}
