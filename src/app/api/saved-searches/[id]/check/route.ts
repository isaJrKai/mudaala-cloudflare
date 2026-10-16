import { NextRequest } from 'next/server'
import { route, jsonOk, requireUser, ApiError } from '@/lib/api'
import { db } from '@/lib/db'
import { searchListings } from '@/lib/listings'
import { listingQuerySchema } from '@/lib/validation'

type Params = { params: Promise<{ id: string }> }

// Recompute the match count against the database - honest numbers only.
export async function POST(_request: NextRequest, { params }: Params) {
  return route(async () => {
    const user = await requireUser()
    const { id } = await params
    const search = await db.savedSearch.findFirst({
      where: { id, userId: user.id },
    })
    if (!search) {
      throw new ApiError(404, 'Saved search not found')
    }

    let query: unknown
    try {
      query = JSON.parse(search.queryJson)
    } catch {
      throw new ApiError(500, 'This saved search is corrupted. Delete and recreate it.')
    }
    const parsed = listingQuerySchema.safeParse(query)
    if (!parsed.success) {
      throw new ApiError(500, 'This saved search is corrupted. Delete and recreate it.')
    }

    const { total } = await searchListings({ query: { ...parsed.data, page: 1, pageSize: 1 } })

    // The record may have been removed while matches were being recomputed.
    // updateMany is conditional and cannot throw Prisma P2025 for that race.
    const updated = await db.savedSearch.updateMany({
      where: { id, userId: user.id },
      data: { lastMatchCount: total, lastCheckedAt: new Date() },
    })
    if (updated.count === 0) {
      throw new ApiError(404, 'Saved search not found')
    }

    // Return the canonical record for the existing client contract. A delete
    // racing this read is still a normal 404, never a database 503.
    const refreshed = await db.savedSearch.findFirst({
      where: { id, userId: user.id },
    })
    if (!refreshed) {
      throw new ApiError(404, 'Saved search not found')
    }
    return jsonOk({ search: refreshed })
  })
}
