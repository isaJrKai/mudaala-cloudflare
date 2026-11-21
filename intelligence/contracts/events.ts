/**
 * Mudaala Intelligence — first-party event taxonomy (v1, allowlisted).
 *
 * Master plan §6.1: versioned, allowlisted, purpose-bound events with
 * idempotency; semantics preserved from the existing commerce-plane sources
 * (`src/lib/listing-analytics.ts` event unions, `MerchantGrowthEvent` types).
 *
 * Core rule carried from the platform: a contact tap is NOT a sale, a view is
 * NOT purchase intent, and nothing in this taxonomy may be recorded as an
 * order/transaction — those types do not exist until a transaction domain does.
 */
import { z } from 'zod'

export const EVENT_SCHEMA_VERSION = '1.0'

/**
 * Allowlist. CONTACT channel detail preserves the existing analytics
 * distinction between CALL_CLICK and WHATSAPP_CLICK without inventing new
 * semantics.
 */
export const EVENT_TYPES = [
  'SEARCH_PERFORMED',
  'LISTING_VIEWED',
  'SHOP_VIEWED',
  'CONTACT_TAP',
  'SHARE_CLICK',
  'LISTING_PUBLISHED',
  'LISTING_EDITED',
  'STOCK_DECLARED',
  'GROWTH_EVENT_RECORDED',
  'INSIGHT_SERVED',
] as const
export type EventType = (typeof EVENT_TYPES)[number]

export const CONTACT_CHANNELS = ['CALL', 'WHATSAPP', 'OTHER'] as const

/** Who acted. Refs are pseudonymous; raw user ids never enter this envelope. */
export const ActorScope = z.object({
  kind: z.enum(['BUYER', 'MERCHANT', 'SYSTEM', 'ANONYMOUS']),
  ref: z.string().max(128).nullable(),
})
export type ActorScope = z.infer<typeof ActorScope>

export const EventEntity = z.object({
  kind: z.enum(['LISTING', 'SHOP', 'SEARCH', 'COLLECTION', 'SHOWROOM']),
  /** Mudaala id or a pseudonymous fixture id. */
  id: z.string().min(1).max(128),
})
export type EventEntity = z.infer<typeof EventEntity>

export const EventEnvelope = z
  .object({
    schema_version: z.literal(EVENT_SCHEMA_VERSION),
    event_id: z.string().min(8).max(128),
    event_type: z.enum(EVENT_TYPES),
    occurred_at: z.string().min(20).max(40),
    actor: ActorScope,
    entity: EventEntity,
    /** Contact detail only valid with CONTACT_TAP. */
    contact_channel: z.enum(CONTACT_CHANNELS).nullable(),
    /** Why this event is being processed; must be a declared purpose. */
    purpose: z.string().min(1).max(64),
    idempotency_key: z.string().min(8).max(128),
    /** Coarse locality only (county/area names), never coordinates. */
    coarse_location: z.string().max(64).nullable(),
  })
  .superRefine((value, ctx) => {
    if (value.event_type === 'CONTACT_TAP' && value.contact_channel === null) {
      ctx.addIssue({ code: 'custom', message: 'CONTACT_TAP requires contact_channel' })
    }
    if (value.event_type !== 'CONTACT_TAP' && value.contact_channel !== null) {
      ctx.addIssue({ code: 'custom', message: 'contact_channel is only valid on CONTACT_TAP' })
    }
  })
export type EventEnvelope = z.infer<typeof EventEnvelope>

/**
 * Documented purposes (resource matrix §6.2 data rules). Producers must use
 * one of these strings; anything else is a contract failure.
 */
export const DECLARED_PURPOSES = [
  'DISCOVERY_IMPROVEMENT',
  'MERCHANT_ANALYTICS',
  'TRUST_SAFETY_SIGNALS',
  'PLATFORM_HEALTH',
] as const
export type DeclaredPurpose = (typeof DECLARED_PURPOSES)[number]

export function validateEvent(raw: unknown): EventEnvelope {
  const event = EventEnvelope.parse(raw)
  if (!DECLARED_PURPOSES.includes(event.purpose as DeclaredPurpose)) {
    throw new Error(`undeclared purpose '${event.purpose}' — use DECLARED_PURPOSES`)
  }
  return event
}
