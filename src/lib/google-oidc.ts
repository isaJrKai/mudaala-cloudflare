// Google OpenID Connect verification for the Cloudflare Workers runtime.
// Uses WebCrypto and Google's published signing keys; never trusts client-side
// profile data or Google's tokeninfo endpoint.
export interface GoogleIdentityClaims {
  sub: string
  email: string | null
  emailVerified: boolean
}

type GoogleJwk = JsonWebKey & { kid?: string; alg?: string; use?: string }
let cachedKeys: GoogleJwk[] = []
let cachedKeysUntil = 0

function decodeBase64Url(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Malformed token encoding')
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4)
  const binary = atob(padded)
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

function decodeJsonSegment(value: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(new TextDecoder().decode(decodeBase64Url(value)))
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Malformed token claims')
  return parsed as Record<string, unknown>
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function secureRandomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function googleSigningKeys(): Promise<GoogleJwk[]> {
  if (cachedKeys.length && Date.now() < cachedKeysUntil) return cachedKeys
  const response = await fetch('https://www.googleapis.com/oauth2/v3/certs', {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(5000),
  })
  if (!response.ok) throw new Error('Google signing keys are temporarily unavailable')
  const body: unknown = await response.json()
  if (!body || typeof body !== 'object' || !Array.isArray((body as { keys?: unknown }).keys)) {
    throw new Error('Google returned invalid signing keys')
  }
  const keys = (body as { keys: GoogleJwk[] }).keys.filter((key) => key.kid && key.kty === 'RSA' && key.use === 'sig')
  if (!keys.length) throw new Error('Google signing keys are unavailable')
  cachedKeys = keys
  cachedKeysUntil = Date.now() + 5 * 60 * 1000
  return keys
}

export async function verifyGoogleIdToken(
  token: string,
  expectedAudience: string,
  expectedNonceHash: string,
): Promise<GoogleIdentityClaims> {
  if (token.length > 12_000) throw new Error('Google ID token is too large')
  const parts = token.split('.')
  if (parts.length !== 3) throw new Error('Malformed Google ID token')
  const header = decodeJsonSegment(parts[0]!)
  const claims = decodeJsonSegment(parts[1]!)
  if (header.alg !== 'RS256' || typeof header.kid !== 'string') throw new Error('Unsupported Google ID token signature')
  const key = (await googleSigningKeys()).find((candidate) => candidate.kid === header.kid)
  if (!key) {
    cachedKeysUntil = 0
    const refreshed = await googleSigningKeys()
    const refreshedKey = refreshed.find((candidate) => candidate.kid === header.kid)
    if (!refreshedKey) throw new Error('Google ID token signing key was not recognized')
    return verifyWithKey(parts, claims, refreshedKey, expectedAudience, expectedNonceHash)
  }
  return verifyWithKey(parts, claims, key, expectedAudience, expectedNonceHash)
}

async function verifyWithKey(
  parts: string[],
  claims: Record<string, unknown>,
  jwk: GoogleJwk,
  expectedAudience: string,
  expectedNonceHash: string,
): Promise<GoogleIdentityClaims> {
  const key = await crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify'],
  )
  const signingInput = new TextEncoder().encode(parts[0] + '.' + parts[1])
  const signature = decodeBase64Url(parts[2]!)
  // Copy into standalone ArrayBuffers to satisfy the strict BufferSource
  // types used by newer TypeScript DOM definitions (and avoid SharedArrayBuffer).
  const signatureBuffer = Uint8Array.from(signature).buffer as ArrayBuffer
  const signingInputBuffer = Uint8Array.from(signingInput).buffer as ArrayBuffer
  const validSignature = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    key,
    signatureBuffer,
    signingInputBuffer,
  )
  if (!validSignature) throw new Error('Google ID token signature is invalid')

  const issuer = claims.iss
  if (issuer !== 'https://accounts.google.com' && issuer !== 'accounts.google.com') {
    throw new Error('Google ID token issuer is invalid')
  }
  const audience = claims.aud
  const audiences = Array.isArray(audience) ? audience : [audience]
  if (!audiences.includes(expectedAudience)) throw new Error('Google ID token audience is invalid')
  if ((Array.isArray(audience) || claims.azp !== undefined) && claims.azp !== expectedAudience) throw new Error('Google ID token authorized party is invalid')

  const now = Math.floor(Date.now() / 1000)
  if (typeof claims.exp !== 'number' || claims.exp <= now) throw new Error('Google ID token has expired')
  if (typeof claims.iat !== 'number' || claims.iat > now + 60 || now - claims.iat > 10 * 60) {
    throw new Error('Google ID token issue time is invalid')
  }
  if (typeof claims.sub !== 'string' || !claims.sub || claims.sub.length > 255) {
    throw new Error('Google identity subject is invalid')
  }
  if (typeof claims.nonce !== 'string' || await sha256Hex(claims.nonce) !== expectedNonceHash) {
    throw new Error('Google ID token nonce does not match this sign-in attempt')
  }

  const emailVerified = claims.email_verified === true || claims.email_verified === 'true'
  if (!emailVerified || typeof claims.email !== 'string' || !/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(claims.email) || claims.email.length > 320) {
    throw new Error('Google account must have a verified email address')
  }
  return {
    sub: claims.sub,
    email: claims.email,
    emailVerified: true,
  }
}
