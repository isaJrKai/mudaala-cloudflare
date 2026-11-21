/**
 * Evaluation metrics for retrieval/ranking — implements the metric families
 * from `docs/AI_SEARCH_EVALUATION_PROTOCOL.md` (unmerged branch
 * `ai/ranking-engine-implementation-2026-10-30`), which increment 1 adopts as
 * its gate spec:
 *
 * - nDCG@K, Precision@K, Recall@K, MRR from graded relevance judgments
 * - zero-result rate
 * - distinct shops in the first five results (exposure breadth)
 * - top-seller share (exposure concentration)
 *
 * Metrics are reported separately — never combined into one opaque score.
 * Grades: 0 = not relevant, 1 = marginally, 2 = relevant, 3 = highly relevant.
 */

export interface Judgments {
  /** listing_id → graded relevance 0..3 */
  [listingId: string]: number
}

function dcg(scores: number[]): number {
  return scores.reduce((acc, s, i) => acc + (Math.pow(2, s) - 1) / Math.log2(i + 2), 0)
}

/** nDCG@K with graded judgments; unjudged items count as 0. */
export function ndcgAtK(rankedIds: string[], judgments: Judgments, k: number): number {
  const gains = rankedIds.slice(0, k).map((id) => judgments[id] ?? 0)
  const ideal = [...Object.values(judgments)].sort((a, b) => b - a).slice(0, k)
  const idealDcg = dcg(ideal)
  if (idealDcg === 0) return 1 // nothing judged relevant: perfect by convention
  return dcg(gains) / idealDcg
}

/** Precision@K over grades >= threshold (default 2 = "relevant"). */
export function precisionAtK(rankedIds: string[], judgments: Judgments, k: number, threshold = 2): number {
  const top = rankedIds.slice(0, k)
  if (top.length === 0) return 0
  const hits = top.filter((id) => (judgments[id] ?? 0) >= threshold).length
  return hits / top.length
}

/** Recall@K over all judged-relevant items (grade >= threshold). */
export function recallAtK(rankedIds: string[], judgments: Judgments, k: number, threshold = 2): number {
  const relevant = Object.entries(judgments).filter(([, g]) => g >= threshold).map(([id]) => id)
  if (relevant.length === 0) return 1
  const hits = rankedIds.slice(0, k).filter((id) => relevant.includes(id)).length
  return hits / relevant.length
}

/** MRR over grades >= threshold. */
export function mrr(rankedIds: string[], judgments: Judgments, threshold = 2): number {
  for (let i = 0; i < rankedIds.length; i++) {
    if ((judgments[rankedIds[i]] ?? 0) >= threshold) return 1 / (i + 1)
  }
  return 0
}

/** Mean over per-query metric values. */
export function mean(values: number[]): number {
  if (values.length === 0) return 0
  return Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10_000) / 10_000
}

export function zeroResultRate(queryRankedIds: string[][]): number {
  if (queryRankedIds.length === 0) return 0
  const empty = queryRankedIds.filter((ids) => ids.length === 0).length
  return empty / queryRankedIds.length
}

/** Distinct seller refs represented in the top-K of one slate. */
export function distinctSellersTopK(slateIds: string[], sellerOf: (id: string) => string, k: number): number {
  return new Set(slateIds.slice(0, k).map(sellerOf)).size
}

/** Share of the slate held by the most-exposed seller (0..1). */
export function topSellerShare(slateIds: string[], sellerOf: (id: string) => string): number {
  if (slateIds.length === 0) return 0
  const counts = new Map<string, number>()
  for (const id of slateIds) {
    const s = sellerOf(id)
    counts.set(s, (counts.get(s) ?? 0) + 1)
  }
  return Math.max(...counts.values()) / slateIds.length
}
