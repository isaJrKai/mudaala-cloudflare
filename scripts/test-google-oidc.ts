import assert from 'node:assert/strict'
import { pkceChallenge, sha256Hex, verifyGoogleIdToken } from '../src/lib/google-oidc'

const encoder = new TextEncoder()
const base64url = (value: Uint8Array | string) =>
  Buffer.from(typeof value === 'string' ? value : value).toString('base64url')

async function main() {
  const pair = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  )
  const jwk = await crypto.subtle.exportKey('jwk', pair.publicKey)
  Object.assign(jwk, { kid: 'ci-google-key', use: 'sig', alg: 'RS256' })

  const originalFetch = globalThis.fetch
  globalThis.fetch = (async () => new Response(JSON.stringify({ keys: [jwk] }), {
    status: 200,
    headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=300' },
  })) as typeof fetch

  const now = Math.floor(Date.now() / 1000)
  const nonce = 'one-time-ci-nonce'
  const verifier = '0123456789abcdef'.repeat(4)
  const expectedChallenge = base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(verifier))))
  assert.equal(await pkceChallenge(verifier), expectedChallenge, 'PKCE S256 challenge must match the RFC 7636 base64url digest')
  assert.match(await pkceChallenge(verifier), /^[A-Za-z0-9_-]{43}$/, 'PKCE challenge must be an unpadded base64url SHA-256 digest')
  const header = base64url(JSON.stringify({ alg: 'RS256', kid: 'ci-google-key', typ: 'JWT' }))

  async function token(overrides: Record<string, unknown> = {}, signer = pair.privateKey) {
    const claims = {
      iss: 'https://accounts.google.com',
      aud: 'ci-client-id',
      exp: now + 300,
      iat: now,
      sub: 'google-subject-123',
      nonce,
      email: 'seller@example.test',
      email_verified: true,
      ...overrides,
    }
    const payload = base64url(JSON.stringify(claims))
    const input = header + '.' + payload
    const signature = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', signer, encoder.encode(input)))
    return input + '.' + base64url(signature)
  }

  async function rejects(promise: Promise<unknown>, label: string) {
    let failed = false
    try { await promise } catch { failed = true }
    assert.equal(failed, true, label)
  }

  try {
    const valid = await verifyGoogleIdToken(await token(), 'ci-client-id', await sha256Hex(nonce))
    assert.deepEqual(valid, {
      sub: 'google-subject-123',
      email: 'seller@example.test',
      emailVerified: true,
    })

    await rejects(
      verifyGoogleIdToken(await token(), 'another-client-id', await sha256Hex(nonce)),
      'wrong audience must fail',
    )
    await rejects(
      verifyGoogleIdToken(await token(), 'ci-client-id', await sha256Hex('different-nonce')),
      'nonce mismatch must fail',
    )
    await rejects(
      verifyGoogleIdToken(await token({ exp: now - 1 }), 'ci-client-id', await sha256Hex(nonce)),
      'expired token must fail',
    )
    await rejects(
      verifyGoogleIdToken(await token({ iss: 'https://attacker.example' }), 'ci-client-id', await sha256Hex(nonce)),
      'wrong issuer must fail',
    )
    await rejects(
      verifyGoogleIdToken(await token({ email_verified: false }), 'ci-client-id', await sha256Hex(nonce)),
      'unverified Google email must fail',
    )
    await rejects(
      verifyGoogleIdToken(await token({ aud: ['ci-client-id', 'another-client-id'], azp: 'another-client-id' }), 'ci-client-id', await sha256Hex(nonce)),
      'wrong authorized party must fail',
    )

    const otherPair = await crypto.subtle.generateKey(
      { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
      true,
      ['sign', 'verify'],
    )
    await rejects(
      verifyGoogleIdToken(await token({}, otherPair.privateKey), 'ci-client-id', await sha256Hex(nonce)),
      'invalid signature must fail',
    )

    console.log('Google OIDC verification passed: valid RS256 token accepted; wrong audience, nonce, expiry, issuer, unverified email, authorized party and signature rejected.')
  } finally {
    globalThis.fetch = originalFetch
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
