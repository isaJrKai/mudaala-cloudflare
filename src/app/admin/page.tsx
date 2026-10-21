// /admin - platform overview and moderation desk. Server-checks the
// administrator allowlist before anything renders; API routes repeat the gate.
import Link from 'next/link'
import type { Metadata } from 'next'
import { forbidden } from 'next/navigation'
import { getSessionUser } from '@/lib/auth'
import { isAdminUser } from '@/lib/admin'
import { withRequestDb } from '@/lib/db'
import { AdminAnalytics } from './analytics-dashboard'
import { ReportsDashboard } from './reports-dashboard'
import { FeedbackDashboard } from './feedback-dashboard'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Admin · Mudaala',
  robots: { index: false, follow: false },
}

export default async function AdminPage() {
  // Production Prisma access is deliberately request-scoped. API routes get
  // this through route(); a Server Component must establish the same scope
  // itself before reading the session, or db.ts fails closed with HTTP 500.
  let user
  try {
    user = await withRequestDb(() => getSessionUser())
  } catch (error) {
    // Fail closed: if the session cannot be verified, never render admin data.
    // Keep the browser message useful without exposing DB/driver details.
    console.error(
      '[admin] session verification failed:',
      error instanceof Error ? error.name : 'unknown error',
    )
    return (
      <main className="mx-auto w-full max-w-5xl px-4 py-6">
        <nav aria-label="Admin navigation" className="mb-5">
          <Link href="/#/account" className="text-sm font-medium text-primary underline-offset-4 hover:underline">
            ← Back to my account
          </Link>
        </nav>
        <section role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-5">
          <h1 className="text-lg font-semibold">Admin dashboard temporarily unavailable</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            We couldn’t verify your admin session. No admin data has been loaded. Please try again shortly.
          </p>
          <Link href="/admin" className="mt-4 inline-flex rounded-md border px-3 py-2 text-sm font-medium hover:bg-accent/50">
            Try again
          </Link>
        </section>
      </main>
    )
  }

  if (!user || !isAdminUser(user)) {
    forbidden()
  }

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-6">
      <nav aria-label="Admin navigation" className="mb-5">
        <Link href="/#/account" className="text-sm font-medium text-primary underline-offset-4 hover:underline">
          ← Back to my account
        </Link>
      </nav>
      <h1 className="text-lg font-semibold">Mudaala admin</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        A privacy-respecting view of platform growth, followed by the tools for reviewing reports.
      </p>
      <AdminAnalytics />

      <section aria-labelledby="moderation-heading" className="mt-10 border-t pt-6">
        <h2 id="moderation-heading" className="text-base font-semibold">Moderation</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Reports from buyers across Mudaala. Hide what breaks the rules, restore what was flagged by mistake, dismiss the rest.
        </p>
        <ReportsDashboard />
      </section>

      <section aria-labelledby="feedback-heading" className="mt-10 border-t pt-6">
        <h2 id="feedback-heading" className="text-base font-semibold">Bug reports & feedback</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Private messages from users about bugs, slow pages, complaints and ideas. Update status and priority, and keep internal investigation notes here.
        </p>
        <FeedbackDashboard />
      </section>
    </main>
  )
}
