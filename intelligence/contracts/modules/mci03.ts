/**
 * MCI-03 Product relevance ranker — input/output contract (v0 deterministic).
 *
 * Privacy invariants in-band:
 * - Sellers are pseudonymous `seller_ref` values, never Mudaala user ids.
 * - Engagement is coarse aggregate counts supplied by the caller; the ranker
 *   keeps no per-user state and performs no personalisation (MCI-04 is a
 *   separate, consent-gated module).
 */
import { z } from 'zod'
import { COMMERCE_CHANNELS, RECOMMENDATION_SURFACES } from './mci01'

export const MCI03_CONTRACT_VERSION = '1.1'

export const AVAILABILITY_STATUSES = ['UNKNOWN', 'IN_STOCK', 'AVAILABLE_ON_ORDER', 'OUT_OF_STOCK'] as const

export const RankCandidate = z.object({
  listing_id: z.string().min(1).max(128),
  /** Pseudonymous seller reference — never a raw user id. */
  seller_ref: z.string().min(1).max(128),
  category_id: z.string().max(64),
  title: z.string().max(200),
  description: z.string().max(2000).nullable(),
  price: z.number().finite().nonnegative().nullable(),
  currency: z.string().max(8),
  county: z.string().max(64).nullable(),
  area: z.string().max(64).nullable(),
  published_at: z.string(),
  refreshed_at: z.string(),
  /** Aggregate engagement (daily-rollup style, no viewer identity). */
  engagement: z
    .object({
      views: z.number().int().nonnegative(),
      contact_taps: z.number().int().nonnegative(),
      share_clicks: z.number().int().nonnegative(),
    })
    .optional(),
  availability: z.enum(AVAILABILITY_STATUSES).optional(),
  /** Coarse shop-size band for fairness features; no revenue/wealth proxies. */
  shop_size_band: z.enum(['NEW', 'SMALL', 'MEDIUM', 'LARGE']).optional(),
})
export type RankCandidate = z.infer<typeof RankCandidate>

export const MCI03Request = z.object({
  query_plan: z.unknown(), // MCI01Result, validated by the engine
  candidates: z.array(RankCandidate).max(500),
  context: z.object({
    channel: z.enum(COMMERCE_CHANNELS).optional(),
    surface: z.enum(RECOMMENDATION_SURFACES).optional(),
    county: z.string().max(64).nullable().optional(),
    area: z.string().max(64).nullable().optional(),
    now: z.string().optional(),
  }),
})
export type MCI03Request = z.infer<typeof MCI03Request>

export const RankedItem = z.object({
  listing_id: z.string(),
  score: z.number().min(0),
  /** Human-explainable reasons (mirrors commerce ranking convention). */
  reasons: z.array(z.string().max(120)).max(6),
  /** Normalised feature contributions — the future ML feature vector. */
  contributions: z.record(z.string(), z.number()),
})
export type RankedItem = z.infer<typeof RankedItem>

export const MCI03Result = z.object({
  ranked: z.array(RankedItem).max(500),
  engine_version: z.string().max(64),
  /** Weights ref for provenance (e.g. `mci03.weights.v0`). */
  weights_ref: z.string().max(64),
})
export type MCI03Result = z.infer<typeof MCI03Result>
