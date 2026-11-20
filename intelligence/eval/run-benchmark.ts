/**
 * Offline benchmark runner for the deterministic discovery pipeline.
 *
 * Runs MCI-01 → MCI-02 → (filter) → MCI-03 → MCI-08 over the SYNTHETIC
 * fixture catalogue and compares against a recency-only baseline ordering —
 * the "no intelligence" reference point, mirroring the evaluation protocol's
 * requirement to compare candidate vs current ordering on the same candidates.
 *
 * WHAT THIS IS NOT: a production benchmark, real traffic, or evidence about
 * real Mudaala users. Fixtures are synthetic and author-graded; see the
 * fixture files' `note` fields. Reports record engine versions and fixture
 * versions so a run is reproducible.
 */
import catalogueJson from './fixtures/catalogue.json'
import queriesJson from './fixtures/queries.json'
import { mean, mrr, ndcgAtK, precisionAtK, recallAtK, topSellerShare, type Judgments } from './metrics'
import { understandQuery } from '../modules/mci01-query-understanding/engine'
import { planRetrieval } from '../modules/mci02-retrieval-planner/engine'
import { rankCandidates, MCI03_ENGINE_VERSION } from '../modules/mci03-relevance-ranker/engine'
import { diversifySlate, MCI08_ENGINE_VERSION } from '../modules/mci08-diversity-controller/engine'
import { MCI01_ENGINE_VERSION } from '../modules/mci01-query-understanding/engine'
import { MCI02_ENGINE_VERSION } from '../modules/mci02-retrieval-planner/engine'

export const FIXTURE_CATALOGUE_VERSION = (catalogueJson as { version: string }).version
export const FIXTURE_QUERIES_VERSION = (queriesJson as { version: string }).version
export const BENCHMARK_NOW = '2026-11-20T12:00:00Z'
const PAGE_SIZE = 10

interface FixtureListing {
  listing_id: string
  seller_ref: string
  category_id: string
  title: string
  description: string
  price: number
  currency: string
  county: string
  area: string | null
  published_at: string
  refreshed_at: string
  engagement: { views: number; contact_taps: number; share_clicks: number }
  availability: string
  shop_size_band: string
}

const catalogue = (catalogueJson as { listings: FixtureListing[] }).listings
const queries = (queriesJson as { queries: Array<{ id: string; query: string; intent_note: string; judgments: Record<string, number> }> }).queries

/** Filter-category matching honours the taxonomy hierarchy: a top-level hint
 * ('electronics') matches subcategory ids ('electronics-phones'). */
function categoryMatches(listingCategoryId: string, filterCategories: string[]): boolean {
  if (filterCategories.length === 0) return true
  return filterCategories.some((c) => listingCategoryId === c || listingCategoryId.startsWith(`${c}-`))
}

function applyPlanFilters(listings: FixtureListing[], filters: ReturnType<typeof planRetrieval>['filters']): FixtureListing[] {
  return listings.filter((l) => {
    // All fixture listings are ACTIVE OFFER inventory (see fixture note).
    if (filters.keywords.length > 0) {
      const hay = `${l.title} ${l.description}`.toLowerCase()
      const anyHit = filters.keywords.some((k) => hay.includes(k))
      // Keyword path is an OR-signal with category fallback, matching the
      // planner's multi-path design; filters here keep candidates union-style.
      if (!anyHit && !categoryMatches(l.category_id, filters.categories)) return false
    } else if (!categoryMatches(l.category_id, filters.categories)) {
      return false
    }
    if (filters.price) {
      if (filters.price.min !== null && l.price < filters.price.min) return false
      if (filters.price.max !== null && l.price > filters.price.max) return false
    }
    if (filters.counties.length > 0 && !filters.counties.includes(l.county)) return false
    return true
  })
}

function rankFixture(listing: FixtureListing): Parameters<typeof rankCandidates>[1][number] {
  return {
    listing_id: listing.listing_id,
    seller_ref: listing.seller_ref,
    category_id: listing.category_id,
    title: listing.title,
    description: listing.description,
    price: listing.price,
    currency: listing.currency,
    county: listing.county,
    area: listing.area,
    published_at: listing.published_at,
    refreshed_at: listing.refreshed_at,
    engagement: listing.engagement,
    availability: listing.availability as 'IN_STOCK' | 'UNKNOWN' | 'AVAILABLE_ON_ORDER' | 'OUT_OF_STOCK',
    shop_size_band: listing.shop_size_band as 'NEW' | 'SMALL' | 'MEDIUM' | 'LARGE',
  }
}

export interface BenchmarkReport {
  run_id: string
  ran_at: string
  fixture_catalogue_version: string
  fixture_queries_version: string
  engine_versions: Record<string, string>
  page_size: number
  synthetic_data_notice: string
  per_query: Array<{
    query_id: string
    query: string
    intent_note: string
    candidate_count: number
    pipeline: QueryMetrics
    baseline: QueryMetrics
  }>
  aggregates: {
    pipeline: AggregateMetrics
    baseline: AggregateMetrics
  }
}

export interface QueryMetrics {
  ndcg5: number
  precision5: number
  recall10: number
  mrr: number
  distinct_sellers_top5: number
  top_seller_share: number
}

export interface AggregateMetrics {
  mean_ndcg5: number
  mean_precision5: number
  mean_recall10: number
  mean_mrr: number
  mean_distinct_sellers_top5: number
  mean_top_seller_share: number
  zero_result_rate: number
}

function metricsFor(order: string[], judgments: Judgments, sellerOf: (id: string) => string): QueryMetrics {
  return {
    ndcg5: Math.round(ndcgAtK(order, judgments, 5) * 10_000) / 10_000,
    precision5: Math.round(precisionAtK(order, judgments, 5) * 10_000) / 10_000,
    recall10: Math.round(recallAtK(order, judgments, 10) * 10_000) / 10_000,
    mrr: Math.round(mrr(order, judgments) * 10_000) / 10_000,
    distinct_sellers_top5: distinctSellersTopKUnsafe(order, sellerOf, 5),
    top_seller_share: Math.round(topSellerShare(order.slice(0, PAGE_SIZE), sellerOf) * 1000) / 1000,
  }
}

function distinctSellersTopKUnsafe(order: string[], sellerOf: (id: string) => string, k: number): number {
  return new Set(order.slice(0, k).map(sellerOf)).size
}

export function runBenchmark(now: string = BENCHMARK_NOW): BenchmarkReport {
  const sellerById = new Map(catalogue.map((l) => [l.listing_id, l.seller_ref]))
  const sellerOf = (id: string) => sellerById.get(id) ?? 'unknown'
  const metadata = Object.fromEntries(catalogue.map((l) => [l.listing_id, { seller_ref: l.seller_ref, category_id: l.category_id, published_at: l.published_at }]))

  const perQuery: BenchmarkReport['per_query'] = []
  const pipelineOrders: string[][] = []

  for (const q of queries) {
    const queryPlan = understandQuery({ query: q.query })
    const plan = planRetrieval(queryPlan, undefined, { max_candidates: 500 })
    const candidates = applyPlanFilters(catalogue, plan.filters)

    // Pipeline ordering: rank then diversify.
    const ranked = rankCandidates(queryPlan, candidates.map(rankFixture), { now })
    const diversified = diversifySlate(ranked.ranked, metadata)
    const pipelineOrder = diversified.slate.slice(0, PAGE_SIZE)

    // Baseline: recency-only (refreshed_at desc, then id) on the SAME
    // filtered candidate set — the no-intelligence reference ordering.
    const baselineOrder = [...candidates]
      .sort((a, b) => b.refreshed_at.localeCompare(a.refreshed_at) || a.listing_id.localeCompare(b.listing_id))
      .slice(0, PAGE_SIZE)
      .map((l) => l.listing_id)

    pipelineOrders.push(pipelineOrder)
    perQuery.push({
      query_id: q.id,
      query: q.query,
      intent_note: q.intent_note,
      candidate_count: candidates.length,
      pipeline: metricsFor(pipelineOrder, q.judgments, sellerOf),
      baseline: metricsFor(baselineOrder, q.judgments, sellerOf),
    })
  }

  const aggregate = (side: 'pipeline' | 'baseline'): AggregateMetrics => ({
    mean_ndcg5: mean(perQuery.map((r) => r[side].ndcg5)),
    mean_precision5: mean(perQuery.map((r) => r[side].precision5)),
    mean_recall10: mean(perQuery.map((r) => r[side].recall10)),
    mean_mrr: mean(perQuery.map((r) => r[side].mrr)),
    mean_distinct_sellers_top5: mean(perQuery.map((r) => r[side].distinct_sellers_top5)),
    mean_top_seller_share: mean(perQuery.map((r) => r[side].top_seller_share)),
    zero_result_rate: Math.round((perQuery.filter((r) => r.candidate_count === 0).length / perQuery.length) * 10_000) / 10_000,
  })

  return {
    run_id: `benchmark-${now.slice(0, 10)}-v0`,
    ran_at: now,
    fixture_catalogue_version: FIXTURE_CATALOGUE_VERSION,
    fixture_queries_version: FIXTURE_QUERIES_VERSION,
    engine_versions: {
      mci01: MCI01_ENGINE_VERSION,
      mci02: MCI02_ENGINE_VERSION,
      mci03: MCI03_ENGINE_VERSION,
      mci08: MCI08_ENGINE_VERSION,
    },
    page_size: PAGE_SIZE,
    synthetic_data_notice:
      'Synthetic fixtures, author-graded judgments, no real users, no production data. Not evidence of production quality.',
    per_query: perQuery,
    aggregates: { pipeline: aggregate('pipeline'), baseline: aggregate('baseline') },
  }
}

function main(argv: string[]): void {
  const report = runBenchmark()
  const outIndex = argv.indexOf('--out')
  if (outIndex !== -1 && argv[outIndex + 1]) {
    const fs = require('node:fs') as typeof import('node:fs')
    const path = argv[outIndex + 1]
    fs.mkdirSync(path.slice(0, path.lastIndexOf('/')), { recursive: true })
    fs.writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`)
    console.log(`report written: ${path}`)
  }
  const summary = [
    `=== Mudaala intelligence offline benchmark (SYNTHETIC fixtures) ===`,
    `run: ${report.run_id}  fixtures: catalogue ${report.fixture_catalogue_version} / queries ${report.fixture_queries_version}`,
    '',
    `metric                        pipeline   baseline(recency)`,
    `mean nDCG@5                   ${String(report.aggregates.pipeline.mean_ndcg5).padEnd(10)} ${report.aggregates.baseline.mean_ndcg5}`,
    `mean Precision@5              ${String(report.aggregates.pipeline.mean_precision5).padEnd(10)} ${report.aggregates.baseline.mean_precision5}`,
    `mean Recall@10                ${String(report.aggregates.pipeline.mean_recall10).padEnd(10)} ${report.aggregates.baseline.mean_recall10}`,
    `mean MRR                      ${String(report.aggregates.pipeline.mean_mrr).padEnd(10)} ${report.aggregates.baseline.mean_mrr}`,
    `mean distinct sellers top-5   ${String(report.aggregates.pipeline.mean_distinct_sellers_top5).padEnd(10)} ${report.aggregates.baseline.mean_distinct_sellers_top5}`,
    `mean top-seller share (p10)   ${String(report.aggregates.pipeline.mean_top_seller_share).padEnd(10)} ${report.aggregates.baseline.mean_top_seller_share}`,
    `zero-result rate              ${report.aggregates.pipeline.zero_result_rate}`,
  ].join('\n')
  console.log(summary)
}

if (import.meta.main) {
  main(process.argv.slice(2))
}
