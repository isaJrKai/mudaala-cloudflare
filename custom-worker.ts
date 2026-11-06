// @ts-ignore .open-next/worker.js is generated during the OpenNext build.
import { default as handler } from './.open-next/worker.js'
export { RateLimitShard } from './src/lib/rate-limit-do'

type MudaalaWorkerEnv = CloudflareEnv & {
  CRON_SECRET?: string
  APP_ORIGIN?: string
  NEXT_PUBLIC_APP_URL?: string
}

interface ScheduledEventLike {
  cron: string
  scheduledTime: number
}

interface ScheduledContextLike {
  waitUntil(promise: Promise<unknown>): void
}

function getCronOrigin(env: MudaalaWorkerEnv): string {
  const origin = env.APP_ORIGIN ?? env.NEXT_PUBLIC_APP_URL
  if (!origin) throw new Error('APP_ORIGIN or NEXT_PUBLIC_APP_URL must be configured for scheduled jobs')
  const parsed = new URL(origin)
  if (parsed.protocol !== 'https:' && parsed.hostname !== 'localhost' && parsed.hostname !== '127.0.0.1') {
    throw new Error('Scheduled job origin must use HTTPS outside local development')
  }
  return parsed.origin
}

async function postCronEndpoint(path: string, event: ScheduledEventLike, env: MudaalaWorkerEnv): Promise<void> {
  if (!env.CRON_SECRET) throw new Error('CRON_SECRET is not bound; refusing to run scheduled jobs')
  const target = new URL(path, getCronOrigin(env))
  const response = await fetch(target, {
    method: 'POST',
    headers: { accept: 'application/json', 'x-cron-secret': env.CRON_SECRET },
  })
  const responseText = await response.text()
  if (!response.ok) {
    throw new Error(path + ' failed with HTTP ' + response.status + ': ' + responseText.slice(0, 250))
  }
  let result: unknown = responseText
  try { result = JSON.parse(responseText) } catch { /* bounded text is enough */ }
  console.log(JSON.stringify({
    event: 'mudaala_scheduled_job_completed',
    cron: event.cron,
    scheduledTime: event.scheduledTime,
    path,
    status: response.status,
    result,
  }))
}

async function runScheduledJobs(event: ScheduledEventLike, env: MudaalaWorkerEnv): Promise<void> {
  // Hourly opportunities are evaluated against each merchant's own timezone.
  await postCronEndpoint('/api/cron/growth-coach', event, env)

  // Preserve the existing daily expiry/price-snapshot maintenance at 03:00 UTC.
  if (new Date(event.scheduledTime).getUTCHours() === 3 && new Date(event.scheduledTime).getUTCMinutes() === 0) {
    await postCronEndpoint('/api/cron/sweep', event, env)
  }
}

export default {
  fetch: handler.fetch,
  scheduled(event: ScheduledEventLike, env: MudaalaWorkerEnv, ctx: ScheduledContextLike) {
    ctx.waitUntil(runScheduledJobs(event, env))
  },
}
