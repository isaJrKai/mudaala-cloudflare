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

// A Worker isolate can handle many requests. Reuse its Prisma client rather
// than constructing a new adapter/client for every property access through db.
// Hyperdrive owns the upstream pool; maxUses: 1 defeats connection reuse.
let cachedPrisma: PrismaClient | undefined
let cachedConnectionString: string | undefined

function getPrisma(): PrismaClient {
  const connectionString = runtimeDatabaseUrl()
  if (!connectionString) {
    throw new Error('DATABASE_URL or Cloudflare HYPERDRIVE is required to initialize Prisma')
  }

  if (cachedPrisma && cachedConnectionString === connectionString) return cachedPrisma

  const adapter = new PrismaPg({ connectionString })
  const client = new PrismaClient({
    adapter,
    log:
      process.env.PRISMA_LOG_QUERIES === '1' || process.env.PRISMA_LOG_QUERIES === 'true'
        ? ['query']
        : ['error'],
  })
  cachedConnectionString = connectionString
  cachedPrisma = client
  return client
}

export const db = new Proxy({} as PrismaClient, {
  get(_target, property) {
    const client = getPrisma()
    const value = client[property as keyof PrismaClient]
    return typeof value === 'function' ? value.bind(client) : value
  },
})
