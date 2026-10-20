import { route, jsonOk, requireUser, ApiError } from '@/lib/api'
import { db } from '@/lib/db'

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
    const [productCount, trackedProducts] = await Promise.all([
      db.businessProduct.count({ where: { userId: user.id, archived: false } }),
      db.businessProduct.count({ where: { userId: user.id, archived: false, trackInventory: true } }),
    ])

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
