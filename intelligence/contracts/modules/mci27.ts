/**
 * MCI-27 Merchant performance analyst — input/output contract (v0).
 *
 * Deterministic insight rules over a merchant's OWN analytics snapshot
 * (supplied by the authorised caller). Metric definitions are preserved from
 * the commerce plane (`src/lib/listing-analytics.ts`): views, CALL/WHATSAPP
 * taps, share taps — Uganda calendar day aggregates.
 *
 * Honesty guardrails, enforced in the contract and tested:
 * - A contact tap is not a sale. The word "sale(s)" may not appear in any
 *   generated statement (there is no sales data in the snapshot).
 * - Coverage gaps produce explicit warnings, not invented numbers.
 * - No cross-merchant comparison data is accepted in v0.
 */
import { z } from 'zod'

export const MCI27_CONTRACT_VERSION = '1.0'

export const MERCHANT_EVENT_METRICS = ['views', 'contact_taps', 'share_clicks'] as const

const DailyPoint = z.object({
  /** Uganda calendar day, YYYY-MM-DD (matches listing-analytics convention). */
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  views: z.number().int().nonnegative(),
  contact_taps: z.number().int().nonnegative(),
  share_clicks: z.number().int().nonnegative(),
})

export const MerchantAnalyticsSnapshot = z.object({
  /** Pseudonymous merchant ref, not a user id. */
  merchant_ref: z.string().min(1).max(128),
  period: z.object({
    /** Reporting windows supported by the existing merchant analytics API. */
    days: z.union([z.literal(7), z.literal(30), z.literal(90)]),
    /** ISO start date of the window, inclusive. */
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  }),
  shop_totals: z.object({
    views: z.number().int().nonnegative(),
    contact_taps: z.number().int().nonnegative(),
    share_clicks: z.number().int().nonnegative(),
  }),
  shop_daily: z.array(DailyPoint).max(92),
  listings: z
    .array(
      z.object({
        listing_id: z.string().min(1).max(128),
        category_id: z.string().max(64),
        status: z.enum(['ACTIVE', 'FULFILLED', 'EXPIRED', 'ARCHIVED', 'HIDDEN']),
        days_live: z.number().int().min(0).max(3650),
        views: z.number().int().nonnegative(),
        contact_taps: z.number().int().nonnegative(),
        share_clicks: z.number().int().nonnegative(),
      }),
    )
    .max(200),
  /** Optional previous-period totals for delta rules. */
  previous_period_totals: z
    .object({
      views: z.number().int().nonnegative(),
      contact_taps: z.number().int().nonnegative(),
      share_clicks: z.number().int().nonnegative(),
    })
    .nullable()
    .optional(),
})
export type MerchantAnalyticsSnapshot = z.infer<typeof MerchantAnalyticsSnapshot>

export const InsightSeverity = z.enum(['INFO', 'WATCH', 'ACTION'])
export type InsightSeverity = z.infer<typeof InsightSeverity>

export const MerchantInsight = z.object({
  id: z.string().max(64),
  severity: InsightSeverity,
  /** Metric family the insight is about; definitions are fixed constants. */
  metric: z.enum(['VIEWS', 'CONTACT_TAPS', 'SHARE_CLICKS', 'ENGAGEMENT_RATE', 'LISTING_COVERAGE', 'TREND']),
  /** Plain-language statement grounded only in supplied evidence. */
  statement: z.string().max(400),
  evidence: z
    .array(
      z.object({
        ref: z.string().max(128),
        label: z.string().max(80),
        value: z.number(),
      }),
    )
    .max(6),
  suggested_action: z.string().max(300).nullable(),
  /** Never set in v0: no calibrated confidence exists for rule insights. */
  confidence: z.null(),
})
export type MerchantInsight = z.infer<typeof MerchantInsight>

export const MCI27Result = z.object({
  insights: z.array(MerchantInsight).max(12),
  /** Static metric-definition refs so wording can never redefine metrics. */
  metric_definitions_ref: z.literal('listing-analytics.daily-events.v1'),
  coverage_warnings: z.array(z.string().max(200)).max(6),
})
export type MCI27Result = z.infer<typeof MCI27Result>

/** Forbidden phrases — the tap≠sales rule, executable. */
export const FORBIDDEN_CLAIM_PATTERNS: readonly RegExp[] = [/\bsales?\b/i, /\bsold\b/i, /\borders?\b/i]

export function assertNoUnsubstantiatedClaims(statements: readonly string[]): void {
  for (const statement of statements) {
    for (const pattern of FORBIDDEN_CLAIM_PATTERNS) {
      if (pattern.test(statement)) {
        throw new Error(`insight statement violates metric honesty rule: "${statement}"`)
      }
    }
  }
}
