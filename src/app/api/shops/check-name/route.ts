import { NextRequest } from 'next/server'
import { route, jsonOk, ApiError } from '@/lib/api'
import { db } from '@/lib/db'
import { normalizeShopName } from '@/lib/format'
import { hit } from '@/lib/rate-limit'
import { getClientIp } from '@/lib/client-ip'

// Public shop-name availability check - powers the live "suggest area" hint
// while a seller types their shop name. Shop names are public data (they show
// on every browse card), so a public read here leaks nothing new.
//
// GET /api/shops/check-name?name=Nakato+Fresh+Produce&exclude=<own userId>
// → { taken: boolean, matches: [{ area, county }] } (max 3 matches)
//
// `exclude` lets a seller edit the rest of their profile without their own
// shop name being flagged as a collision.
//
// Cost control: the SQL pre-filter fetches only rows whose business name
// contains the query's FIRST word (case-insensitive). Normalized equality
// (lowercase + whitespace-collapsed, normalizeShopName) implies the stored
// name contains that word, so the pre-filter is a superset and the exact
// comparison below stays authoritative — the endpoint never scans the whole
// profile table per keystroke. The IP budget keeps it from being swept.
const CHECK_BUDGET_PER_IP = 60
const CHECK_WINDOW_MS = 5 * 60 * 1000

export async function GET(request: NextRequest) {
  return route(async () => {
    const name = (request.nextUrl.searchParams.get('name') ?? '').trim()
    if (name.length < 2) throw new ApiError(400, 'Type at least 2 characters of the shop name')
    if (name.length > 80) throw new ApiError(400, 'Shop names are at most 80 characters')

    const ip = getClientIp(request)
    const verdict = await hit(`shops:check-name:ip:${ip}`, CHECK_BUDGET_PER_IP, CHECK_WINDOW_MS)
    if (!verdict.ok) throw new ApiError(429, 'Too many name checks. Please wait a moment and try again.')

    const exclude = (request.nextUrl.searchParams.get('exclude') ?? '').trim()

    // The normalized form collapses whitespace runs, so the first word can sit
    // anywhere in the stored name — `contains` matches it wherever it is.
    const firstWord = name.split(/\s+/)[0]!
    const candidates = await db.businessProfile.findMany({
      where: { businessName: { not: '', contains: firstWord, mode: 'insensitive' } },
      select: { userId: true, businessName: true, area: true, county: true },
    })

    const key = normalizeShopName(name)
    const matches = candidates
      .filter((p) => p.userId !== exclude && normalizeShopName(p.businessName) === key)
      .slice(0, 3)
      .map((p) => ({ area: p.area, county: p.county }))

    return jsonOk({ taken: matches.length > 0, matches })
  })
}
