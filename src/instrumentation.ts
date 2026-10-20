// Next.js instrumentation hook - runs once per server process at startup.

export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return

  const { validateEnv } = await import('./lib/env')
  const report = validateEnv()

  for (const warning of report.warnings) {
    console.warn(`[env] warning: ${warning}`)
  }

  if (!report.ok) {
    for (const error of report.errors) {
      console.error(`[env] ${error}`)
    }
    if (process.env.NODE_ENV === 'production') {
      throw new Error(`Refusing to start. Fix the environment first:\n- ${report.errors.join('\n- ')}`)
    }
  }

  // Do not probe the database from this startup hook. Cloudflare production
  // database access must run inside withRequestDb() during a request, where
  // the HYPERDRIVE binding is available. The request-scoped /api/health route
  // performs the authoritative live database check instead.
}
