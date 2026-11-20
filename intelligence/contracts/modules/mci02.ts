/**
 * MCI-02 Retrieval planner — input/output contract (v0).
 *
 * Deterministic query planner per the registry guardrail: no access to
 * private/draft listings; bounded query cost. The plan is plane-neutral
 * structured JSON — the commerce plane maps it onto its Prisma queries; the
 * intelligence plane can later execute the same plan against its own stores.
 */
import { z } from 'zod'
import type { MCI01Result } from './mci01'

export const MCI02_CONTRACT_VERSION = '1.0'

export const LISTING_STATUSES = ['ACTIVE', 'FULFILLED', 'EXPIRED', 'ARCHIVED', 'HIDDEN'] as const
export const LISTING_TYPES = ['OFFER', 'REQUEST'] as const

export const MCI02Request = z.object({
  query_plan: z.unknown(), // MCI01Result; validated at runtime below
  constraints: z
    .object({
      category_id: z.string().max(64).nullable().optional(),
      counties: z.array(z.string().max(64)).max(8).optional(),
      offer_request: z.enum(LISTING_TYPES).nullable().optional(),
    })
    .optional(),
  bounds: z
    .object({
      /** Candidate cap; planner may lower it, never raise above 500. */
      max_candidates: z.number().int().min(1).max(500).optional(),
    })
    .optional(),
})
export type MCI02Request = z.infer<typeof MCI02Request>

export const RetrievalFilter = z.object({
  /** Public, live inventory only — the leakage guardrail, in-band. */
  statuses: z.array(z.enum(LISTING_STATUSES)).max(2),
  types: z.array(z.enum(LISTING_TYPES)).max(2),
  categories: z.array(z.string().max(64)).max(4),
  price: z
    .object({
      currency: z.literal('UGX'),
      min: z.number().int().nonnegative().nullable(),
      max: z.number().int().nonnegative().nullable(),
    })
    .nullable(),
  counties: z.array(z.string().max(64)).max(8),
  /** Keyword terms to match against title/description, in priority order. */
  keywords: z.array(z.string().max(64)).max(16),
})
export type RetrievalFilter = z.infer<typeof RetrievalFilter>

export const RetrievalPath = z.object({
  kind: z.enum(['KEYWORD', 'CATEGORY', 'PRICE', 'AREA']),
  /** Which filter fields this path relies on. */
  uses: z.array(z.enum(['keywords', 'categories', 'price', 'counties'])).max(4),
  /** Expected selectivity, coarse: planner-only heuristic, not a promise. */
  expected_selectivity: z.enum(['NARROW', 'MEDIUM', 'BROAD']),
})
export type RetrievalPath = z.infer<typeof RetrievalPath>

export const MCI02Result = z.object({
  filters: RetrievalFilter,
  paths: z.array(RetrievalPath).max(4),
  ordering: z.enum(['RELEVANCE', 'PRICE_ASC', 'PRICE_DESC', 'FRESHNESS']),
  limits: z.object({
    candidate_cap: z.number().int().min(1).max(500),
  }),
  /** Always present in v0 so consumers can assert the guarantee. */
  exclusion_rules: z.array(z.enum(['NO_PRIVATE_OR_DRAFT', 'NO_EXPIRED', 'NO_HIDDEN', 'NO_SEED_LISTINGS'])),
  /** v0 has no semantic/vector path; recorded explicitly, not silently. */
  semantic_path_available: z.literal(false),
})
export type MCI02Result = z.infer<typeof MCI02Result>

/** Runtime validator that ties the plan to the upstream query-plan type. */
export function validateMCI02Request(raw: unknown): { queryPlan: MCI01Result; request: z.infer<typeof MCI02Request> } {
  const parsed = MCI02Request.parse(raw)
  // Minimal structural check here; full validation happens in the engine via
  // the MCI-01 contract, keeping this file free of a circular import.
  if (typeof parsed.query_plan !== 'object' || parsed.query_plan === null) {
    throw new Error('query_plan must be an MCI01Result')
  }
  return { queryPlan: parsed.query_plan as MCI01Result, request: parsed }
}
