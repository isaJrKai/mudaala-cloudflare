/**
 * MCI-03 Product relevance ranker — deterministic baseline engine v0.
 *
 * Explainable additive scoring in the spirit of the audited commerce baseline
 * (`src/lib/discovery-ranking.ts`), re-expressed as a versioned intelligence-
 * plane engine with its own fixtures and evaluation (ADR-0003 §3).
 *
 * Weights are exported constants (provenance `mci03.weights.v0`); changing
 * them is a version bump that must re-run the benchmark harness.
 *
 * Honest behaviours:
 * - relevance floor: a candidate matching any query token never scores below
 *   the floor when a text query is present (mirrors commerce convention);
 * - unknown availability is treated as neutral, out-of-stock is penalised,
 *   never as absence of the listing;
 * - no per-user state: personalisation belongs to MCI-04.
 */
import { MCI01Result } from '../../contracts/modules/mci01'
import { MCI03Result, RankCandidate, type RankedItem } from '../../contracts/modules/mci03'
import { z } from 'zod'

export const MCI03_ENGINE_VERSION = 'mci03-ranker-v0.2.0'
export const MCI03_WEIGHTS_REF = 'mci03.weights.v0'

export const MCI03_WEIGHTS = {
  /** Text relevance budget (title coverage + description + category hint). */
  TEXT_MAX: 40,
  TEXT_TITLE_SHARE: 32,
  TEXT_DESCRIPTION_SHARE: 8,
  TEXT_CATEGORY_BONUS: 8,
  RELEVANCE_FLOOR: 8,
  /** Freshness from refreshed_at, half-life style decay over a week. */
  FRESHNESS_MAX: 18,
  FRESHNESS_TAU_HOURS: 168,
  /** Engagement from aggregate counts only (no viewer identity). */
  ENGAGEMENT_MAX: 18,
  ENGAGEMENT_SCALE: 200,
  ENGAGEMENT_TAP_WEIGHT: 3,
  ENGAGEMENT_SHARE_WEIGHT: 2,
  /** Locality: caller-authorised coarse context only. */
  LOCALITY_COUNTY: 9,
  LOCALITY_AREA: 5,
  /** Availability: UNKNOWN is neutral (never treated as available or dead). */
  AVAILABILITY_IN_STOCK: 4,
  AVAILABILITY_ON_ORDER: 2,
  AVAILABILITY_OUT_OF_STOCK: -10,
  /** New-shop opportunity boost (coarse band supplied by caller). */
  NEW_SHOP_BOOST: 3,
} as const

const HOUR_MS = 3_600_000

function tokenizeForMatch(text: string): Set<string> {
  return new Set(
    text
      .normalize('NFKD')
      .replace(/\p{M}/gu, '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/u)
      .filter((t) => t.length >= 2),
  )
}

function coverage(queryTokens: string[], text: string): number {
  if (queryTokens.length === 0) return 0
  const tokens = tokenizeForMatch(text)
  let hits = 0
  for (const t of queryTokens) if (tokens.has(t)) hits++
  return hits / queryTokens.length
}

function freshnessPoints(refreshedAt: string, nowMs: number): number {
  const ts = Date.parse(refreshedAt)
  if (!Number.isFinite(ts)) return 0
  const ageHours = Math.max(0, (nowMs - ts) / HOUR_MS)
  return MCI03_WEIGHTS.FRESHNESS_MAX * Math.exp(-ageHours / MCI03_WEIGHTS.FRESHNESS_TAU_HOURS)
}

function engagementPoints(c: RankCandidate): number {
  const e = c.engagement
  if (!e) return 0
  const weighted = e.views + MCI03_WEIGHTS.ENGAGEMENT_TAP_WEIGHT * e.contact_taps + MCI03_WEIGHTS.ENGAGEMENT_SHARE_WEIGHT * e.share_clicks
  const scaled = Math.log1p(weighted) / Math.log1p(MCI03_WEIGHTS.ENGAGEMENT_SCALE)
  return Math.min(MCI03_WEIGHTS.ENGAGEMENT_MAX, MCI03_WEIGHTS.ENGAGEMENT_MAX * scaled)
}

function availabilityPoints(c: RankCandidate): number {
  switch (c.availability) {
    case 'IN_STOCK':
      return MCI03_WEIGHTS.AVAILABILITY_IN_STOCK
    case 'AVAILABLE_ON_ORDER':
      return MCI03_WEIGHTS.AVAILABILITY_ON_ORDER
    case 'OUT_OF_STOCK':
      return MCI03_WEIGHTS.AVAILABILITY_OUT_OF_STOCK
    default:
      return 0 // UNKNOWN stays neutral
  }
}

export function rankCandidates(
  queryPlan: MCI01Result,
  candidates: RankCandidate[],
  context: { county?: string | null; area?: string | null; now?: string } = {},
): MCI03Result {
  // Runtime validation — direct engine callers get the same boundary as the
  // gateway; TypeScript types are not runtime validation.
  const validatedPlan = MCI01Result.parse(queryPlan)
  const validatedCandidates = z.array(RankCandidate).max(500).parse(candidates)
  const nowMs = context.now ? Date.parse(context.now) : Date.now()
  const queryTokens = validatedPlan.tokens
  const hasQuery = queryTokens.length > 0
  const hintCategories = new Set(validatedPlan.category_hints.map((h) => h.category_id))
  const ranked: RankedItem[] = []

  for (const candidate of validatedCandidates) {
    const contributions: Record<string, number> = {}
    const reasons: string[] = []

    // Text relevance.
    const titleCoverage = coverage(queryTokens, candidate.title)
    const descriptionCoverage = candidate.description ? coverage(queryTokens, candidate.description) : 0
    let text =
      MCI03_WEIGHTS.TEXT_TITLE_SHARE * titleCoverage +
      MCI03_WEIGHTS.TEXT_DESCRIPTION_SHARE * descriptionCoverage
    if (hintCategories.size > 0 && hintCategories.has(candidate.category_id)) {
      text += MCI03_WEIGHTS.TEXT_CATEGORY_BONUS
      reasons.push(`category matches intent: ${candidate.category_id}`)
    }
    if (hasQuery && titleCoverage > 0) {
      text = Math.max(text, MCI03_WEIGHTS.RELEVANCE_FLOOR)
      reasons.push('matches query terms')
    }
    contributions.text_relevance = Math.round(text * 100) / 100

    // Freshness (refresh-based, mirroring commerce semantics).
    const freshness = freshnessPoints(candidate.refreshed_at, nowMs)
    contributions.freshness = Math.round(freshness * 100) / 100

    // Engagement (aggregate only).
    const engagement = engagementPoints(candidate)
    contributions.engagement = Math.round(engagement * 100) / 100
    if (candidate.engagement && candidate.engagement.contact_taps > 0) {
      reasons.push(`contact taps: ${candidate.engagement.contact_taps}`)
    }

    // Locality (caller-supplied context only).
    let locality = 0
    if (context.county && candidate.county === context.county) locality += MCI03_WEIGHTS.LOCALITY_COUNTY
    if (context.area && candidate.area === context.area) locality += MCI03_WEIGHTS.LOCALITY_AREA
    contributions.locality = locality
    if (locality > 0) reasons.push('same locality as buyer context')

    // Availability + new-shop opportunity.
    const availability = availabilityPoints(candidate)
    contributions.availability = availability
    if (availability < 0) reasons.push('declared out of stock')
    if (candidate.shop_size_band === 'NEW') {
      contributions.new_shop = MCI03_WEIGHTS.NEW_SHOP_BOOST
      reasons.push('new shop opportunity boost')
    }

    let score = Object.values(contributions).reduce((a, b) => a + b, 0)
    if (hasQuery && titleCoverage > 0 && score < MCI03_WEIGHTS.RELEVANCE_FLOOR) {
      score = MCI03_WEIGHTS.RELEVANCE_FLOOR
    }
    score = Math.round(score * 100) / 100

    ranked.push({
      listing_id: candidate.listing_id,
      score,
      reasons: reasons.slice(0, 6),
      contributions,
    })
  }

  ranked.sort((a, b) => b.score - a.score || a.listing_id.localeCompare(b.listing_id))

  return {
    ranked,
    engine_version: MCI03_ENGINE_VERSION,
    weights_ref: MCI03_WEIGHTS_REF,
  }
}
