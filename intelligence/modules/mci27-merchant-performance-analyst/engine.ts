/**
 * MCI-27 Merchant performance analyst — deterministic insight engine v0.
 *
 * Turns a merchant's OWN daily analytics snapshot into typed, grounded
 * insights. Rules use fixed thresholds and sample-size honesty caps; every
 * statement cites evidence from the snapshot; nothing is inferred beyond the
 * supplied aggregates.
 *
 * Metric definitions are preserved from the commerce plane
 * (`src/lib/listing-analytics.ts`): views, CALL/WHATSAPP contact taps and
 * share clicks recorded per Uganda calendar day. A contact tap is interest,
 * NOT a sale — the contract's honesty gate is enforced on the engine output.
 *
 * LLM wording is deliberately out of scope for v0 (see README).
 */
import {
  MerchantAnalyticsSnapshot,
  MCI27Result,
  assertNoUnsubstantiatedClaims,
  type MerchantInsight,
} from '../../contracts/modules/mci27'

export const MCI27_ENGINE_VERSION = 'mci27-merchant-performance-analyst-v0.2.0'

/** Sample-size honesty caps — below these, insights are withheld and a
 * coverage warning is emitted instead (mirrors price-trends MIN_SAMPLE). */
export const MCI27_THRESHOLDS = {
  MIN_VIEWS_FOR_RATE: 20,
  CTR_HEALTHY: 0.1,
  CTR_LOW: 0.05,
  TREND_FALL_PCT: -0.2,
  TREND_RISE_PCT: 0.2,
  DEAD_LISTING_DAYS: 14,
  MAX_DEAD_LISTING_INSIGHTS: 3,
  CONCENTRATION_SHARE: 0.8,
  CONCENTRATION_MIN_LISTINGS: 3,
  ZERO_CONTACT_MIN_VIEWS: 50,
  FRESH_LISTING_DAYS: 7,
  FRESH_LISTING_MIN_VIEWS: 10,
} as const

const SEVERITY_ORDER = { ACTION: 0, WATCH: 1, INFO: 2 } as const

function pct(value: number): string {
  return `${Math.round(value * 1000) / 10}%`
}

export function analyzeMerchantPerformance(snapshot: MerchantAnalyticsSnapshot): MCI27Result {
  // Runtime validation — the engine re-validates its own input so direct
  // callers cannot bypass the contract.
  const validated = MerchantAnalyticsSnapshot.parse(snapshot)
  const insights: MerchantInsight[] = []
  const coverageWarnings: string[] = []
  const { shop_totals, listings, previous_period_totals, period } = validated

  // 1. Contact-tap rate (interest rate), gated on a minimum sample.
  if (shop_totals.views < MCI27_THRESHOLDS.MIN_VIEWS_FOR_RATE) {
    coverageWarnings.push(
      `only ${shop_totals.views} views in the ${period.days}-day window; contact-rate insights need at least ${MCI27_THRESHOLDS.MIN_VIEWS_FOR_RATE}`,
    )
  } else {
    const rate = shop_totals.contact_taps / shop_totals.views
    if (shop_totals.contact_taps === 0) {
      insights.push({
        id: 'ZERO_CONTACT',
        severity: 'ACTION',
        metric: 'CONTACT_TAPS',
        statement: `Your shop received ${shop_totals.views} views but no contact taps in the last ${period.days} days.`,
        evidence: [
          { ref: 'shop_totals.views', label: 'views', value: shop_totals.views },
          { ref: 'shop_totals.contact_taps', label: 'contact taps', value: 0 },
        ],
        suggested_action: 'Check that product photos and descriptions make it easy to contact you.',
        confidence: null,
      })
    } else if (rate < MCI27_THRESHOLDS.CTR_LOW) {
      insights.push({
        id: 'CTR_LOW',
        severity: 'ACTION',
        metric: 'ENGAGEMENT_RATE',
        statement: `Contact taps were ${pct(rate)} of views (${shop_totals.contact_taps} from ${shop_totals.views}).`,
        evidence: [{ ref: 'shop_totals', label: 'tap rate', value: Math.round(rate * 1000) / 1000 }],
        suggested_action: 'Add clearer photos and complete product details to encourage enquiries.',
        confidence: null,
      })
    } else if (rate < MCI27_THRESHOLDS.CTR_HEALTHY) {
      insights.push({
        id: 'CTR_WATCH',
        severity: 'WATCH',
        metric: 'ENGAGEMENT_RATE',
        statement: `Contact taps were ${pct(rate)} of views (${shop_totals.contact_taps} from ${shop_totals.views}).`,
        evidence: [{ ref: 'shop_totals', label: 'tap rate', value: Math.round(rate * 1000) / 1000 }],
        suggested_action: null,
        confidence: null,
      })
    } else {
      insights.push({
        id: 'CTR_HEALTHY',
        severity: 'INFO',
        metric: 'ENGAGEMENT_RATE',
        statement: `Contact taps were ${pct(rate)} of views (${shop_totals.contact_taps} from ${shop_totals.views}).`,
        evidence: [{ ref: 'shop_totals', label: 'tap rate', value: Math.round(rate * 1000) / 1000 }],
        suggested_action: null,
        confidence: null,
      })
    }
  }

  // 2. Views trend, only when the previous period was supplied.
  if (!previous_period_totals) {
    coverageWarnings.push('no previous-period totals supplied; trend insights unavailable')
  } else if (previous_period_totals.views === 0) {
    coverageWarnings.push('previous-period views were zero; percentage trend undefined')
  } else {
    const delta = (shop_totals.views - previous_period_totals.views) / previous_period_totals.views
    if (delta <= MCI27_THRESHOLDS.TREND_FALL_PCT) {
      insights.push({
        id: 'VIEWS_FALLING',
        severity: 'WATCH',
        metric: 'TREND',
        statement: `Views fell ${pct(Math.abs(delta))} compared with the previous ${period.days}-day period.`,
        evidence: [
          { ref: 'shop_totals.views', label: 'current views', value: shop_totals.views },
          { ref: 'previous_period_totals.views', label: 'previous views', value: previous_period_totals.views },
        ],
        suggested_action: 'Refresh your listings and add photos to appear higher in Browse.',
        confidence: null,
      })
    } else if (delta >= MCI27_THRESHOLDS.TREND_RISE_PCT) {
      insights.push({
        id: 'VIEWS_RISING',
        severity: 'INFO',
        metric: 'TREND',
        statement: `Views rose ${pct(delta)} compared with the previous ${period.days}-day period.`,
        evidence: [
          { ref: 'shop_totals.views', label: 'current views', value: shop_totals.views },
          { ref: 'previous_period_totals.views', label: 'previous views', value: previous_period_totals.views },
        ],
        suggested_action: null,
        confidence: null,
      })
    }
  }

  // 3. Inactive listings: published long enough, never viewed.
  const dead = listings
    .filter((l) => l.status === 'ACTIVE' && l.days_live >= MCI27_THRESHOLDS.DEAD_LISTING_DAYS && l.views === 0)
    .slice(0, MCI27_THRESHOLDS.MAX_DEAD_LISTING_INSIGHTS)
  for (const listing of dead) {
    insights.push({
      id: `DEAD_LISTING_${listing.listing_id}`,
      severity: 'ACTION',
      metric: 'LISTING_COVERAGE',
      statement: `Listing ${listing.listing_id} has been live ${listing.days_live} days with no views.`,
      evidence: [
        { ref: `listings.${listing.listing_id}.days_live`, label: 'days live', value: listing.days_live },
        { ref: `listings.${listing.listing_id}.views`, label: 'views', value: 0 },
      ],
      suggested_action: 'Improve the title and add photos, then refresh the listing.',
      confidence: null,
    })
  }

  // 4. Single-listing reliance.
  if (listings.length >= MCI27_THRESHOLDS.CONCENTRATION_MIN_LISTINGS && shop_totals.views > 0) {
    const top = [...listings].sort((a, b) => b.views - a.views)[0]
    const share = top.views / Math.max(1, shop_totals.views)
    if (share >= MCI27_THRESHOLDS.CONCENTRATION_SHARE) {
      insights.push({
        id: 'VIEWS_CONCENTRATED',
        severity: 'WATCH',
        metric: 'LISTING_COVERAGE',
        statement: `Listing ${top.listing_id} draws ${pct(share)} of your views; the other ${listings.length - 1} listings draw little traffic.`,
        evidence: [
          { ref: `listings.${top.listing_id}.views`, label: 'top listing views', value: top.views },
          { ref: 'shop_totals.views', label: 'shop views', value: shop_totals.views },
        ],
        suggested_action: 'Bring the other listings up to the same photo and description standard.',
        confidence: null,
      })
    }
  }

  // 5. Fresh listings getting traction.
  const fresh = listings
    .filter((l) => l.days_live <= MCI27_THRESHOLDS.FRESH_LISTING_DAYS && l.views >= MCI27_THRESHOLDS.FRESH_LISTING_MIN_VIEWS)
    .slice(0, 2)
  for (const listing of fresh) {
    insights.push({
      id: `FRESH_LISTING_${listing.listing_id}`,
      severity: 'INFO',
      metric: 'VIEWS',
      statement: `Listing ${listing.listing_id} already has ${listing.views} views in its first ${listing.days_live} days.`,
      evidence: [{ ref: `listings.${listing.listing_id}.views`, label: 'views', value: listing.views }],
      suggested_action: null,
      confidence: null,
    })
  }

  // Honesty gate: the contract rejects sale/order language for any statement.
  assertNoUnsubstantiatedClaims(insights.map((i) => i.statement))

  // Stable ordering: severity, then id — deterministic output.
  insights.sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.id.localeCompare(b.id),
  )

  const result: MCI27Result = {
    insights: insights.slice(0, 12),
    metric_definitions_ref: 'listing-analytics.daily-events.v1',
    coverage_warnings: coverageWarnings.slice(0, 6),
  }
  return MCI27Result.parse(result)
}
