/**
 * MCI-27 engine tests — rule behaviour, honesty gates, sample-size caps.
 */
import { describe, expect, test } from 'bun:test'
import { MerchantAnalyticsSnapshot, type MerchantInsight } from '../../contracts/modules/mci27'
import { MCI27_ENGINE_VERSION, MCI27_THRESHOLDS, analyzeMerchantPerformance } from './engine'

function snapshot(overrides: Partial<MerchantAnalyticsSnapshot> = {}): MerchantAnalyticsSnapshot {
  return {
    merchant_ref: 'merchant-pseudo-1',
    period: { days: 7, from: '2026-11-13' },
    shop_totals: { views: 200, contact_taps: 24, share_clicks: 8 },
    shop_daily: Array.from({ length: 7 }, (_, i) => ({
      day: `2026-11-${13 + i}`,
      views: 28,
      contact_taps: 3,
      share_clicks: 1,
    })),
    listings: [
      { listing_id: 'L-A', category_id: 'electronics-phones', status: 'ACTIVE', days_live: 30, views: 120, contact_taps: 15, share_clicks: 5 },
      { listing_id: 'L-B', category_id: 'electronics-phones', status: 'ACTIVE', days_live: 30, views: 70, contact_taps: 8, share_clicks: 3 },
      { listing_id: 'L-C', category_id: 'electronics-accessories', status: 'ACTIVE', days_live: 20, views: 10, contact_taps: 1, share_clicks: 0 },
    ],
    previous_period_totals: { views: 180, contact_taps: 20, share_clicks: 6 },
    ...overrides,
  }
}

describe('MCI-27 contact-rate rules', () => {
  test('accepts the 30-day reporting window used by My Business analytics', () => {
    const result = analyzeMerchantPerformance(snapshot({ period: { days: 30, from: '2026-10-21' } }))
    expect(result.metric_definitions_ref).toBe('listing-analytics.daily-events.v1')
  })

  test('healthy rate is INFO', () => {
    const result = analyzeMerchantPerformance(snapshot())
    const insight = result.insights.find((i) => i.id === 'CTR_HEALTHY')
    expect(insight?.severity).toBe('INFO')
    expect(insight?.confidence).toBeNull()
  })

  test('low rate escalates to ACTION with a suggested action', () => {
    const result = analyzeMerchantPerformance(snapshot({ shop_totals: { views: 200, contact_taps: 6, share_clicks: 2 } }))
    const insight = result.insights.find((i) => i.id === 'CTR_LOW')
    expect(insight?.severity).toBe('ACTION')
    expect(insight?.suggested_action).not.toBeNull()
  })

  test('zero taps with enough views is ACTION (ZERO_CONTACT)', () => {
    const result = analyzeMerchantPerformance(snapshot({ shop_totals: { views: 120, contact_taps: 0, share_clicks: 0 } }))
    expect(result.insights.some((i) => i.id === 'ZERO_CONTACT')).toBe(true)
  })

  test('insufficient views produce a coverage warning, not a made-up rate', () => {
    const result = analyzeMerchantPerformance(snapshot({ shop_totals: { views: 5, contact_taps: 1, share_clicks: 0 } }))
    expect(result.insights.some((i) => i.metric === 'ENGAGEMENT_RATE')).toBe(false)
    expect(result.coverage_warnings.join(' ')).toContain('at least')
  })
})

describe('MCI-27 trend and listing rules', () => {
  test('falling views produce a WATCH with both periods cited', () => {
    const result = analyzeMerchantPerformance(snapshot({
      previous_period_totals: { views: 400, contact_taps: 20, share_clicks: 6 },
    }))
    const insight = result.insights.find((i) => i.id === 'VIEWS_FALLING')
    expect(insight?.severity).toBe('WATCH')
    expect(insight?.evidence.length).toBe(2)
  })

  test('missing previous period is an explicit coverage warning', () => {
    const result = analyzeMerchantPerformance(snapshot({ previous_period_totals: null }))
    expect(result.coverage_warnings.join(' ')).toContain('previous-period')
    expect(result.insights.some((i) => i.metric === 'TREND')).toBe(false)
  })

  test('dead listings surface as ACTION', () => {
    const result = analyzeMerchantPerformance(snapshot({
      listings: [
        { listing_id: 'L-DEAD', category_id: 'home-kitchen', status: 'ACTIVE', days_live: 40, views: 0, contact_taps: 0, share_clicks: 0 },
        { listing_id: 'L-A', category_id: 'electronics-phones', status: 'ACTIVE', days_live: 30, views: 120, contact_taps: 15, share_clicks: 5 },
      ],
    }))
    expect(result.insights.some((i) => i.id === 'DEAD_LISTING_L-DEAD' && i.severity === 'ACTION')).toBe(true)
  })

  test('fresh listings with traction are INFO', () => {
    const result = analyzeMerchantPerformance(snapshot({
      listings: [
        { listing_id: 'L-NEW', category_id: 'home-kitchen', status: 'ACTIVE', days_live: 3, views: 25, contact_taps: 2, share_clicks: 0 },
      ],
    }))
    expect(result.insights.some((i) => i.id === 'FRESH_LISTING_L-NEW')).toBe(true)
  })

  test('view concentration is WATCH when one listing dominates', () => {
    const result = analyzeMerchantPerformance(snapshot({
      shop_totals: { views: 200, contact_taps: 24, share_clicks: 8 },
      listings: [
        { listing_id: 'L-TOP', category_id: 'home-kitchen', status: 'ACTIVE', days_live: 60, views: 180, contact_taps: 20, share_clicks: 6 },
        { listing_id: 'L-2', category_id: 'home-kitchen', status: 'ACTIVE', days_live: 60, views: 12, contact_taps: 2, share_clicks: 1 },
        { listing_id: 'L-3', category_id: 'home-kitchen', status: 'ACTIVE', days_live: 60, views: 8, contact_taps: 2, share_clicks: 1 },
      ],
    }))
    const insight = result.insights.find((i) => i.id === 'VIEWS_CONCENTRATED')
    expect(insight?.severity).toBe('WATCH')
    expect(insight?.statement).toContain('90%')
  })
})

describe('MCI-27 honesty and determinism', () => {
  test('no insight ever claims sales or orders (executable honesty gate)', () => {
    const result = analyzeMerchantPerformance(snapshot())
    const statements: string[] = result.insights.map((i: MerchantInsight) => i.statement)
    for (const statement of statements) {
      expect(statement.toLowerCase()).not.toMatch(/\b(sales?|sold|orders?)\b/)
    }
  })

  test('output is deterministic and ordered by severity', () => {
    const a = analyzeMerchantPerformance(snapshot())
    const b = analyzeMerchantPerformance(snapshot())
    expect(a).toEqual(b)
    const order = { ACTION: 0, WATCH: 1, INFO: 2 }
    const severities = a.insights.map((i) => order[i.severity])
    expect([...severities].sort((x, y) => x - y)).toEqual(severities)
  })

  test('engine version and metric-definition ref are stamped', () => {
    const result = analyzeMerchantPerformance(snapshot())
    expect(MCI27_ENGINE_VERSION).toMatch(/^mci27-merchant-performance-analyst-v/)
    expect(result.metric_definitions_ref).toBe('listing-analytics.daily-events.v1')
    expect(MCI27_THRESHOLDS.MIN_VIEWS_FOR_RATE).toBe(20)
  })
})
