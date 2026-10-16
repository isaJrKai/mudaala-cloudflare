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
    // the customer typed. A second, tightly bounded recent window catches Unicode
    // styling that PostgreSQL's raw text contains() cannot see.
    const matchedCandidates = await db.user.findMany({
      where: {
        OR: tokens.flatMap((token) => [
          { name: { contains: token, mode: 'insensitive' as const } },
          { profile: { is: { businessName: { contains: token, mode: 'insensitive' as const } } } },
        ]),
      },
      select,
      orderBy: { updatedAt: 'desc' },
      take: 100,
    })

    // Normalize each candidate exactly once. Re-normalizing both names in
    // every Array.sort comparator turns the Unicode fallback into thousands of
    // extra Unicode transforms and can exhaust the Worker's CPU budget.
    const toShops = (rows: typeof matchedCandidates) => rows
      .map((row) => {
        const businessName = row.profile?.businessName?.trim() || ''
        const shop = {
          id: row.id,
          name: businessName || row.name,
          photoUrl: row.profile?.photoUrl ?? null,
          area: row.profile?.area ?? null,
          county: row.profile?.county ?? null,
          country: row.country ?? 'UG',
        }
        return { shop, normalizedName: normalizeSearchText(shop.name) }
      })
      .filter(({ normalizedName }) =>
        normalizedName.includes(needle) || tokens.every((token) => normalizedName.includes(token)),
      )

    let candidates = toShops(matchedCandidates)
    // Only pay for the bounded Unicode fallback when ordinary DB candidates
    // fail to produce a normalized match.
    if (candidates.length === 0) {
      const recentCandidates = await db.user.findMany({
        select,
        orderBy: { updatedAt: 'desc' },
        take: 100,
      })
      candidates = toShops(recentCandidates)
    }

    const score = (normalized: string) =>
      normalized === needle ? 0 : normalized.startsWith(needle) ? 1 : normalized.includes(needle) ? 2 : 3
    const shops = candidates
      .sort((a, b) => score(a.normalizedName) - score(b.normalizedName) || a.shop.name.localeCompare(b.shop.name))
      .slice(0, 8)
      .map(({ shop }) => shop)

    return jsonOk({ shops })
  })
}
