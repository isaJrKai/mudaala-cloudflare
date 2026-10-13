// /admin - platform overview and moderation desk. Server-checks the
// ADMIN_PHONES allowlist before anything renders; API routes repeat the gate.
import type { Metadata } from 'next'
import { forbidden } from 'next/navigation'
import { getSessionUser } from '@/lib/auth'
import { isAdminUser } from '@/lib/admin'
import { AdminAnalytics } from './analytics-dashboard'
import { ReportsDashboard } from './reports-dashboard'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Admin · Mudaala',
  robots: { index: false, follow: false },
}

export default async function AdminPage() {
  const user = await getSessionUser()
  if (!user || !isAdminUser(user)) {
    forbidden()
  }

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-6">
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
    </main>
  )
}
