/**
 * Gateway authentication tests — signing, verification, replay, skew, scopes.
 */
import { describe, expect, test } from 'bun:test'
import {
  buildCanonicalString,
  parseCallerRegistry,
  scopeAllowed,
  signRequest,
  timingSafeEqualHex,
  verifyServiceAuth,
  type CallerConfig,
} from './auth'
import { sha256Hex } from './auth'

const TEST_CALLER: CallerConfig = {
  callerId: 'mudaala-commerce',
  secretId: 'key-2026-11',
  secret: 'test-secret-do-not-use-in-prod',
  scopes: ['search:understand', 'search:rank', 'merchant:insights'],
  rateLimitPerMinute: 60,
  enabled: true,
}

function registry(): Map<string, CallerConfig> {
  return new Map([[TEST_CALLER.callerId, TEST_CALLER]])
}

describe('signing helpers', () => {
  test('canonical string is exactly the six newline-joined fields', () => {
    const canonical = buildCanonicalString({
      callerId: 'c',
      secretId: 's',
      method: 'POST',
      path: '/v1/search/understand',
      timestamp: '123',
      bodyHash: 'abc',
    })
    expect(canonical).toBe('c\ns\nPOST\n/v1/search/understand\n123\nabc')
  })

  test('sha256Hex is stable', async () => {
    const hash = await sha256Hex(new TextEncoder().encode('hello'))
    expect(hash).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824')
  })

  test('timing-safe comparison rejects differing lengths', () => {
    expect(timingSafeEqualHex('ab', 'abc')).toBe(false)
    expect(timingSafeEqualHex('ab', 'ab')).toBe(true)
  })
})

describe('verifyServiceAuth', () => {
  test('a correctly signed request verifies (golden flow)', async () => {
    const body = '{"query":"kitenge dresses"}'
    const url = 'https://gateway.internal/v1/search/understand'
    const timestamp = '1768938000'
    const nonce = 'nonce-golden-1'
    const { headers } = await signRequest({
      secret: TEST_CALLER.secret,
      callerId: TEST_CALLER.callerId,
      secretId: TEST_CALLER.secretId,
      method: 'POST',
      path: '/v1/search/understand',
      timestamp,
      body,
      nonce,
    })
    const request = new Request(url, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body })
    const result = await verifyServiceAuth({ request, bodyText: body, callers: registry(), nowSeconds: 1768938000 })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.caller.callerId).toBe('mudaala-commerce')
      expect(result.nonce).toBe('nonce-golden-1')
    }
  })

  test('tampered body fails signature verification', async () => {
    const body = '{"query":"kitenge dresses"}'
    const { headers } = await signRequest({
      secret: TEST_CALLER.secret,
      callerId: TEST_CALLER.callerId,
      secretId: TEST_CALLER.secretId,
      method: 'POST',
      path: '/v1/search/understand',
      timestamp: '1768938000',
      body,
      nonce: 'n-2',
    })
    const request = new Request('https://gateway.internal/v1/search/understand', {
      method: 'POST',
      headers,
      body: '{"query":"TAMPERED"}',
    })
    const result = await verifyServiceAuth({ request, bodyText: '{"query":"TAMPERED"}', callers: registry(), nowSeconds: 1768938000 })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('AUTH_BAD_SIGNATURE')
  })

  test('wrong secret fails with AUTH_BAD_SIGNATURE', async () => {
    const body = '{}'
    const { headers } = await signRequest({
      secret: 'attacker-secret',
      callerId: TEST_CALLER.callerId,
      secretId: TEST_CALLER.secretId,
      method: 'POST',
      path: '/v1/search/rank',
      timestamp: '1768938000',
      body,
      nonce: 'n-3',
    })
    const request = new Request('https://gateway.internal/v1/search/rank', { method: 'POST', headers, body })
    const result = await verifyServiceAuth({ request, bodyText: body, callers: registry(), nowSeconds: 1768938000 })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('AUTH_BAD_SIGNATURE')
  })

  test('stale timestamp fails with AUTH_CLOCK_SKEW', async () => {
    const body = '{}'
    const { headers } = await signRequest({
      secret: TEST_CALLER.secret,
      callerId: TEST_CALLER.callerId,
      secretId: TEST_CALLER.secretId,
      method: 'POST',
      path: '/v1/search/rank',
      timestamp: '1768937000', // 1000s older than nowSeconds
      body,
      nonce: 'n-4',
    })
    const request = new Request('https://gateway.internal/v1/search/rank', { method: 'POST', headers, body })
    const result = await verifyServiceAuth({ request, bodyText: body, callers: registry(), nowSeconds: 1768938000 })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('AUTH_CLOCK_SKEW')
  })

  test('missing headers fail with AUTH_MISSING', async () => {
    const request = new Request('https://gateway.internal/v1/search/rank', { method: 'POST', body: '{}' })
    const result = await verifyServiceAuth({ request, bodyText: '{}', callers: registry(), nowSeconds: 1768938000 })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('AUTH_MISSING')
  })

  test('unknown caller fails closed', async () => {
    const body = '{}'
    const { headers } = await signRequest({
      secret: 'any',
      callerId: 'intruder',
      secretId: 'k',
      method: 'POST',
      path: '/v1/search/rank',
      timestamp: '1768938000',
      body,
      nonce: 'n-5',
    })
    const request = new Request('https://gateway.internal/v1/search/rank', { method: 'POST', headers, body })
    const result = await verifyServiceAuth({ request, bodyText: body, callers: registry(), nowSeconds: 1768938000 })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('AUTH_BAD_SIGNATURE')
  })
})

describe('scopes and caller registry', () => {
  test('scope enforcement is exact-match', () => {
    expect(scopeAllowed(TEST_CALLER, 'search:rank')).toBe(true)
    expect(scopeAllowed(TEST_CALLER, 'jobs:submit')).toBe(false)
    expect(scopeAllowed(TEST_CALLER, 'search:anything')).toBe(false)
  })

  test('registry parser validates and rejects malformed entries', () => {
    const parsed = parseCallerRegistry(JSON.stringify({
      'mudaala-commerce': { secretId: 'k1', secret: 's', scopes: ['search:rank'], rateLimitPerMinute: 120, enabled: true },
      disabled: { secretId: 'k2', secret: 's2', scopes: [], enabled: false },
    }))
    expect(parsed.size).toBe(2)
    expect(parsed.get('mudaala-commerce')?.rateLimitPerMinute).toBe(120)
    expect(parsed.get('disabled')?.enabled).toBe(false)
    expect(() => parseCallerRegistry('not json')).toThrow()
    expect(() => parseCallerRegistry('{"x":{"secretId":"k"}}')).toThrow()
  })

  test('empty registry is valid (fresh deployment before secrets)', () => {
    expect(parseCallerRegistry(undefined).size).toBe(0)
  })
})
