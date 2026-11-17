import { AsyncLocalStorage } from 'node:async_hooks'
import { getCloudflareContext } from '@opennextjs/cloudflare'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { prismaQueryLoggingEnabled } from '@/lib/env-flags'

type RequestDatabaseScope = { client?: PrismaClient }
const requestDatabaseScope = new AsyncLocalStorage<RequestDatabaseScope>()
let cachedLocalPrisma: PrismaClient | undefined
let cachedWorkerPrisma: PrismaClient | undefined

function runtimeDatabaseUrl(): string {
  try {
    const { env } = getCloudflareContext()
    const hyperdrive = env.HYPERDRIVE as { connectionString?: string } | undefined
    if (hyperdrive?.connectionString) return hyperdrive.connectionString
  } catch {
    // Local Node.js and build-time checks run outside the Worker request context.
  }

  // Production must never silently fall back to a build-time DATABASE_URL.
  // The Worker runtime is expected to provide Hyperdrive; local Node/CI tests
  // are the only supported fallback environments.
  if (process.env.NODE_ENV === 'production' && process.env.CI !== 'true') {
    throw new Error('Cloudflare HYPERDRIVE binding is unavailable in production')
  }
  const value = process.env.DATABASE_URL
  if (!value) throw new Error('Cloudflare HYPERDRIVE or DATABASE_URL is required to initialize Prisma')
  return value
}

function createPrisma(): PrismaClient {
  const connectionString = runtimeDatabaseUrl()
  // Hyperdrive owns the shared, cross-isolate database pool. This client-side
  // pool exists only for one request, so keep it small and fail fast if a
  // connection cannot be acquired rather than letting the Worker hang.
  const adapter = new PrismaPg({
    connectionString,
    max: 5,
    connectionTimeoutMillis: 5_000,
  })
  return new PrismaClient({
    adapter,
    log: prismaQueryLoggingEnabled() ? ['query'] : ['error'],
  })
}

/**
 * Run one request with one Prisma client. Cloudflare Workers do not preserve
 * driver pools safely across invocations; Hyperdrive keeps the upstream pool
 * warm, so create the client in the request context and close it before the
 * invocation ends. AsyncLocalStorage lets every db.* call in that request
 * reuse the same client without sharing it with concurrent requests.
 */
export async function withRequestDb<T>(handler: () => Promise<T>): Promise<T> {
  return requestDatabaseScope.run({}, async () => {
    try {
      return await handler()
    } finally {
      // In Workers, reuse the isolate-local Prisma client and its Hyperdrive-backed
      // pool across requests. Disconnecting after every request tears down the
      // pool and forces expensive Prisma/driver initialization on the next one.
      const client = process.env.NODE_ENV === 'production'
        ? undefined
        : requestDatabaseScope.getStore()?.client
      if (client) {
        try {
          await client.$disconnect()
        } catch (error) {
          console.error('[db] request-scoped Prisma disconnect failed:', error instanceof Error ? error.message : 'unknown error')
        }
      }
    }
  })
}

function getPrisma(): PrismaClient {
  // Cloudflare isolates may safely reuse a module-scoped client when the
  // upstream connection is managed by Hyperdrive. The pool is isolate-local;
  // Hyperdrive owns the shared database-side pooling across isolates.
  if (process.env.NODE_ENV === 'production') {
    if (!cachedWorkerPrisma) cachedWorkerPrisma = createPrisma()
    return cachedWorkerPrisma
  }

  const scope = requestDatabaseScope.getStore()
  if (scope) {
    if (!scope.client) scope.client = createPrisma()
    return scope.client
  }

  // Direct database access outside an HTTP request is used by local tooling
  // and seed/test scripts only. Never keep a production Worker pool globally.
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Database access must run inside withRequestDb() in production')
  }
  if (!cachedLocalPrisma) cachedLocalPrisma = createPrisma()
  return cachedLocalPrisma
}

export const db = new Proxy({} as PrismaClient, {
  get(_target, property) {
    const client = getPrisma()
    const value = client[property as keyof PrismaClient]
    return typeof value === 'function' ? value.bind(client) : value
  },
})
