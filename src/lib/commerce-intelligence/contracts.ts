/**
 * Channel-neutral contracts for Mudaala Commerce Intelligence.
 *
 * Channel adapters translate platform-specific requests into these shared
 * types. Ranking and policy decisions never depend on a provider SDK,
 * webhook payload, or external user identifier.
 */
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

export interface RecommendationContext {
  channel: CommerceChannel
  surface: RecommendationSurface
  country?: string
  locale?: string
  /** Coarse, user-authorised location only; never a precise home coordinate. */
  county?: string
  area?: string
  /** Normalised product need, not a raw external webhook payload. */
  query?: string
}

export interface ChannelInboundMessage {
  channel: CommerceChannel
  /** Provider-scoped opaque reference. Never treat this as a Mudaala user ID. */
  externalActorRef: string
  text?: string
  receivedAt: Date
  /** References to media already fetched and validated by the channel adapter. */
  mediaRefs?: string[]
}

export interface ChannelAdapter<TProviderPayload = unknown, TProviderMessage = unknown, TRecommendation = unknown> {
  readonly channel: CommerceChannel
  /** Verify provider signatures/tokens before accepting the payload. */
  verifyInbound(payload: TProviderPayload, signature: string | null): Promise<boolean>
  /** Convert provider data into a channel-neutral message. */
  normalizeInbound(payload: TProviderPayload): Promise<ChannelInboundMessage>
  /** Convert shared results into a provider-specific response. */
  presentRecommendations(message: ChannelInboundMessage, results: TRecommendation[]): Promise<TProviderMessage>
}
