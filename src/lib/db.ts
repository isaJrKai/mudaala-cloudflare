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
  } catch {}
  return value
}

function getPrisma(): PrismaClient {
  const connectionString = runtimeDatabaseUrl()
  if (!connectionString) throw new Error('DATABASE_URL or Cloudflare HYPERDRIVE is required to initialize Prisma')
  // Keep this adapter isolated to the short-lived route client. In production
  // observability, reusing the module-level pg pool was followed by Worker
  // runtime cancellations on session lookups and public listing reads. The
  // single-use pool avoids reusing a potentially wedged connection while the
  // underlying Hyperdrive service remains responsible for upstream pooling.
  const adapter = new PrismaPg({ connectionString, maxUses: 1 })
  return new PrismaClient({
    adapter,
    log: process.env.PRISMA_LOG_QUERIES === '1' || process.env.PRISMA_LOG_QUERIES === 'true'
      ? ['query'] : ['error'],
  })
}

export const db = new Proxy({} as PrismaClient, {
  get(_target, property) {
    const client = getPrisma()
    const value = client[property as keyof PrismaClient]
    return typeof value === 'function' ? value.bind(client) : value
  },
})
