// @ts-ignore .open-next/worker.js is generated during the OpenNext build.
import { default as handler } from './.open-next/worker.js'

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

async function runScheduledSweep(event: ScheduledEventLike, env: MudaalaWorkerEnv): Promise<void> {
  if (!env.CRON_SECRET) {
    throw new Error('CRON_SECRET is not bound; refusing to run the scheduled sweep')
  }

  const origin = env.APP_ORIGIN ?? env.NEXT_PUBLIC_APP_URL
  if (!origin) {
    throw new Error('APP_ORIGIN or NEXT_PUBLIC_APP_URL must be configured for the scheduled sweep')
  }

  const target = new URL('/api/cron/sweep', origin)
  if (target.protocol !== 'https:' && target.hostname !== 'localhost' && target.hostname !== '127.0.0.1') {
    throw new Error('Scheduled sweep origin must use HTTPS outside local development')
  }

  const response = await fetch(target, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'x-cron-secret': env.CRON_SECRET,
    },
  })
  const responseText = await response.text()
  if (!response.ok) {
    // Include only the bounded response body; never log the secret.
    throw new Error('Scheduled sweep endpoint failed with HTTP ' + response.status + ': ' + responseText.slice(0, 250))
  }

  let result: unknown = responseText
  try {
    result = JSON.parse(responseText)
  } catch {
    // Preserve a bounded text response for diagnostics if the endpoint changes.
  }

  console.log(JSON.stringify({
    event: 'mudaala_scheduled_sweep_completed',
    cron: event.cron,
    scheduledTime: event.scheduledTime,
    status: response.status,
    result,
  }))
}

export default {
  fetch: handler.fetch,
  scheduled(event: ScheduledEventLike, env: MudaalaWorkerEnv, ctx: ScheduledContextLike) {
    ctx.waitUntil(runScheduledSweep(event, env))
  },
}
