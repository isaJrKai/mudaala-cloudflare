import { getCloudflareContext } from '@opennextjs/cloudflare'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

function runtimeDatabaseUrl() {
  try {
    const { env } = getCloudflareContext()
    const hyperdrive = env.HYPERDRIVE as { connectionString?: string } | undefined
    if (hyperdrive?.connectionString) return hyperdrive.connectionString
  } catch {
    // Fall back to the normal environment for local Node.js/dev execution.
  }

  const value = process.env.DATABASE_URL
  if (!value) return value

  // Keep compatibility with existing Supabase pooler configuration outside
  // Cloudflare Hyperdrive.
  try {
    const url = new URL(value)
    if (url.port === '6543' && url.hostname.endsWith('.pooler.supabase.com')) {
      url.port = '5432'
      url.searchParams.delete('pgbouncer')
      return url.toString()
    }
  } catch {
    // Let Prisma report a malformed DATABASE_URL below.
  }

  return value
}

type PrismaCache = {
  connectionString: string
  client: PrismaClient
}

const globalForPrisma = globalThis as typeof globalThis & {
  __mudaalaPrisma?: PrismaCache
}

function getPrisma(): PrismaClient {
  const connectionString = runtimeDatabaseUrl()
  if (!connectionString) {
    throw new Error('DATABASE_URL or Cloudflare HYPERDRIVE is required to initialize Prisma')
  }

  // Reuse the client for this Worker isolate and connection string. The old
  // proxy created a new PrismaClient for every model access and forced each
  // pooled connection to rotate after one use. That repeated client/adapter
  // setup on hot API paths and is a plausible contributor to the production
  // CPU-limit errors seen on /api/auth/me, /api/home, /api/notifications,
  // and /api/saved-searches. Hyperdrive already owns the server-side pool.
  const cached = globalForPrisma.__mudaalaPrisma
  if (cached?.connectionString === connectionString) return cached.client

  const adapter = new PrismaPg({ connectionString })
  const client = new PrismaClient({
    adapter,
    log:
      process.env.PRISMA_LOG_QUERIES === '1' || process.env.PRISMA_LOG_QUERIES === 'true'
        ? ['query']
        : ['error'],
  })
  globalForPrisma.__mudaalaPrisma = { connectionString, client }
  return client
}

export const db = new Proxy({} as PrismaClient, {
  get(_target, property) {
    const client = getPrisma()
    const value = client[property as keyof PrismaClient]
    return typeof value === 'function' ? value.bind(client) : value
  },
})
