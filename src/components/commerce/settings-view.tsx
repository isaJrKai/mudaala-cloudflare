'use client'

import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Bell, ExternalLink, FileText, Globe2, Link2, LockKeyhole, Search, ShieldCheck, Store } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { useToast } from '@/hooks/use-toast'
import { apiFetch, apiPost, clearSessionToken } from '@/lib/client'
import { useAppStore } from '@/lib/store'
import { useSession } from '@/hooks/use-session'
import { EmptyState } from './empty-state'
import { PushNotificationControl } from './push-notification-control'
import { ListingListSkeleton } from './skeletons'

export function SettingsView() {
  const { navigate, setAuthOpen } = useAppStore()
  const { user, isLoading } = useSession()
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const [step, setStep] = useState<'request' | 'code'>('request')
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [googleBusy, setGoogleBusy] = useState(false)
  const [error, setError] = useState('')

  if (isLoading) return <ListingListSkeleton count={3} />
  if (!user) return <EmptyState title="Sign in to manage settings" description="Your account settings are available after you sign in." action={<Button onClick={() => setAuthOpen(true)}>Sign in</Button>} />
  // Capture the authenticated user after the guard so async callbacks retain the non-null type.
  const signedInUser = user

  async function linkGoogle() {
    setGoogleBusy(true)
    try {
      const result = await apiPost<{ authorizationUrl: string }>('/api/auth/google/start')
      window.location.assign(result.authorizationUrl)
    } catch (err) {
      toast({
        title: 'Could not connect Google',
        description: err instanceof Error ? err.message : 'Please sign in again and retry.',
        variant: 'destructive',
      })
    } finally {
      setGoogleBusy(false)
    }
  }

  async function unlinkGoogle() {
    setGoogleBusy(true)
    try {
      const result = await apiFetch<{ ok: boolean; message: string }>('/api/auth/google/unlink', { method: 'DELETE' })
      toast({ title: 'Google account unlinked', description: result.message })
      await queryClient.invalidateQueries()
    } catch (err) {
      toast({
        title: 'Could not unlink Google',
        description: err instanceof Error ? err.message : 'Sign in again with your Mudaala password and retry.',
        variant: 'destructive',
      })
    } finally {
      setGoogleBusy(false)
    }
  }

  async function requestCode() {
    setBusy(true); setError('')
    try {
      const result = await apiPost<{ ok: boolean; message: string }>('/api/auth/forgot-password', { phone: signedInUser.phone })
      setStep('code')
      toast({ title: 'Check your phone', description: result.message })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not request a reset code. Try again.')
    } finally { setBusy(false) }
  }

  async function updatePassword(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError('')
    if (password !== confirmPassword) { setError('The passwords do not match.'); return }
    setBusy(true)
    try {
      const result = await apiPost<{ ok: boolean; message: string }>('/api/auth/reset-password', { phone: signedInUser.phone, code: code.trim(), newPassword: password })
      toast({ title: 'Password updated', description: result.message })
      // Password reset revokes all sessions. Clear this browser's token too.
      clearSessionToken()
      queryClient.clear()
      setStep('request'); setCode(''); setPassword(''); setConfirmPassword('')
      setAuthOpen(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update password. Check the code and try again.')
    } finally { setBusy(false) }
  }

  return (
    <div className="space-y-5">
      <Button variant="ghost" size="sm" className="-ml-2 gap-1" onClick={() => navigate({ name: 'account' })}><ArrowLeft className="size-4" aria-hidden /> Back to account</Button>
      <div><h1 className="text-xl font-semibold tracking-tight">Settings</h1><p className="mt-0.5 text-sm text-muted-foreground">Manage your sign-in, preferences and privacy.</p></div>
      <Separator />

      <Section icon={<LockKeyhole className="size-4" aria-hidden />} title="Account & security" description="Change your password using a code sent to your registered phone.">
        <div className="rounded-lg border bg-card p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div><p className="text-sm font-medium">Password</p><p className="mt-0.5 text-sm text-muted-foreground">Registered phone: {user.phone}</p></div>
            {step === 'request' ? <Button onClick={requestCode} disabled={busy}>{busy ? 'Sending code…' : 'Change password'}</Button> : null}
          </div>
          {step === 'code' ? <form onSubmit={updatePassword} className="mt-4 space-y-3 border-t pt-4">
            <p className="text-sm text-muted-foreground">Enter the SMS code and choose a new password. The code expires after 10 minutes.</p>
            <div className="space-y-1.5"><Label htmlFor="settings-code">SMS code</Label><Input id="settings-code" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={e => setCode(e.target.value)} maxLength={6} required /></div>
            <div className="space-y-1.5"><Label htmlFor="settings-password">New password</Label><Input id="settings-password" type="password" autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} minLength={8} required /><p className="text-xs text-muted-foreground">Use at least 8 characters. Avoid using your phone number.</p></div>
            <div className="space-y-1.5"><Label htmlFor="settings-confirm">Confirm new password</Label><Input id="settings-confirm" type="password" autoComplete="new-password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} minLength={8} required /></div>
            {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
            <div className="flex flex-wrap gap-2"><Button type="submit" disabled={busy}>{busy ? 'Updating…' : 'Update password'}</Button><Button type="button" variant="outline" disabled={busy} onClick={() => { setStep('request'); setCode(''); setError('') }}>Cancel</Button><Button type="button" variant="ghost" disabled={busy} onClick={requestCode}>Send a new code</Button></div>
          </form> : null}
          {error && step === 'request' ? <p role="alert" className="mt-3 text-sm text-destructive">{error}</p> : null}
        </div>
      </Section>

      <Section icon={<Link2 className="size-4" aria-hidden />} title="Google seller identity" description="Google sign-in is required for seller privileges. Buyers can continue browsing and contacting shops without Google. Google sign-in does not certify a shop or verify its products.">
        <div className="rounded-lg border bg-card p-4">
          {signedInUser.googleLinked ? (
            <div className="space-y-3">
              <p className="text-sm font-medium text-emerald-700">Google identity linked</p>
              <p className="text-sm text-muted-foreground">Your Google identity is connected to this Mudaala account. To remove it, sign in again with your Mudaala password. Removing it will also remove seller access while Google identity is required.</p>
              <Button type="button" variant="outline" onClick={() => void unlinkGoogle()} disabled={googleBusy}>{googleBusy ? 'Unlinking…' : 'Unlink Google account'}</Button>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">Connect a Google account to unlock seller features. For account safety, Mudaala requires a recent password sign-in before linking. No paid SMS service is needed.</p>
              <Button type="button" onClick={() => void linkGoogle()} disabled={googleBusy}>{googleBusy ? 'Connecting…' : 'Connect Google for selling'}</Button>
            </div>
          )}
        </div>
      </Section>

      <Section icon={<Store className="size-4" aria-hidden />} title="Shop profile" description="Your shop name, photos, location and public contacts are part of your account profile.">
        <Button variant="outline" onClick={() => navigate({ name: 'account' })}>Manage shop profile</Button>
      </Section>

      <Section title="Telegram account" description="Link your Mudaala account to the official bot. Shop owners can separately choose whether to accept Telegram enquiries.">
        <TelegramEnquirySettings />
      </Section>

      <Section icon={<Bell className="size-4" aria-hidden />} title="Notifications" description="Choose how Mudaala reaches you and review your shop updates.">
        <div className="divide-y rounded-lg border bg-card">
          <SettingsLink icon={<Search className="size-4" aria-hidden />} title="Saved-search alerts" description="Manage searches that generate new-match alerts." onClick={() => navigate({ name: 'saved' })} />
          <SettingsLink icon={<Bell className="size-4" aria-hidden />} title="Your alerts" description="Review shop updates, customer activity and reminders." onClick={() => navigate({ name: 'notifications' })} />
        </div>
        <div className="rounded-lg border bg-card p-4">
          <div className="mb-3">
            <p className="text-sm font-medium">Device notifications</p>
            <p className="mt-0.5 text-sm text-muted-foreground">Receive important Mudaala updates on this phone or computer.</p>
          </div>
          <PushNotificationControl />
        </div>
      </Section>

      <Section icon={<Globe2 className="size-4" aria-hidden />} title="Language" description="Mudaala's interface is currently available in English.">
        <div className="max-w-sm space-y-1.5"><Label htmlFor="settings-language">App language</Label><Input id="settings-language" value="English" readOnly aria-readonly="true" /><p className="text-xs text-muted-foreground">More languages can be added when translations are ready.</p></div>
      </Section>

      <Section icon={<ShieldCheck className="size-4" aria-hidden />} title="Privacy & your data" description="Read the privacy policy or manage the data connected to your account.">
        <div className="divide-y rounded-lg border bg-card">
          <SettingsLink icon={<FileText className="size-4" aria-hidden />} title="Privacy policy" description="How Mudaala handles account and shop information." onClick={() => window.open('/privacy', '_blank', 'noopener,noreferrer')} external />
          <SettingsLink icon={<ShieldCheck className="size-4" aria-hidden />} title="Export data or delete account" description="These account-wide actions are managed from your Account page." onClick={() => navigate({ name: 'account' })} />
        </div>
      </Section>
    </div>
  )
}


function TelegramEnquirySettings() {
  const [status, setStatus] = useState<{ connected: boolean; enabled: boolean; hasShopProfile: boolean; botUrl: string } | null>(null)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function refresh() {
    try {
      const result = await apiFetch<{ connected: boolean; enabled: boolean; hasShopProfile: boolean; botUrl: string }>('/api/telegram/merchant')
      setStatus(result)
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load Telegram settings.')
    }
  }

  async function connect() {
    setBusy(true); setError('')
    try {
      const result = await apiPost<{ code: string }>('/api/telegram/link-code', {})
      setCode(result.code)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create a Telegram link code.')
    } finally { setBusy(false) }
  }

  async function toggle(enabled: boolean) {
    setBusy(true); setError('')
    try {
      const result = await apiFetch<{ connected: boolean; enabled: boolean; hasShopProfile: boolean; botUrl: string }>('/api/telegram/merchant', {
        method: 'PUT', body: JSON.stringify({ enabled }),
      })
      setStatus(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update Telegram enquiries.')
    } finally { setBusy(false) }
  }

  // Load the current connection state when the settings section opens.
  useEffect(() => {
    void apiFetch<{ connected: boolean; enabled: boolean; hasShopProfile: boolean; botUrl: string }>('/api/telegram/merchant')
      .then(setStatus)
      .catch(err => setError(err instanceof Error ? err.message : 'Could not load Telegram settings.'))
  }, [])

  return (
    <div className="space-y-3 rounded-lg border bg-card p-4">
      {status?.connected ? (
        <>
          <div className="flex items-center justify-between gap-3">
            <div><p className="text-sm font-medium">Telegram account connected</p><p className="text-xs text-muted-foreground">The bot has been opened from your linked Telegram account.</p></div>
            <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-800">Connected</span>
          </div>
          {status.hasShopProfile ? (
            <label className="flex items-center justify-between gap-4 border-t pt-3">
              <span><span className="block text-sm font-medium">Accept Telegram enquiries</span><span className="block text-xs text-muted-foreground">Show Telegram contact on your active product listings.</span></span>
              <input type="checkbox" checked={status.enabled} disabled={busy} onChange={event => void toggle(event.target.checked)} className="size-5 accent-primary" />
            </label>
          ) : (
            <p className="border-t pt-3 text-sm text-muted-foreground">Your account is linked. As a shopper, use /search and /messages in Telegram. If you decide to sell, create a shop profile before enabling seller enquiries.</p>
          )}
          <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void refresh()}>Refresh connection</Button>
        </>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">Connect the Telegram account you use with the Mudaala bot. Then open the bot and press Start to confirm it can deliver enquiries to you.</p>
          {code ? <div className="rounded-md bg-muted p-3"><p className="text-xs text-muted-foreground">Your one-time link code · expires in 10 minutes</p><p className="my-1 font-mono text-xl font-bold tracking-widest">{code}</p><p className="text-sm">In Telegram, send <strong>/link {code}</strong> to <strong>@MudaalaMerchantbot</strong>, then press Start if prompted.</p></div> : null}
          <div className="flex flex-wrap gap-2">
            <Button type="button" disabled={busy} onClick={() => void connect()}>{busy ? 'Preparing…' : code ? 'Generate a new code' : 'Connect Telegram'}</Button>
            <Button type="button" variant="outline" onClick={() => window.open('https://t.me/MudaalaMerchantbot', '_blank', 'noopener,noreferrer')}>Open Telegram bot</Button>
            <Button type="button" variant="ghost" onClick={() => void refresh()}>I pressed Start · Refresh</Button>
          </div>
        </>
      )}
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    </div>
  )
}

function Section({ icon, title, description, children }: { icon?: React.ReactNode; title: string; description: string; children: React.ReactNode }) {
  return <section className="space-y-3" aria-label={title}><div className="flex items-start gap-3">{icon ? <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-accent text-accent-foreground">{icon}</span> : null}<div><h2 className="text-base font-semibold">{title}</h2><p className="mt-0.5 text-sm text-muted-foreground">{description}</p></div></div><div className={icon ? 'sm:pl-12' : ''}>{children}</div></section>
}

function SettingsLink({ icon, title, description, onClick, external = false }: { icon: React.ReactNode; title: string; description: string; onClick: () => void; external?: boolean }) {
  return <button type="button" onClick={onClick} className="flex w-full items-center gap-3 p-3.5 text-left transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><span className="text-muted-foreground">{icon}</span><span className="min-w-0 flex-1"><span className="block text-sm font-medium">{title}</span><span className="mt-0.5 block text-sm text-muted-foreground">{description}</span></span>{external ? <ExternalLink className="size-4 shrink-0 text-muted-foreground" aria-hidden /> : null}</button>
}
