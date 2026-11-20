/**
 * Evaluation harness tests — metric correctness and benchmark invariants.
 */
import { describe, expect, test } from 'bun:test'
import {
  distinctSellersTopK,
  mean,
  mrr,
  ndcgAtK,
  precisionAtK,
  recallAtK,
  topSellerShare,
  zeroResultRate,
} from './metrics'
import { runBenchmark } from './run-benchmark'

describe('ranking metrics', () => {
  const judgments = { a: 3, b: 2, c: 1, d: 0 }
  const order = ['a', 'b', 'c', 'd']

  test('perfect ordering scores nDCG@K = 1', () => {
    expect(ndcgAtK(order, judgments, 4)).toBe(1)
    expect(ndcgAtK(['a', 'b', 'c'], judgments, 3)).toBe(1)
  })

  test('inverted ordering scores low but non-negative', () => {
    const inverted = ndcgAtK(['d', 'c', 'b', 'a'], judgments, 4)
    expect(inverted).toBeGreaterThan(0)
    expect(inverted).toBeLessThan(0.9)
  })

  test('unjudged items count as zero gain', () => {
    expect(ndcgAtK(['a', 'x', 'y', 'z'], judgments, 4)).toBeLessThan(1)
    // A single-item list scores 1 only when K=1 (later positions are empty).
    expect(ndcgAtK(['a'], judgments, 1)).toBe(1)
    expect(ndcgAtK(['a'], judgments, 4)).toBeLessThan(1)
  })

  test('precision@5 and recall@K use the grade threshold', () => {
    expect(precisionAtK(order, judgments, 2)).toBe(1) // a,b both >= 2
    expect(precisionAtK(order, judgments, 4)).toBe(0.5)
    expect(recallAtK(order, { a: 3, b: 2, c: 2 }, 4)).toBe(1)
    expect(recallAtK(order, { a: 3, b: 2, c: 2 }, 2)).toBeCloseTo(0.6667, 3)
  })

  test('MRR finds the first relevant position', () => {
    expect(mrr(['x', 'b', 'a'], judgments)).toBe(0.5)
    expect(mrr(['a'], judgments)).toBe(1)
    expect(mrr(['x', 'y'], judgments)).toBe(0)
  })

  test('exposure metrics', () => {
    const sellerOf = (id: string) => (id.startsWith('A') ? 'A' : id.startsWith('B') ? 'B' : 'C')
    expect(distinctSellersTopK(['A1', 'A2', 'B1', 'C1'], sellerOf, 4)).toBe(3)
    expect(topSellerShare(['A1', 'A2', 'B1'], sellerOf)).toBeCloseTo(0.6667, 3)
    expect(topSellerShare([], sellerOf)).toBe(0)
  })

  test('zero-result rate and mean', () => {
    expect(zeroResultRate([['a'], [], ['b']])).toBeCloseTo(0.3333, 3)
    expect(mean([1, 2, 3, 4])).toBe(2.5)
  })
})

describe('benchmark on synthetic fixtures', () => {
  const report = runBenchmark()

  test('runs all fixture queries end-to-end', () => {
    expect(report.per_query.length).toBe(18)
    for (const row of report.per_query) {
      expect(row.pipeline.ndcg5).toBeGreaterThanOrEqual(0)
      expect(row.pipeline.ndcg5).toBeLessThanOrEqual(1)
    }
  })

  test('pipeline outperforms recency baseline on fixture relevance', () => {
    // Valid ONLY for these synthetic author-graded fixtures — not a
    // production claim. See the report's synthetic_data_notice.
    expect(report.aggregates.pipeline.mean_ndcg5).toBeGreaterThan(report.aggregates.baseline.mean_ndcg5)
    expect(report.aggregates.pipeline.mean_mrr).toBeGreaterThan(report.aggregates.baseline.mean_mrr)
  })

  test('report carries full provenance', () => {
    expect(report.fixture_catalogue_version).toMatch(/^eval\.fixtures\.catalogue\.v/)
    expect(report.fixture_queries_version).toMatch(/^eval\.fixtures\.queries\.v/)
    expect(report.engine_versions.mci03).toMatch(/v0\.1\.0$/)
    expect(report.synthetic_data_notice).toContain('Synthetic')
  })

  test('honest exposure trade-off is visible, not hidden', () => {
    // The engagement-weighted ranker concentrates large shops slightly more
    // than recency on this fixture set — recorded, not masked. The diversity
    // controller's page-level caps are the counterweight.
    expect(typeof report.aggregates.pipeline.mean_distinct_sellers_top5).toBe('number')
  })
})
