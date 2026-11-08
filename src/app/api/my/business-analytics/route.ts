import { route, jsonOk, requireUser, ApiError } from '@/lib/api'
import { db } from '@/lib/db'
import { ugandaCalendarDay } from '@/lib/listing-analytics'

type AttributedSalesAggregate = {
  currency: string
  listing_id: string | null
  listing_title: string
  sales_count: number
  revenue: string
}

type SalesAggregate = {
  currency: string
  sales_count: number
  revenue: string
  gross_profit: string | null
  line_count: number
  costed_line_count: number
}

export async function GET(request: Request) {
  return route(async () => {
    const user = await requireUser()
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
    // Seller-reported attribution is queried independently from anonymous
    // contact taps and ordinary recorded sales. A deleted listing keeps its
    // title snapshot, so historical revenue remains reportable.
    const attributedRows = await db.$queryRaw<AttributedSalesAggregate[]>\x60
      SELECT
        s."currency" AS currency,
        s."sourceListingId" AS listing_id,
        s."sourceListingTitle" AS listing_title,
        COUNT(DISTINCT s."id")::int AS sales_count,
        COALESCE(SUM(i."lineTotal"), 0)::text AS revenue
      FROM "Sale" s
      INNER JOIN "SaleItem" i ON i."saleId" = s."id"
      WHERE s."userId" = \x24{user.id}
        AND s."status" = 'COMPLETED'
        AND s."sourceListingTitle" IS NOT NULL
        AND s."soldAt" >= \x24{since}
      GROUP BY s."currency", s."sourceListingId", s."sourceListingTitle"
      ORDER BY SUM(i."lineTotal") DESC
    \x60
    const attributedByCurrency = new Map<string, { currency: string; salesCount: number; revenue: number }>()
    for (const row of attributedRows) {
      const current = attributedByCurrency.get(row.currency) ?? { currency: row.currency, salesCount: 0, revenue: 0 }
      current.salesCount += row.sales_count
      current.revenue += Number(row.revenue)
      attributedByCurrency.set(row.currency, current)
    }
    const sellerReportedAttribution = {
      byCurrency: [...attributedByCurrency.values()].map((row) => ({ ...row, revenue: Number(row.revenue.toFixed(2)) })),
      byListing: attributedRows.map((row) => ({
        listingId: row.listing_id,
        listingTitle: row.listing_title,
        currency: row.currency,
        salesCount: row.sales_count,
        revenue: Number(row.revenue),
      })),
      evidence: 'Seller-reported attribution: the authenticated shop owner selected this listing when recording the sale. It is not buyer-confirmed or independently verified.',
    }
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

    return jsonOk({
      period,
      since: since.toISOString(),
      sellerReportedAttribution,\n      sales: sales.map((row) => ({
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
    })
  })
}
