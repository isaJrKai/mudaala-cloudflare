/**
 * Mudaala Intelligence contracts — public surface.
 *
 * Everything under `intelligence/` is the intelligence plane (ADR-0001); the
 * commerce plane imports ONLY this contracts folder and the gateway client.
 */
export * from './envelope'
export * from './jobs'
export * from './events'
export * from './registry-schema'
export { MCI01_CONTRACT_VERSION, MCI01Request, MCI01Result } from './modules/mci01'
export type { CommerceChannel, RecommendationSurface } from './modules/mci01'
export { MCI02_CONTRACT_VERSION, MCI02Request, MCI02Result, validateMCI02Request } from './modules/mci02'
export { MCI03_CONTRACT_VERSION, MCI03Request, MCI03Result, RankCandidate } from './modules/mci03'
export { MCI08_CONTRACT_VERSION, MCI08Request, MCI08Result } from './modules/mci08'
export {
  MCI27_CONTRACT_VERSION,
  MerchantAnalyticsSnapshot,
  MerchantInsight,
  MCI27Result,
  assertNoUnsubstantiatedClaims,
} from './modules/mci27'
