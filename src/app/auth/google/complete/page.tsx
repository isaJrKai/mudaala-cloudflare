import { GoogleSignupForm } from '@/components/commerce/google-signup-form'

export default function GoogleSignupPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <section className="w-full max-w-md rounded-2xl border bg-card p-6 shadow-sm sm:p-8">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Google account connected</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">Finish creating your Mudaala account</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          Your Google email is confirmed. Add your name, phone number and a password to finish setting up your account. Your phone and password remain your Mudaala account details.
        </p>
        <GoogleSignupForm />
      </section>
    </main>
  )
}
