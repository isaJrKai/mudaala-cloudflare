import { NextResponse } from 'next/server'
import { route, requireUser, ApiError } from '@/lib/api'
import { isAdminUser } from '@/lib/admin'
import { db } from '@/lib/db'

// Admin analytics intentionally returns aggregates only. Never return account
// identifiers, names, phone numbers, individual histories, or raw event rows.
export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET() {
  return route(async () => {
    const user = await requireUser('Sign in to view admin analytics')
    if (!isAdminUser(user)) throw new ApiError(403, 'Only the Mudaala admin can view platform analytics')

    const now = new Date()
    const startOfUtcDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)

    const [
      registeredAccounts,
      signupsToday,
      signupsLast7Days,
      signupsLast30Days,
      shopsCreated,
      activeListings,
      listingViews,
      shopFollows,
      validSessionRows,
      openReports,
    ] = await Promise.all([
      db.user.count({ where: { isSeed: false } }),
      db.user.count({ where: { isSeed: false, createdAt: { gte: startOfUtcDay } } }),
      db.user.count({ where: { isSeed: false, createdAt: { gte: sevenDaysAgo } } }),
      db.user.count({ where: { isSeed: false, createdAt: { gte: thirtyDaysAgo } } }),
      db.businessProfile.count({ where: { isSeed: false, user: { isSeed: false } } }),
      db.listing.count({ where: { isSeed: false, status: 'ACTIVE', user: { isSeed: false } } }),
      db.listing.aggregate({
        where: { isSeed: false, status: 'ACTIVE', user: { isSeed: false } },
        _sum: { viewCount: true },
      }),
      db.shopFollow.count({ where: { follower: { isSeed: false }, shopOwner: { isSeed: false } } }),
      // User IDs are only used in-memory to deduplicate multiple valid sessions.
      // They are never returned to the browser or persisted by this endpoint.
      db.session.findMany({
        where: { expiresAt: { gt: now }, user: { isSeed: false } },
        select: { userId: true },
        distinct: ['userId'],
      }),
      db.report.count({ where: { status: 'OPEN' } }),
    ])

    return NextResponse.json(
      {
        metrics: {
          registeredAccounts,
          signupsToday,
          signupsLast7Days,
          signupsLast30Days,
          shopsCreated,
          activeListings,
          listingViews: listingViews._sum.viewCount ?? 0,
          shopFollows,
          accountsWithValidSessions: validSessionRows.length,
          openReports,
        },
        generatedAt: now.toISOString(),
        timezone: 'UTC',
        privacy: 'aggregate-only',
      },
      { headers: { 'Cache-Control': 'private, no-store, max-age=0' } },
    )
  })
}
