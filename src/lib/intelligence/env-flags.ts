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
  INTELLIGENCE_CLIENT_DISABLED?: string
}

function truthy(raw: string | undefined): boolean {
  const value = (raw ?? '').trim().toLowerCase()
  return value === '1' || value === 'true'
}

export function intelligenceClientDisabled(env: IntelligenceClientEnv): boolean {
  return truthy(env.INTELLIGENCE_CLIENT_DISABLED)
}

/** True only when every credential field is present and not disabled. */
export function intelligenceClientConfigured(env: IntelligenceClientEnv): boolean {
  if (intelligenceClientDisabled(env)) return false
  return Boolean(
    env.INTELLIGENCE_GATEWAY_URL?.trim() &&
      env.INTELLIGENCE_GATEWAY_CALLER_ID?.trim() &&
      env.INTELLIGENCE_GATEWAY_SECRET_ID?.trim() &&
      env.INTELLIGENCE_GATEWAY_SECRET?.trim(),
  )
}
