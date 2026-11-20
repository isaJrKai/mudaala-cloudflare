/**
 * Gateway client tests — flag gating, golden signing parity, bounded failure
 * posture (null, never throw), circuit breaker, single skew retry.
 */
import { describe, expect, test } from 'bun:test'
import {
  clientConfigFromEnv,
  createGatewayClient,
  signGatewayRequest,
  type GatewayClientConfig,
} from './gateway-client'
import { intelligenceClientConfigured, intelligenceClientDisabled } from './env-flags'

const CONFIG: GatewayClientConfig = {
  url: 'https://gateway.internal',
  callerId: 'mudaala-commerce',
  secretId: 'key-2026-11',
  secret: 'test-secret-do-not-use-in-prod',
}

function okResponse(envelope: unknown): Response {
  return new Response(JSON.stringify(envelope), { status: 200 })
}

function errorResponse(status: number, code: string): Response {
  return new Response(JSON.stringify({ error: { code, message: 'x', trace_id: 't', retryable: false } }), { status })
}

describe('env flags', () => {
  const fullEnv = {
    INTELLIGENCE_GATEWAY_URL: 'https://gateway.internal',
    INTELLIGENCE_GATEWAY_CALLER_ID: 'mudaala-commerce',
    INTELLIGENCE_GATEWAY_SECRET_ID: 'key-2026-11',
    INTELLIGENCE_GATEWAY_SECRET: 's',
  }

  test('client is configured only with every credential present', () => {
    expect(intelligenceClientConfigured(fullEnv)).toBe(true)
    expect(intelligenceClientConfigured({ ...fullEnv, INTELLIGENCE_GATEWAY_SECRET: undefined })).toBe(false)
    expect(intelligenceClientConfigured({})).toBe(false)
  })

  test('kill switch wins over full configuration', () => {
    expect(intelligenceClientDisabled({ INTELLIGENCE_CLIENT_DISABLED: 'true' })).toBe(true)
    expect(intelligenceClientConfigured({ ...fullEnv, INTELLIGENCE_CLIENT_DISABLED: 'true' })).toBe(false)
  })
})

describe('golden signing parity with the gateway', () => {
  test('signature matches the gateway signer output for the same canonical input', async () => {
    // Golden vector computed once with intelligence/gateway/src/auth.ts
    // signRequest (bun): canonical = callerId \n secretId \n METHOD \n path
    // \n timestamp \n sha256(body). If either side changes its canonical
    // string or HMAC, this test breaks — that is the point.
    const headers = await signGatewayRequest(
      { url: 'https://gateway.internal', callerId: 'golden-caller', secretId: 'golden-key', secret: 'golden-secret' },
      { method: 'POST', path: '/v1/search/understand', timestamp: '1768938000', body: '{"query":"golden"}', nonce: 'golden-nonce' },
    )
    expect(headers['x-mudaala-caller']).toBe('golden-caller')
    expect(headers['x-mudaala-secret-id']).toBe('golden-key')
    expect(headers['x-mudaala-timestamp']).toBe('1768938000')
    expect(headers['x-mudaala-nonce']).toBe('golden-nonce')
    expect(headers['x-mudaala-signature']).toBe('f434ad666750228a4b16be4cf93ec405a1bd2b0b1a42e37423713258eb14784f')
  })
})

describe('client failure posture', () => {
  test('disabled client returns CLIENT_DISABLED without any network call', async () => {
    let fetchCalls = 0
    const client = createGatewayClient(null, {
      fetchImpl: (() => {
        fetchCalls++
        throw new Error('must not fetch')
      }) as typeof fetch,
    })
    const result = await client.call('/v1/search/understand', { query: 'rice' })
    expect(result).toEqual({ ok: false, reason: 'CLIENT_DISABLED' })
    expect(fetchCalls).toBe(0)
  })

  test('network errors become ok:false, never thrown', async () => {
    const client = createGatewayClient(CONFIG, {
      fetchImpl: (() => Promise.reject(new Error('dns failure'))) as typeof fetch,
    })
    const result = await client.call('/v1/search/understand', { query: 'rice' })
    expect(result).toEqual({ ok: false, reason: 'NETWORK_ERROR' })
  })

  test('timeouts are reported as TIMEOUT', async () => {
    const client = createGatewayClient(CONFIG, {
      fetchImpl: ((_input, init) => new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))
      })) as typeof fetch,
      timeoutMs: 20,
    })
    const result = await client.call('/v1/search/understand', { query: 'rice' })
    expect(result).toEqual({ ok: false, reason: 'TIMEOUT' })
  })

  test('gateway error statuses are GATEWAY_ERROR (no envelope leakage)', async () => {
    const client = createGatewayClient(CONFIG, {
      fetchImpl: (() => Promise.resolve(errorResponse(500, 'MODULE_INTERNAL'))) as typeof fetch,
    })
    const result = await client.call('/v1/search/rank', {})
    expect(result).toEqual({ ok: false, reason: 'GATEWAY_ERROR' })
  })

  test('malformed JSON is INVALID_RESPONSE', async () => {
    const client = createGatewayClient(CONFIG, {
      fetchImpl: (() => Promise.resolve(new Response('not json', { status: 200 }))) as typeof fetch,
    })
    const result = await client.call('/v1/search/understand', { query: 'rice' })
    expect(result).toEqual({ ok: false, reason: 'INVALID_RESPONSE' })
  })
})

describe('circuit breaker and retry bounds', () => {
  test('breaker opens after the failure threshold and stops calling fetch', async () => {
    let fetchCalls = 0
    const client = createGatewayClient(CONFIG, {
      fetchImpl: (() => {
        fetchCalls++
        return Promise.resolve(errorResponse(500, 'MODULE_INTERNAL'))
      }) as typeof fetch,
      breaker: { failureThreshold: 3, openMs: 60_000 },
    })
    for (let i = 0; i < 3; i++) await client.call('/v1/search/rank', {})
    expect(fetchCalls).toBe(3)
    expect(client.breakerState()).toBe('open')
    const result = await client.call('/v1/search/rank', {})
    expect(result).toEqual({ ok: false, reason: 'BREAKER_OPEN' })
    expect(fetchCalls).toBe(3) // no further network calls while open
  })

  test('success resets the failure count', async () => {
    let calls = 0
    const client = createGatewayClient(CONFIG, {
      fetchImpl: (() => {
        calls++
        if (calls <= 2) return Promise.resolve(errorResponse(500, 'MODULE_INTERNAL'))
        return Promise.resolve(okResponse({ module_id: 'MCI-01', result: {} }))
      }) as typeof fetch,
      breaker: { failureThreshold: 3, openMs: 60_000 },
    })
    await client.call('/v1/search/understand', { query: 'a' })
    await client.call('/v1/search/understand', { query: 'b' })
    const success = await client.call('/v1/search/understand', { query: 'c' })
    expect(success.ok).toBe(true)
    expect(client.breakerState()).toBe('closed')
    // Failure count reset: two more failures must not trip the breaker.
    await client.call('/v1/search/understand', { query: 'd' })
    await client.call('/v1/search/understand', { query: 'e' })
    expect(client.breakerState()).toBe('closed')
  })

  test('clock-skew rejection is retried exactly once with fresh nonce/timestamp', async () => {
    const seenTimestamps: string[] = []
    const seenNonces: string[] = []
    let callCount = 0
    const client = createGatewayClient(CONFIG, {
      nowSeconds: () => 1_768_938_000,
      fetchImpl: ((_url, init) => {
        callCount++
        const headers = (init?.headers ?? {}) as Record<string, string>
        seenTimestamps.push(headers['x-mudaala-timestamp'])
        seenNonces.push(headers['x-mudaala-nonce'])
        if (callCount === 1) return Promise.resolve(errorResponse(401, 'AUTH_CLOCK_SKEW'))
        return Promise.resolve(okResponse({ module_id: 'MCI-01', result: {} }))
      }) as typeof fetch,
    })
    const result = await client.call('/v1/search/understand', { query: 'rice' })
    expect(result.ok).toBe(true)
    expect(callCount).toBe(2)
    expect(seenNonces[0]).not.toBe(seenNonces[1])
  })

  test('non-skew auth failures are NOT retried', async () => {
    let callCount = 0
    const client = createGatewayClient(CONFIG, {
      fetchImpl: (() => {
        callCount++
        return Promise.resolve(errorResponse(401, 'AUTH_BAD_SIGNATURE'))
      }) as typeof fetch,
    })
    const result = await client.call('/v1/search/understand', { query: 'rice' })
    expect(result).toEqual({ ok: false, reason: 'GATEWAY_ERROR' })
    expect(callCount).toBe(1)
  })
})

describe('clientConfigFromEnv', () => {
  test('builds a config from env and null when unconfigured', () => {
    expect(clientConfigFromEnv({
      INTELLIGENCE_GATEWAY_URL: ' https://gateway.internal ',
      INTELLIGENCE_GATEWAY_CALLER_ID: 'mudaala-commerce',
      INTELLIGENCE_GATEWAY_SECRET_ID: 'key-2026-11',
      INTELLIGENCE_GATEWAY_SECRET: 's',
    })).toEqual({ url: 'https://gateway.internal', callerId: 'mudaala-commerce', secretId: 'key-2026-11', secret: 's' })
    expect(clientConfigFromEnv({})).toBeNull()
  })
})
