import { RateLimitShard } from '../src/lib/rate-limit-do'

interface RateLimitShardStub {
  hit(keyHash: string, max: number, windowMs: number, now?: number): Promise<{ ok: boolean; retryAfterSeconds: number }>
  clear(keyHash: string): Promise<void>
}

interface Env {
  RATE_LIMIT_SHARDS: DurableObjectNamespace<RateLimitShardStub>
}

export { RateLimitShard }

async function digest(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('')
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })
}

// CI/local-only harness. This Worker is configured by a separate wrangler file
// and is never the production Mudaala Worker.
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname === '/health') return new Response('ok')
    if (url.pathname !== '/consume' && url.pathname !== '/clear') return new Response('Not found', { status: 404 })

    const key = url.searchParams.get('key')
    if (!key || key.length > 256) return json({ error: 'key is required and must be at most 256 characters' }, 400)
    const keyHash = await digest(key)
    const shard = Number.parseInt(keyHash.slice(0, 4), 16) % 256
    const id = env.RATE_LIMIT_SHARDS.idFromName('rate-limit-shard:' + shard)
    const stub = env.RATE_LIMIT_SHARDS.get(id)

    if (url.pathname === '/clear') {
      await stub.clear(keyHash)
      return json({ cleared: true })
    }

    const max = Number(url.searchParams.get('max') ?? 5)
    const windowMs = Number(url.searchParams.get('windowMs') ?? 60_000)
    const nowParam = url.searchParams.get('now')
    const now = nowParam === null ? Date.now() : Number(nowParam)
    try {
      return json(await stub.hit(keyHash, max, windowMs, now))
    } catch {
      return json({ error: 'invalid rate-limit arguments' }, 400)
    }
  },
}
