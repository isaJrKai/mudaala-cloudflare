import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

// Cloudflare currently has DATABASE_URL configured, while older Render
// deployments used DIRECT_URL. Prefer DIRECT_URL when present, but fall back
// to DATABASE_URL so the Worker can initialize Prisma with its configured
// Supabase connection string. Normalize only the known project-ref typo.
function runtimeDatabaseUrl() {
  const value = process.env.DIRECT_URL || process.env.DATABASE_URL
  if (!value) return undefined
  return value.replace(
    'postgres.xuzdkfqahshokenlgcvjh',
    'postgres.xuzdkfqahshokenlgvjh',
  )
}

const verboseQueries =
  process.env.PRISMA_LOG_QUERIES === '1' || process.env.PRISMA_LOG_QUERIES === 'true'

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    datasourceUrl: runtimeDatabaseUrl(),
    log: verboseQueries ? ['query'] : ['error'],
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db
