import { NextResponse } from 'next/server'
import { route, requireUser, ApiError } from '@/lib/api'
import { isAdminUser } from '@/lib/admin'
import { db } from '@/lib/db'
import { REPORT_REASON_LABELS, type ReportReason } from '@/lib/constants'

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
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000)
    const nextTwentyFourHours = new Date(now.getTime() + 24 * 60 * 60 * 1000)

    const listingWhere = { isSeed: false, user: { isSeed: false } }
    const activeListingWhere = { ...listingWhere, status: 'ACTIVE' }

    const [
      registeredAccounts,
      signupsToday,
      signupsLast7Days,
      signupsLast30Days,
      shopsCreated,
      listingStatusRows,
      activeOffers,
      activeRequests,
      listingViews,
      shopFollows,
      validSessionRows,
      openReports,
      listingsExpiringNext24Hours,
      savedSearches,
      unreadNotifications,
      openReportsOlderThan24Hours,
      categoryRows,
      countyRows,
      openReportReasonRows,
      moderationActionRows,
    ] = await Promise.all([
      db.user.count({ where: { isSeed: false } }),
      db.user.count({ where: { isSeed: false, createdAt: { gte: startOfUtcDay } } }),
      db.user.count({ where: { isSeed: false, createdAt: { gte: sevenDaysAgo } } }),
      db.user.count({ where: { isSeed: false, createdAt: { gte: thirtyDaysAgo } } }),
      db.businessProfile.count({ where: { isSeed: false, user: { isSeed: false } } }),
      db.listing.groupBy({
        by: ['status'],
        where: listingWhere,
        _count: { _all: true },
      }),
      db.listing.count({ where: { ...activeListingWhere, type: 'OFFER' } }),
      db.listing.count({ where: { ...activeListingWhere, type: 'REQUEST' } }),
      db.listing.aggregate({
        where: activeListingWhere,
        _sum: { viewCount: true },
      }),
      db.shopFollow.count({ where: { follower: { isSeed: false }, shopOwner: { isSeed: false } } }),
      // IDs are only used in-memory to deduplicate sessions; they are never
      // returned to the browser or persisted by this endpoint.
      db.session.findMany({
        where: { expiresAt: { gt: now }, user: { isSeed: false } },
        select: { userId: true },
        distinct: ['userId'],
      }),
      db.report.count({ where: { status: 'OPEN' } }),
      db.listing.count({
        where: { ...activeListingWhere, expiresAt: { gt: now, lte: nextTwentyFourHours } },
      }),
      db.savedSearch.count({ where: { user: { isSeed: false } } }),
      db.notification.count({ where: { read: false, user: { isSeed: false } } }),
      db.report.count({ where: { status: 'OPEN', createdAt: { lt: twentyFourHoursAgo } } }),
      db.listing.groupBy({
        by: ['category'],
        where: activeListingWhere,
        _count: { _all: true },
        orderBy: { _count: { category: 'desc' } },
        take: 12,
      }),
      db.listing.groupBy({
        by: ['county'],
        where: activeListingWhere,
        _count: { _all: true },
        orderBy: { _count: { county: 'desc' } },
        take: 12,
      }),
      db.report.groupBy({
        by: ['reason'],
        where: { status: 'OPEN' },
        _count: { _all: true },
        orderBy: { _count: { reason: 'desc' } },
      }),
      db.auditLog.groupBy({
        by: ['action'],
        where: { createdAt: { gte: sevenDaysAgo } },
        _count: { _all: true },
        orderBy: { _count: { action: 'desc' } },
      }),
    ])

    const countStatus = (status: string) =>
      listingStatusRows.find((row) => row.status === status)?._count._all ?? 0
    const privacySafeBreakdown = (rows: { label: string; count: number }[]) =>
      rows.filter((row) => row.count >= 5)

    const activeListingsByCategory = privacySafeBreakdown(
      categoryRows.map((row) => ({ label: row.category, count: row._count._all })),
    )
    const activeListingsByCounty = privacySafeBreakdown(
      countyRows.map((row) => ({ label: row.county, count: row._count._all })),
    )
    const openReportsByReason = openReportReasonRows.map((row) => ({
      label: REPORT_REASON_LABELS[row.reason as ReportReason] ?? row.reason,
      count: row._count._all,
    }))
    const moderationActionsLast7Days = moderationActionRows.map((row) => ({
      label: row.action,
      count: row._count._all,
    }))

    return NextResponse.json(
      {
        metrics: {
          registeredAccounts,
          signupsToday,
          signupsLast7Days,
          signupsLast30Days,
          shopsCreated,
          activeListings: countStatus('ACTIVE'),
          fulfilledListings: countStatus('FULFILLED'),
          expiredListings: countStatus('EXPIRED'),
          archivedListings: countStatus('ARCHIVED'),
          hiddenListings: countStatus('HIDDEN'),
          activeOffers,
          activeRequests,
          listingViews: listingViews._sum.viewCount ?? 0,
          shopFollows,
          accountsWithValidSessions: validSessionRows.length,
          openReports,
          listingsExpiringNext24Hours,
          savedSearches,
          unreadNotifications,
          openReportsOlderThan24Hours,
          activeListingsByCategory,
          activeListingsByCounty,
          openReportsByReason,
          moderationActionsLast7Days,
        },
        generatedAt: now.toISOString(),
        timezone: 'UTC',
        privacy: 'aggregate-only',
        privacyThreshold: 5,
      },
      { headers: { 'Cache-Control': 'private, no-store, max-age=0' } },
    )
  })
}
