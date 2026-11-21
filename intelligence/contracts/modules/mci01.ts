/**
 * MCI-01 Query understanding — input/output contract (v0).
 *
 * Deterministic v0 per ADR-0003. The contract preserves the original query
 * verbatim (registry guardrail: "Must preserve original query") and carries
 * explicit ambiguity rather than forcing a single interpretation.
 *
 * Channel/surface vocabularies intentionally mirror the unmerged PR #235
 * `src/lib/commerce-intelligence/contracts.ts` so the commerce core and the
 * intelligence plane converge on one vocabulary.
 */
import { z } from 'zod'

export const MCI01_CONTRACT_VERSION = '1.0'

export const COMMERCE_CHANNELS = [
  'WEB',
  'PWA',
  'WHATSAPP',
  'FACEBOOK',
  'MESSENGER',
  'INSTAGRAM',
  'X',
  'LINKEDIN',
] as const
export type CommerceChannel = (typeof COMMERCE_CHANNELS)[number]

export const RECOMMENDATION_SURFACES = [
  'BROWSE',
  'SEARCH',
  'PRODUCT_DETAIL',
  'SHOP_PAGE',
  'WHATSAPP_ASSISTANT',
  'SOCIAL_INBOUND',
  'MERCHANT_WORKSPACE',
  'SUPPLIER_DISCOVERY',
] as const
export type RecommendationSurface = (typeof RECOMMENDATION_SURFACES)[number]

export const MCI01Request = z.object({
  /** Raw query text, 1–256 chars (mirrors commerce search caps). */
  query: z.string().min(1).max(256),
  locale: z.string().max(16).optional(),
  channel: z.enum(COMMERCE_CHANNELS).optional(),
  surface: z.enum(RECOMMENDATION_SURFACES).optional(),
  /** Reference time for freshness-dependent interpretation (tests inject). */
  now: z.string().optional(),
})
export type MCI01Request = z.infer<typeof MCI01Request>

export const PriceFilter = z.object({
  currency: z.literal('UGX'),
  min: z.number().int().nonnegative().nullable(),
  max: z.number().int().nonnegative().nullable(),
  /** The verbatim sub-expression the filter was derived from (auditability). */
  raw_expression: z.string().max(64),
})
export type PriceFilter = z.infer<typeof PriceFilter>

export const CategoryHint = z.object({
  /** Taxonomy node id (see src/lib/product-taxonomy.ts). */
  category_id: z.string().min(1).max(64),
  source: z.enum(['CONCEPT', 'TOKEN']),
  score: z.number().min(0).max(1),
})
export type CategoryHint = z.infer<typeof CategoryHint>

export const MCI01Result = z.object({
  /** Always byte-identical to the request query. */
  original_query: z.string(),
  normalized_text: z.string().max(256),
  tokens: z.array(z.string().max(64)).max(32),
  /** Best-effort language hints; 'unknown' is a valid, expected value. */
  language_hints: z.array(z.enum(['en', 'lg', 'sw', 'mixed', 'unknown'])).max(4),
  intent: z.enum(['SEARCH', 'BROWSE', 'UNKNOWN']),
  price_filter: PriceFilter.nullable(),
  sort_preference: z.enum(['RELEVANCE', 'PRICE_ASC', 'PRICE_DESC', 'FRESHNESS']).nullable(),
  category_hints: z.array(CategoryHint).max(4),
  offer_request: z.enum(['OFFER', 'REQUEST']).nullable(),
  ambiguity: z.object({
    level: z.enum(['LOW', 'MEDIUM', 'HIGH']),
    notes: z.array(z.string().max(120)).max(4),
  }),
})
export type MCI01Result = z.infer<typeof MCI01Result>
