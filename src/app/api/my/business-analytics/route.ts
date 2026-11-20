import { route, jsonOk, requireSeller, ApiError } from '@/lib/api'
import { db } from '@/lib/db'
import { ugandaCalendarDay } from '@/lib/listing-analytics'
import { createGatewayClient, clientConfigFromEnv } from '@/lib/intelligence/gateway-client'
import { mci27IntelligenceEnabled } from '@/lib/intelligence/env-flags'
import { buildMCI27Snapshot } from '@/lib/intelligence/merchant-insights'

type SalesAggregate = {
  currency: string
  sales_count: number
  revenue: string
  gross_profit: string | null
  line_count: number
  costed_line_count: number
}

let cachedMci27Client: ReturnType<typeof createGatewayClient> | undefined

function getMci27Client() {
  if (!cachedMci27Client) cachedMci27Client = createGatewayClient(clientConfigFromEnv(process.env))
  return cachedMci27Client
}

export async function GET(request: Request) {
  return route(async () => {
    const user = await requireSeller()
    const url = new URL(request.url)
    const period = url.searchParams.get('period') ?? '30d'
    const days = period === '7d' ? 7 : period === '30d' ? 30 : period === '90d' ? 90 : null
    if (days === null) throw new ApiError(400, 'Choose a 7d, 30d, or 90d reporting period')
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
    const sinceDay = ugandaCalendarDay(since)

    // Aggregate in PostgreSQL so the dashboard does not load an unbounded
    // sale-item history into a Worker. Only completed, seller-recorded sales
    // count. Profit stays null unless every line has a captured unit cost.
    const sales = await db.$queryRaw<SalesAggregate[]>`
      SELECT
        s."currency" AS currency,
        COUNT(DISTINCT s."id")::int AS sales_count,
        COALESCE(SUM(i."lineTotal"), 0)::text AS revenue,
        CASE
          WHEN COUNT(*) = COUNT(i."unitCost")
          THEN ROUND(COALESCE(SUM(i."lineTotal" - (i."quantity" * i."unitCost")), 0), 2)::text
          ELSE NULL
        END AS gross_profit,
        COUNT(*)::int AS line_count,
        COUNT(i."unitCost")::int AS costed_line_count
      FROM "Sale" s
      INNER JOIN "SaleItem" i ON i."saleId" = s."id"
      WHERE s."userId" = ${user.id}
        AND s."status" = 'COMPLETED'
        AND s."soldAt" >= ${since}
      GROUP BY s."currency"
    `
    const listingStats = await db.listing.aggregate({
      where: { userId: user.id },
      _sum: { viewCount: true },
      _count: { id: true },
    })
    const [productCount, trackedProducts, engagement, topListingRows, shopEngagement] = await Promise.all([
      db.businessProduct.count({ where: { userId: user.id, archived: false } }),
      db.businessProduct.count({ where: { userId: user.id, archived: false, trackInventory: true } }),
      db.listingDailyAnalytics.aggregate({
        where: { ownerId: user.id, day: { gte: sinceDay } },
        _sum: { views: true, callClicks: true, whatsappClicks: true, shareClicks: true },
      }),
      db.listingDailyAnalytics.groupBy({
        by: ['listingId'],
        where: { ownerId: user.id, day: { gte: sinceDay }, listingId: { not: null } },
        _sum: { views: true, callClicks: true, whatsappClicks: true, shareClicks: true },
        orderBy: { _sum: { views: 'desc' } },
        take: 5,
      }),
      db.shopDailyAnalytics.aggregate({
        where: { ownerId: user.id, day: { gte: sinceDay } },
        _sum: { views: true, callClicks: true, whatsappClicks: true, shareClicks: true },
      }),
    ])
    const topListingIds = topListingRows.map((row) => row.listingId).filter((id): id is string => Boolean(id))
    const topListingNames = topListingIds.length
      ? await db.listing.findMany({ where: { id: { in: topListingIds }, userId: user.id }, select: { id: true, title: true } })
      : []
    const titleById = new Map(topListingNames.map((listing) => [listing.id, listing.title]))
    const listingEngagement = {
      views: engagement._sum.views ?? 0,
      callClicks: engagement._sum.callClicks ?? 0,
      whatsappClicks: engagement._sum.whatsappClicks ?? 0,
      shareClicks: engagement._sum.shareClicks ?? 0,
    }
    const topListings = topListingRows.flatMap((row) => {
      if (!row.listingId) return []
      const title = titleById.get(row.listingId)
      if (!title) return []
      return [{
        listingId: row.listingId,
        title,
        views: row._sum.views ?? 0,
        callClicks: row._sum.callClicks ?? 0,
        whatsappClicks: row._sum.whatsappClicks ?? 0,
        shareClicks: row._sum.shareClicks ?? 0,
      }]
    })

    // Optional intelligence enrichment. It is explicitly opt-in and fail-open:
    // the existing merchant analytics response remains available if the
    // gateway, snapshot adapter or intelligence worker is unavailable.
    let intelligence: Record<string, unknown> | undefined
    if (mci27IntelligenceEnabled(process.env)) {
      const client = getMci27Client()
      if (!client.isConfigured()) {
        intelligence = { status: 'UNAVAILABLE' }
      } else {
        try {
          const previousSince = new Date(since.getTime() - days * 24 * 60 * 60 * 1000)
          const previousSinceDay = ugandaCalendarDay(previousSince)
          const [dailyRows, perListingRows, merchantListings, previousTotals] = await Promise.all([
            db.listingDailyAnalytics.groupBy({
              by: ['day'],
              where: { ownerId: user.id, day: { gte: sinceDay } },
              _sum: { views: true, callClicks: true, whatsappClicks: true, shareClicks: true },
              orderBy: { day: 'asc' },
              take: 92,
            }),
            db.listingDailyAnalytics.groupBy({
              by: ['listingId'],
              where: { ownerId: user.id, day: { gte: sinceDay }, listingId: { not: null } },
              _sum: { views: true, callClicks: true, whatsappClicks: true, shareClicks: true },
              orderBy: { _sum: { views: 'desc' } },
              take: 200,
            }),
            db.listing.findMany({
              where: { userId: user.id },
              select: { id: true, title: true, category: true, status: true, publishedAt: true },
              orderBy: { publishedAt: 'desc' },
              take: 200,
            }),
            db.listingDailyAnalytics.aggregate({
              where: { ownerId: user.id, day: { gte: previousSinceDay, lt: sinceDay } },
              _sum: { views: true, callClicks: true, whatsappClicks: true, shareClicks: true },
            }),
          ])
          const byListing = new Map<string, (typeof perListingRows)[number]>()
          for (const row of perListingRows) {
            if (row.listingId) byListing.set(row.listingId, row)
          }
          const nowMs = Date.now()
          const snapshot = await buildMCI27Snapshot({
            ownerId: user.id,
            pseudonymKey: process.env.INTELLIGENCE_GATEWAY_SECRET ?? '',
            days: days as 7 | 30 | 90,
            from: sinceDay,
            totals: {
              views: listingEngagement.views,
              contactTaps: listingEngagement.callClicks + listingEngagement.whatsappClicks,
              shareClicks: listingEngagement.shareClicks,
            },
            daily: dailyRows.map((row) => ({
              day: row.day,
              views: row._sum.views ?? 0,
              contactTaps: (row._sum.callClicks ?? 0) + (row._sum.whatsappClicks ?? 0),
              shareClicks: row._sum.shareClicks ?? 0,
            })),
            listings: merchantListings.flatMap((listing) => {
              const status = listing.status
              if (!['ACTIVE', 'FULFILLED', 'EXPIRED', 'ARCHIVED', 'HIDDEN'].includes(status)) return []
              const metrics = byListing.get(listing.id)?._sum
              return [{
                id: listing.id,
                title: listing.title,
                categoryId: listing.category,
                status: status as 'ACTIVE' | 'FULFILLED' | 'EXPIRED' | 'ARCHIVED' | 'HIDDEN',
                daysLive: Math.floor((nowMs - listing.publishedAt.getTime()) / 86_400_000),
                views: metrics?.views ?? 0,
                contactTaps: (metrics?.callClicks ?? 0) + (metrics?.whatsappClicks ?? 0),
                shareClicks: metrics?.shareClicks ?? 0,
              }]
            }),
            previousPeriodTotals: {
              views: previousTotals._sum.views ?? 0,
              contactTaps: (previousTotals._sum.callClicks ?? 0) + (previousTotals._sum.whatsappClicks ?? 0),
              shareClicks: previousTotals._sum.shareClicks ?? 0,
            },
          })
          const response = await client.call<{
            module_id: string
            engine_version: string
            result: { insights: unknown[]; coverage_warnings: string[]; metric_definitions_ref: string }
          }>('/v1/merchant/insights', snapshot)
          if (response.ok) {
            const warnings = [...response.envelope.result.coverage_warnings]
            if (listingStats._count.id > merchantListings.length) {
              warnings.unshift(`Only the newest ${merchantListings.length} of ${listingStats._count.id} listings were included in this analysis.`)
            }
            intelligence = {
              status: 'AVAILABLE',
              module: response.envelope.module_id,
              engineVersion: response.envelope.engine_version,
              insights: response.envelope.result.insights,
              coverageWarnings: warnings.slice(0, 6),
              metricDefinitionsRef: response.envelope.result.metric_definitions_ref,
            }
          } else {
            intelligence = { status: 'UNAVAILABLE' }
          }
        } catch (error) {
          console.warn(JSON.stringify({ evt: 'mci27_snapshot_unavailable', error_class: error instanceof Error ? error.name : 'unknown' }))
          intelligence = { status: 'UNAVAILABLE' }
        }
      }
    }

    return jsonOk({
      period,
      since: since.toISOString(),
      sales: sales.map((row) => ({
        currency: row.currency,
        completedSales: row.sales_count,
        recordedRevenue: Number(row.revenue),
        estimatedGrossProfit: row.gross_profit === null ? null : Number(row.gross_profit),
        saleLines: row.line_count,
        linesWithKnownCost: row.costed_line_count,
        costCoverage: row.line_count === 0 ? null : Number((row.costed_line_count / row.line_count).toFixed(4)),
      })),
      listingViews: listingStats._sum.viewCount ?? 0,
      listingCount: listingStats._count.id,
      engagement: {
        ...listingEngagement,
        contactClicks: listingEngagement.callClicks + listingEngagement.whatsappClicks,
        topListings,
        definitions: {
          views: 'Recorded public active listing-detail page loads in the selected Uganda-calendar period; not unique people reached or ad impressions.',
          callClicks: 'Taps on a listing Call link; not proof a call connected.',
          whatsappClicks: 'Taps on a listing WhatsApp link; not proof a message was sent.',
          shareClicks: 'Taps on a listing share/copy action; not proof the link was delivered or opened.',
          contactClicks: 'Call and WhatsApp button taps combined, not confirmed inquiries or sales.',
        },
      },
      shopEngagement: {
        views: shopEngagement._sum.views ?? 0,
        callClicks: shopEngagement._sum.callClicks ?? 0,
        whatsappClicks: shopEngagement._sum.whatsappClicks ?? 0,
        shareClicks: shopEngagement._sum.shareClicks ?? 0,
        contactClicks: (shopEngagement._sum.callClicks ?? 0) + (shopEngagement._sum.whatsappClicks ?? 0),
      },
      activeBusinessProducts: productCount,
      inventoryTrackedProducts: trackedProducts,
      definitions: {
        recordedRevenue: 'Sum of seller-recorded completed sales in the selected period; not payment-processor verified.',
        estimatedGrossProfit: 'Revenue less recorded item costs only. Null if any item cost is unknown; excludes operating expenses.',
        listingViews: 'Recorded listing view count, not unique people reached or ad impressions.',
      },
      ...(intelligence !== undefined ? { intelligence } : {}),
    })
  })
}
