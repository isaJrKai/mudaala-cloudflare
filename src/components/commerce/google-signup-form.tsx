'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { apiPost, storeSessionToken } from '@/lib/client'
import type { SessionUser } from '@/lib/client'
import { registerSchema } from '@/lib/validation'

export function GoogleSignupForm() {
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [acceptTerms, setAcceptTerms] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setErrors({})
    const parsed = registerSchema.safeParse({ name, phone, country: 'UG', password, acceptTerms })
    if (!parsed.success) {
      const next: Record<string, string> = {}
      for (const issue of parsed.error.issues) {
        const key = issue.path[0]?.toString() ?? '_'
        if (!next[key]) next[key] = issue.message
      }
      setErrors(next)
      return
    }
    if (!acceptTerms) {
      setErrors({ acceptTerms: 'Confirm you are 18+ and accept the Terms and Privacy Policy' })
      return
    }

    setBusy(true)
    try {
      const result = await apiPost<{ user: SessionUser; sessionToken?: string }>('/api/auth/google/complete', parsed.data)
      if (result.sessionToken) storeSessionToken(result.sessionToken)
      window.location.replace('/')
    } catch (error) {
      const responseError = error as Error & { fields?: Record<string, string> }
      setErrors(responseError.fields ?? { _: error instanceof Error ? error.message : 'Could not create your account. Please try again.' })
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="mt-6 space-y-4" noValidate>
      <div className="space-y-1.5">
        <Label htmlFor="google-signup-name">Your name or shop name</Label>
        <Input id="google-signup-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Nalongo Hardware" maxLength={80} autoComplete="name" required />
        {errors.name ? <p className="text-sm text-destructive">{errors.name}</p> : null}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="google-signup-country">Country</Label>
        <div id="google-signup-country" className="flex h-9 w-full items-center rounded-md border border-input bg-muted/40 px-3 text-sm text-foreground">Uganda (+256)</div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="google-signup-phone">Phone number</Label>
        <Input id="google-signup-phone" type="tel" inputMode="tel" autoComplete="tel" placeholder="0772 345 678" value={phone} onChange={(event) => setPhone(event.target.value)} required />
        <p className="text-xs text-muted-foreground">Use the number you want connected to your Mudaala account.</p>
        {errors.phone ? <p className="text-sm text-destructive">{errors.phone}</p> : null}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="google-signup-password">Create a Mudaala password</Label>
        <Input id="google-signup-password" type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} required />
        <p className="text-xs text-muted-foreground">At least 8 characters. You can use this password to sign in without Google.</p>
        {errors.password ? <p className="text-sm text-destructive">{errors.password}</p> : null}
      </div>
      <div className="space-y-1.5">
        <div className="flex items-start gap-2.5">
          <Checkbox id="google-signup-terms" checked={acceptTerms} onCheckedChange={(value) => setAcceptTerms(value === true)} className="mt-0.5" />
          <Label htmlFor="google-signup-terms" className="text-sm font-normal leading-snug">
            I am 18+ and accept the{' '}
            <a href="/terms" target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">Terms</a>{' '}and{' '}
            <a href="/privacy" target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">Privacy Policy</a>
          </Label>
        </div>
        {errors.acceptTerms ? <p className="text-sm text-destructive">{errors.acceptTerms}</p> : null}
      </div>
      {errors._ ? <p role="alert" className="text-sm text-destructive">{errors._}</p> : null}
      <Button type="submit" className="w-full" disabled={busy}>{busy ? 'Creating your account…' : 'Create Mudaala account'}</Button>
      <p className="text-center text-xs text-muted-foreground">Already have a Mudaala account? Sign in with your existing phone and password, then connect Google in Settings. Accounts are never merged by email alone.</p>
    </form>
  )
}
