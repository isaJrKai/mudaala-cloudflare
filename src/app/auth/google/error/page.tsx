import Link from 'next/link'

export default async function GoogleSignInErrorPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>
}) {
  const { reason } = await searchParams
  const notLinked = reason === 'not-linked'

  return (
    <main className="flex min-h-[70vh] items-center justify-center px-4 py-12">
      <section className="w-full max-w-md rounded-2xl border bg-card p-6 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Mudaala account access</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">
          {notLinked ? 'Google is not linked yet' : 'Google sign-in was not completed'}
        </h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          {notLinked
            ? 'This Google account has not been linked to a Mudaala account. Sign in with your existing phone number and password, then open Settings to link Google. We do not merge accounts just because their email addresses match.'
            : 'No account changes were made. Return to Mudaala and try again, or sign in using your existing account details.'}
        </p>
        <Link
          href="/"
          className="mt-6 inline-flex h-10 items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90"
        >
          Return to Mudaala
        </Link>
      </section>
    </main>
  )
}
