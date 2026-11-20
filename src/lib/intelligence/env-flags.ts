// Mudaala — intelligence gateway feature flags.
// Follows the repo's env-flags pattern (src/lib/env-flags.ts): pure functions,
// no framework imports, anything unset/0/false keeps the safe default.
//
// The gateway client is OFF unless explicitly configured with URL + caller
// identity + secret. There is no partial enablement: a missing secret means
// the client is disabled and every call returns null (deterministic fallback).

export interface IntelligenceClientEnv {
  INTELLIGENCE_GATEWAY_URL?: string
  INTELLIGENCE_GATEWAY_CALLER_ID?: string
  INTELLIGENCE_GATEWAY_SECRET_ID?: string
  INTELLIGENCE_GATEWAY_SECRET?: string
  /** Independent HMAC key for merchant pseudonyms; never reuse the gateway signing secret. */
  INTELLIGENCE_MERCHANT_PSEUDONYM_SECRET?: string
  INTELLIGENCE_CLIENT_DISABLED?: string
  /** Explicit opt-in for the merchant-analytics intelligence slice. Off by default. */
  INTELLIGENCE_MCI27_ENABLED?: string
  /** Explicit opt-in for MCI-01/02/03/08 search enrichment. Off by default. */
  INTELLIGENCE_DISCOVERY_ENABLED?: string
}

// Next.js's ProcessEnv carries the same string-valued keys but its declared
// index signature does not satisfy the weak-type check against an
// all-optional interface, so raw `process.env` call sites in the commerce app
// fail the root tsconfig. The flags only ever read their own keys, so any
// string-valued record is accepted; worker deployments keep passing their
// narrowed env object and compile under both configs unchanged.
export type IntelligenceEnvSource = IntelligenceClientEnv | Record<string, string | undefined>

function truthy(raw: string | undefined): boolean {
  const value = (raw ?? '').trim().toLowerCase()
  return value === '1' || value === 'true'
}

export function mci27IntelligenceEnabled(env: IntelligenceEnvSource): boolean {
  return truthy(env.INTELLIGENCE_MCI27_ENABLED)
}

export function mciDiscoveryIntelligenceEnabled(env: IntelligenceEnvSource): boolean {
  return truthy(env.INTELLIGENCE_DISCOVERY_ENABLED)
}

export function intelligenceClientDisabled(env: IntelligenceEnvSource): boolean {
  return truthy(env.INTELLIGENCE_CLIENT_DISABLED)
}

/** True only when every credential field is present and not disabled. */
export function intelligenceClientConfigured(env: IntelligenceEnvSource): boolean {
  if (intelligenceClientDisabled(env)) return false
  return Boolean(
    env.INTELLIGENCE_GATEWAY_URL?.trim() &&
      env.INTELLIGENCE_GATEWAY_CALLER_ID?.trim() &&
      env.INTELLIGENCE_GATEWAY_SECRET_ID?.trim() &&
      env.INTELLIGENCE_GATEWAY_SECRET?.trim(),
  )
}
