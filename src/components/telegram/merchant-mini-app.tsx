'use client'

import { useEffect, useMemo, useState, type FormEvent } from 'react'
import Image from 'next/image'
import Script from 'next/script'
import { ArrowUpRight, BarChart3, Box, Check, ChevronRight, CircleAlert, Clipboard, Eye, Home, Plus, RefreshCw, Settings, Store, Tag } from 'lucide-react'

declare global {
  interface Window {
    Telegram?: {
      WebApp?: {
        initData?: string
        initDataUnsafe?: { user?: { first_name?: string; last_name?: string } }
        ready?: () => void
        expand?: () => void
        HapticFeedback?: { notificationOccurred?: (kind: 'success' | 'error') => void }
      }
    }
  }
}

type User = { id: string; name: string; phone: string }
type Profile = {
  businessName?: string | null
  area?: string | null
  county?: string | null
  shopCode?: string | null
  phone?: string | null
  whatsapp?: string | null
  description?: string | null
} | null
type Listing = { id: string; title: string; status: string; price: number | null; currency: string; viewCount: number; photos?: string[] }
type Analytics = {
  listingViews?: number
  listingCount?: number
  engagement?: { views?: number; callClicks?: number; whatsappClicks?: number; shareClicks?: number; topListings?: Array<{ listingId: string; title: string; views: number }> }
  shopEngagement?: { views?: number; callClicks?: number; whatsappClicks?: number; shareClicks?: number }
  sales?: Array<{ currency: string; completedSales: number; recordedRevenue: number; estimatedGrossProfit: number | null }>
}

type Tab = 'home' | 'products' | 'insights' | 'shop'

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { credentials: 'same-origin', cache: 'no-store', ...init })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : 'Something went wrong. Please try again.')
  return data as T
}

function go(path: string) {
  window.location.href = path
}

function Metric({ label, value, detail }: { label: string; value: string | number; detail?: string }) {
  return <div className="rounded-2xl border border-[#e1e6dd] bg-white p-4">
    <p className="text-xs font-medium text-[#718276]">{label}</p>
    <p className="mt-2 text-2xl font-semibold tabular-nums text-[#183b2d]">{value}</p>
    {detail ? <p className="mt-1 text-[11px] leading-4 text-[#718276]">{detail}</p> : null}
  </div>
}

export function TelegramMerchantMiniApp() {
  const [sdkReady, setSdkReady] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [onboarding, setOnboarding] = useState(false)
  const [onboardingStep, setOnboardingStep] = useState<'account' | 'shop'>('account')
  const [authMode, setAuthMode] = useState<'register' | 'login'>('register')
  const [shopNameInput, setShopNameInput] = useState('')
  const [shopCountyInput, setShopCountyInput] = useState('')
  const [shopAreaInput, setShopAreaInput] = useState('')
  const [shopDescriptionInput, setShopDescriptionInput] = useState('')
  const [registering, setRegistering] = useState(false)
  const [registerError, setRegisterError] = useState('')
  const [registerName, setRegisterName] = useState('')
  const [registerPhone, setRegisterPhone] = useState('')
  const [registerPassword, setRegisterPassword] = useState('')
  const [acceptTerms, setAcceptTerms] = useState(false)
  const [user, setUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<Profile>(null)
  const [listings, setListings] = useState<Listing[]>([])
  const [analytics, setAnalytics] = useState<Analytics | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [tab, setTab] = useState<Tab>('home')
  const [copied, setCopied] = useState(false)

  async function loadShop(authenticatedUser?: User) {
    setRefreshing(true)
    try {
      const [profileData, listingData, analyticsData] = await Promise.all([
        requestJson<{ profile: Profile }>('/api/profile'),
        requestJson<{ listings: Listing[] }>('/api/my/listings'),
        requestJson<Analytics>('/api/my/business-analytics?period=30d').catch(() => null),
      ])
      setProfile(profileData.profile)
      setListings(listingData.listings)
      setAnalytics(analyticsData)
      if (!profileData.profile) {
        setOnboarding(true)
        setOnboardingStep('shop')
        setShopNameInput((current) => current || ((authenticatedUser ?? user)?.name ? (authenticatedUser ?? user)!.name + "'s Shop" : ''))
        setRegisterPhone((current) => current || (authenticatedUser ?? user)?.phone || '')
      }
      setError('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load your shop.')
    } finally {
      setRefreshing(false)
      setLoading(false)
    }
  }

  async function authenticate(initData: string) {
    try {
      const session = await requestJson<{ user: User }>('/api/telegram/mini-app/session', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ initData }),
      })
      setUser(session.user)
      await loadShop(session.user)
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Telegram sign-in failed.'
      if (message.toLowerCase().includes('not linked')) {
        setOnboarding(true)
        setLoading(false)
        const tgUser = window.Telegram?.WebApp?.initDataUnsafe?.user
        setRegisterName([tgUser?.first_name, tgUser?.last_name].filter(Boolean).join(' '))
      } else {
        setError(message)
        setLoading(false)
      }
    }
  }

  useEffect(() => {
    if (!sdkReady) return
    const webApp = window.Telegram?.WebApp
    webApp?.ready?.()
    webApp?.expand?.()
    const initData = webApp?.initData
    if (!initData) {
      setError('Open Mudaala from the Telegram bot menu. Telegram sign-in data was not provided.')
      setLoading(false)
      return
    }
    void authenticate(initData)
  // One authentication attempt per Mini App launch.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sdkReady])

  async function registerInsideTelegram(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setRegistering(true)
    setRegisterError('')
    try {
      const initData = window.Telegram?.WebApp?.initData
      if (!initData) throw new Error('Telegram sign-in data is missing. Close and reopen the Mini App.')
      await requestJson('/api/auth/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: registerName, phone: registerPhone, country: 'UG', password: registerPassword, acceptTerms }),
      })
      await requestJson('/api/telegram/mini-app/link', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ initData }),
      })
      window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred?.('success')
      setOnboardingStep('shop')
      setShopNameInput(registerName.trim() ? registerName.trim() + "'s Shop" : '')
    } catch (cause) {
      setRegisterError(cause instanceof Error ? cause.message : 'We could not finish setting up your account.')
      window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred?.('error')
    } finally {
      setRegistering(false)
    }
  }

  async function signInInsideTelegram(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setRegistering(true)
    setRegisterError('')
    try {
      const initData = window.Telegram?.WebApp?.initData
      if (!initData) throw new Error('Telegram sign-in data is missing. Close and reopen the Mini App.')
      await requestJson('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ phone: registerPhone, password: registerPassword }),
      })
      await requestJson('/api/telegram/mini-app/link', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ initData }),
      })
      setOnboarding(false)
      setLoading(true)
      await authenticate(initData)
    } catch (cause) {
      setRegisterError(cause instanceof Error ? cause.message : 'We could not sign you in.')
    } finally {
      setRegistering(false)
    }
  }

  async function createShopInsideTelegram(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setRegistering(true)
    setRegisterError('')
    try {
      await requestJson('/api/profile', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          businessName: shopNameInput,
          photoUrl: null,
          category: null,
          description: shopDescriptionInput.trim() || null,
          county: shopCountyInput.trim(),
          area: shopAreaInput.trim() || null,
          phone: registerPhone,
          whatsapp: null,
          hours: null,
        }),
      })
      const initData = window.Telegram?.WebApp?.initData
      if (!initData) throw new Error('Telegram sign-in data is missing. Close and reopen the Mini App.')
      setOnboarding(false)
      setLoading(true)
      await authenticate(initData)
    } catch (cause) {
      setRegisterError(cause instanceof Error ? cause.message : 'We could not create your shop.')
    } finally {
      setRegistering(false)
    }
  }

  const activeCount = listings.filter((item) => item.status === 'ACTIVE').length
  const otherCount = listings.filter((item) => !['ACTIVE', 'ARCHIVED', 'HIDDEN'].includes(item.status)).length
  const shopName = profile?.businessName?.trim() || user?.name || 'Your shop'
  const publicShopUrl = user ? 'https://mudaala.store/#/shop/' + encodeURIComponent(user.id) : ''
  const recentListings = useMemo(() => listings.slice(0, 6), [listings])
  const contactClicks = (analytics?.engagement?.callClicks ?? 0) + (analytics?.engagement?.whatsappClicks ?? 0)

  async function copyShopLink() {
    if (!publicShopUrl) return
    try {
      await navigator.clipboard.writeText(publicShopUrl)
      setCopied(true)
      window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred?.('success')
      window.setTimeout(() => setCopied(false), 1800)
    } catch {
      setError('Could not copy the shop link on this device.')
    }
  }

  return (
    <>
      <Script src="https://telegram.org/js/telegram-web-app.js" strategy="afterInteractive" onReady={() => setSdkReady(true)} />
      <main className="min-h-dvh bg-[#f5f5ef] px-4 pb-28 pt-[max(18px,env(safe-area-inset-top))] text-[#183b2d]">
        <div className="mx-auto max-w-xl space-y-5">
          <header className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <span className="relative flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-full border-2 border-[#10100f] bg-[#10100f]" style={{ backgroundImage: "url(/mudaala-african-textile.svg)", backgroundSize: 'cover', backgroundPosition: 'center' }}>
                <span className="flex size-8 items-center justify-center rounded-full bg-[#f5f0e4]"><Image src="/logo.svg" alt="Mudaala" width={23} height={23} priority /></span>
              </span>
              <div><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#718276]">MUDAALA</p><p className="text-sm font-semibold">Merchant shop</p></div>
            </div>
            {!loading && !onboarding && !error ? <button type="button" onClick={() => void loadShop()} disabled={refreshing} aria-label="Refresh shop" className="flex size-10 items-center justify-center rounded-full border border-[#dce3d9] bg-white text-[#315b46] disabled:opacity-50"><RefreshCw className={`size-4 ${refreshing ? 'animate-spin' : ''}`} /></button> : null}
          </header>

          {loading ? <section className="space-y-3 rounded-[26px] border border-[#e1e6dd] bg-white p-5" aria-busy="true"><div className="h-3 w-24 animate-pulse rounded bg-[#e9eee6]" /><div className="h-7 w-48 animate-pulse rounded bg-[#e9eee6]" /><div className="grid grid-cols-2 gap-3 pt-2"><div className="h-24 animate-pulse rounded-2xl bg-[#f1f4ee]" /><div className="h-24 animate-pulse rounded-2xl bg-[#f1f4ee]" /></div></section> : onboarding ? (
            <section className="rounded-[26px] border border-[#e1e6dd] bg-white p-5">
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#8b7440]">Start selling with Mudaala</p>
              <h1 className="mt-2 text-2xl font-semibold tracking-tight">{authMode === 'register' ? 'Create your merchant account' : 'Sign in to Mudaala'}</h1>
              <p className="mt-2 text-sm leading-6 text-[#65766a]">{authMode === 'register' ? 'Set up your Mudaala account here in Telegram. You will create your shop next, using the same Mudaala account and catalogue.' : 'Sign in with your existing Mudaala phone number and password. We will connect this Telegram account to your shop.'}</p>
              {authMode === 'register' ? <form onSubmit={registerInsideTelegram} className="mt-5 space-y-3">
                <label className="block text-xs font-semibold text-[#315b46]">Your name<input required minLength={2} maxLength={80} autoComplete="name" value={registerName} onChange={(e) => setRegisterName(e.target.value)} className="mt-1.5 h-12 w-full rounded-xl border border-[#dce3d9] bg-[#fbfcf8] px-3 text-sm outline-none focus:border-[#286344]" /></label>
                <label className="block text-xs font-semibold text-[#315b46]">Ugandan phone number<input required type="tel" autoComplete="tel" placeholder="07XX XXX XXX" value={registerPhone} onChange={(e) => setRegisterPhone(e.target.value)} className="mt-1.5 h-12 w-full rounded-xl border border-[#dce3d9] bg-[#fbfcf8] px-3 text-sm outline-none focus:border-[#286344]" /></label>
                <label className="block text-xs font-semibold text-[#315b46]">Create a password<input required type="password" minLength={8} maxLength={100} autoComplete="new-password" value={registerPassword} onChange={(e) => setRegisterPassword(e.target.value)} className="mt-1.5 h-12 w-full rounded-xl border border-[#dce3d9] bg-[#fbfcf8] px-3 text-sm outline-none focus:border-[#286344]" /><span className="mt-1 block font-normal text-[#718276]">At least 8 characters. Keep it private.</span></label>
                <label className="flex items-start gap-2.5 rounded-xl bg-[#f5f7f1] p-3 text-xs leading-5 text-[#53675a]"><input type="checkbox" checked={acceptTerms} onChange={(e) => setAcceptTerms(e.target.checked)} required className="mt-1 size-4 accent-[#286344]" /><span>I confirm that I am 18 or older and accept Mudaala's <a className="font-semibold underline" href="/terms" target="_blank" rel="noreferrer">Terms</a> and <a className="font-semibold underline" href="/privacy" target="_blank" rel="noreferrer">Privacy Policy</a>.</span></label>
                {registerError ? <p role="alert" className="rounded-xl bg-[#fff2e9] p-3 text-sm text-[#9a452e]">{registerError}</p> : null}
                <button disabled={registering || !acceptTerms} className="flex h-12 w-full items-center justify-center rounded-full bg-[#164b37] px-5 text-sm font-semibold text-white disabled:opacity-50">{registering ? 'Creating your account…' : 'Create my Mudaala account'}</button>
              </form> : <form onSubmit={signInInsideTelegram} className="mt-5 space-y-3">
                <label className="block text-xs font-semibold text-[#315b46]">Ugandan phone number<input required type="tel" autoComplete="tel" placeholder="07XX XXX XXX" value={registerPhone} onChange={(e) => setRegisterPhone(e.target.value)} className="mt-1.5 h-12 w-full rounded-xl border border-[#dce3d9] bg-[#fbfcf8] px-3 text-sm outline-none focus:border-[#286344]" /></label>
                <label className="block text-xs font-semibold text-[#315b46]">Password<input required type="password" autoComplete="current-password" value={registerPassword} onChange={(e) => setRegisterPassword(e.target.value)} className="mt-1.5 h-12 w-full rounded-xl border border-[#dce3d9] bg-[#fbfcf8] px-3 text-sm outline-none focus:border-[#286344]" /></label>
                {registerError ? <p role="alert" className="rounded-xl bg-[#fff2e9] p-3 text-sm text-[#9a452e]">{registerError}</p> : null}
                <button disabled={registering} className="flex h-12 w-full items-center justify-center rounded-full bg-[#164b37] px-5 text-sm font-semibold text-white disabled:opacity-50">{registering ? 'Signing in…' : 'Sign in and connect Telegram'}</button>
              </form>}
              <p className="mt-4 text-center text-xs text-[#718276]">{authMode === 'register' ? 'Already have a Mudaala account?' : 'New to Mudaala?'} <button type="button" onClick={() => { setAuthMode(authMode === 'register' ? 'login' : 'register'); setRegisterError('') }} className="font-semibold text-[#286344] underline">{authMode === 'register' ? 'Sign in here' : 'Create an account'}</button></p>
            </section>
          ) : error ? (
            <section className="rounded-[26px] border border-[#e4d9c6] bg-white p-5">
              <span className="flex size-10 items-center justify-center rounded-2xl bg-[#fff2d7] text-[#96651b]"><CircleAlert className="size-5" /></span>
              <h1 className="mt-3 text-lg font-semibold">We couldn't open your shop</h1>
              <p className="mt-2 text-sm leading-6 text-[#65766a]">{error}</p>
              <button type="button" onClick={() => { setError(''); setLoading(true); const data = window.Telegram?.WebApp?.initData; if (data) void authenticate(data) }} className="mt-4 h-11 rounded-full bg-[#164b37] px-5 text-sm font-semibold text-white">Try again</button>
            </section>
          ) : (
            <>
              <section className="overflow-hidden rounded-[26px] bg-[#164b37] p-5 text-white">
                <div className="flex items-start justify-between gap-3">
                  <div><p className="text-xs font-medium text-white/65">Your Mudaala shop</p><h1 className="mt-1 text-[26px] font-semibold tracking-tight">{shopName}</h1><p className="mt-1 text-xs text-white/65">{[profile?.area, profile?.county].filter(Boolean).join(', ') || 'Add your shop location'}</p></div>
                  <span className="rounded-full border border-white/20 px-3 py-1 text-[10px] font-semibold tracking-wide text-[#f5d17b]">MERCHANT</span>
                </div>
                <div className="mt-5 flex items-center justify-between gap-3 border-t border-white/15 pt-4">
                  <div><p className="text-[10px] uppercase tracking-[0.15em] text-white/60">MU-CODE</p><p className="mt-1 text-lg font-semibold tracking-[0.12em]">{profile?.shopCode || 'Set up your shop'}</p></div>
                  <button type="button" onClick={() => go('/#/account')} className="inline-flex h-10 items-center gap-2 rounded-full bg-[#f4c45d] px-4 text-xs font-bold text-[#263e2f]">Shop details <ArrowUpRight className="size-4" /></button>
                </div>
              </section>

              {tab === 'home' ? <>
                <section className="grid grid-cols-2 gap-3">
                  <Metric label="Active products" value={activeCount} detail={`${otherCount} other listings`} />
                  <Metric label="Recorded views" value={(analytics?.listingViews ?? listings.reduce((sum, item) => sum + (item.viewCount || 0), 0)).toLocaleString()} detail="Across your listings" />
                  <Metric label="Customer contact taps" value={contactClicks.toLocaleString()} detail="Last 30 days · call and WhatsApp taps" />
                  <Metric label="Shop visits" value={(analytics?.shopEngagement?.views ?? 0).toLocaleString()} detail="Last 30 days · recorded visits" />
                </section>
                <section className="rounded-2xl border border-[#e1e6dd] bg-white p-4">
                  <div className="flex items-center justify-between gap-3"><div><h2 className="text-sm font-semibold">Run your shop</h2><p className="mt-1 text-xs text-[#718276]">The everyday tools for your business</p></div><Store className="size-5 text-[#718276]" /></div>
                  <div className="mt-4 grid grid-cols-2 gap-2">
                    <button type="button" onClick={() => go('/#/publish')} className="flex min-h-12 items-center justify-center gap-2 rounded-xl bg-[#164b37] px-3 text-xs font-semibold text-white"><Plus className="size-4" /> Add product</button>
                    <button type="button" onClick={() => setTab('products')} className="flex min-h-12 items-center justify-center gap-2 rounded-xl bg-[#edf2eb] px-3 text-xs font-semibold text-[#244b37]">Manage products <ChevronRight className="size-4" /></button>
                    <button type="button" onClick={() => setTab('insights')} className="flex min-h-12 items-center justify-center gap-2 rounded-xl bg-[#edf2eb] px-3 text-xs font-semibold text-[#244b37]">Shop insights <ChevronRight className="size-4" /></button>
                    <button type="button" onClick={() => setTab('shop')} className="flex min-h-12 items-center justify-center gap-2 rounded-xl bg-[#edf2eb] px-3 text-xs font-semibold text-[#244b37]">Shop details <ChevronRight className="size-4" /></button>
                  </div>
                </section>
                <section className="rounded-2xl border border-[#e1e6dd] bg-white p-4">
                  <div className="flex items-center justify-between"><div><h2 className="text-sm font-semibold">Recently updated</h2><p className="mt-1 text-xs text-[#718276]">Your latest products</p></div><button type="button" onClick={() => setTab('products')} className="text-xs font-semibold text-[#286344]">All products</button></div>
                  {recentListings.length ? <div className="mt-3 divide-y divide-[#edf0ea]">{recentListings.slice(0, 4).map((item) => <button type="button" key={item.id} onClick={() => go('/#/edit/' + encodeURIComponent(item.id))} className="flex w-full items-center justify-between gap-3 py-3 text-left"><span className="flex min-w-0 items-center gap-3">{item.photos?.[0] ? <Image src={item.photos[0]} alt="" width={48} height={48} unoptimized className="size-12 shrink-0 rounded-xl object-cover" /> : <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-[#f1f4ee]"><Box className="size-5 text-[#9aaa9c]" /></span>}<span className="min-w-0"><span className="block truncate text-sm font-medium">{item.title}</span><span className="mt-1 block text-[11px] text-[#718276]">{item.status === 'ACTIVE' ? 'Live on Mudaala' : item.status.toLowerCase()}</span></span></span><span className="shrink-0 text-xs font-semibold">{item.price == null ? 'Ask seller' : `${item.currency} ${item.price.toLocaleString('en-UG')}`}<ChevronRight className="ml-1 inline size-3" /></span></button>)}</div> : <div className="py-7 text-center"><Box className="mx-auto size-7 text-[#9aaa9c]" /><p className="mt-2 text-sm font-semibold">Your catalogue starts here</p><p className="mt-1 text-xs text-[#718276]">Add your first product to make your shop discoverable.</p><button type="button" onClick={() => go('/#/publish')} className="mt-3 rounded-full bg-[#164b37] px-5 py-2.5 text-xs font-semibold text-white">Add first product</button></div>}
                </section>
              </> : null}

              {tab === 'products' ? <section className="rounded-2xl border border-[#e1e6dd] bg-white p-4">
                <div className="flex items-center justify-between gap-3"><div><h2 className="text-lg font-semibold">Your catalogue</h2><p className="mt-1 text-xs text-[#718276]">{listings.length} total listings · {activeCount} active</p></div><button type="button" onClick={() => go('/#/publish')} className="flex h-10 items-center gap-1.5 rounded-full bg-[#164b37] px-4 text-xs font-semibold text-white"><Plus className="size-4" /> Add</button></div>
                {listings.length ? <div className="mt-3 divide-y divide-[#edf0ea]">{listings.map((item) => <div key={item.id} className="flex items-center justify-between gap-3 py-3"><div className="flex min-w-0 items-center gap-3">{item.photos?.[0] ? <Image src={item.photos[0]} alt="" width={52} height={52} unoptimized className="size-[52px] shrink-0 rounded-xl object-cover" /> : <span className="flex size-[52px] shrink-0 items-center justify-center rounded-xl bg-[#f1f4ee]"><Box className="size-5 text-[#9aaa9c]" /></span>}<div className="min-w-0"><p className="truncate text-sm font-semibold">{item.title}</p><p className="mt-1 text-[11px] text-[#718276]">{item.status === 'ACTIVE' ? 'Live' : item.status.toLowerCase()} · {item.viewCount.toLocaleString()} views</p><p className="mt-1 text-xs font-semibold">{item.price == null ? 'Ask seller' : `${item.currency} ${item.price.toLocaleString('en-UG')}`}</p></div></div><button type="button" onClick={() => go('/#/edit/' + encodeURIComponent(item.id))} className="shrink-0 rounded-full border border-[#dce3d9] px-3 py-2 text-xs font-semibold">Edit</button></div>)}</div> : <p className="py-10 text-center text-sm text-[#718276]">No products yet. Add your first product.</p>}
              </section> : null}

              {tab === 'insights' ? <section className="space-y-3">
                <div className="rounded-2xl border border-[#e1e6dd] bg-white p-4"><div className="flex items-center gap-2"><BarChart3 className="size-5 text-[#286344]" /><h2 className="text-lg font-semibold">Shop insights</h2></div><p className="mt-1 text-xs text-[#718276]">Recorded activity from your Mudaala shop. These are interactions, not confirmed sales or unique people.</p></div>
                <div className="grid grid-cols-2 gap-3"><Metric label="Listing views" value={(analytics?.listingViews ?? 0).toLocaleString()} detail="All-time recorded views" /><Metric label="Shop visits" value={(analytics?.shopEngagement?.views ?? 0).toLocaleString()} detail="Last 30 days" /><Metric label="Call taps" value={(analytics?.engagement?.callClicks ?? 0).toLocaleString()} detail="Last 30 days" /><Metric label="WhatsApp taps" value={(analytics?.engagement?.whatsappClicks ?? 0).toLocaleString()} detail="Last 30 days" /><Metric label="Share taps" value={(analytics?.engagement?.shareClicks ?? 0).toLocaleString()} detail="Last 30 days" /><Metric label="Active products" value={activeCount} /></div>
                <div className="rounded-2xl border border-[#e1e6dd] bg-white p-4"><h3 className="text-sm font-semibold">Most viewed products · last 30 days</h3>{analytics?.engagement?.topListings?.length ? <div className="mt-3 divide-y divide-[#edf0ea]">{analytics.engagement.topListings.map((item) => <div key={item.listingId} className="flex items-center justify-between gap-3 py-2.5 text-sm"><span className="truncate">{item.title}</span><span className="shrink-0 font-semibold tabular-nums">{item.views.toLocaleString()} views</span></div>)}</div> : <p className="mt-3 text-xs text-[#718276]">No recorded product-view activity for this period yet.</p>}</div>
                {analytics?.sales?.length ? <div className="rounded-2xl border border-[#e1e6dd] bg-white p-4"><h3 className="text-sm font-semibold">Seller-recorded sales</h3><p className="mt-1 text-xs text-[#718276]">Only completed sales recorded by you. Not payment-processor verified.</p>{analytics.sales.map((sale) => <div key={sale.currency} className="mt-3 flex justify-between text-sm"><span>{sale.completedSales} completed sales</span><strong>{sale.currency} {sale.recordedRevenue.toLocaleString('en-UG')}</strong></div>)}</div> : null}
              </section> : null}

              {tab === 'shop' ? <section className="space-y-3">
                <div className="rounded-2xl border border-[#e1e6dd] bg-white p-4"><h2 className="text-lg font-semibold">Your shop identity</h2><p className="mt-1 text-xs text-[#718276]">The information customers see when they discover your shop on Mudaala.</p><dl className="mt-4 space-y-3 text-sm"><div><dt className="text-[11px] text-[#718276]">Shop name</dt><dd className="mt-0.5 font-semibold">{profile?.businessName || 'Not set yet'}</dd></div><div><dt className="text-[11px] text-[#718276]">MU-CODE</dt><dd className="mt-0.5 font-semibold">{profile?.shopCode || 'Not generated yet'}</dd></div><div><dt className="text-[11px] text-[#718276]">Location</dt><dd className="mt-0.5 font-semibold">{[profile?.area, profile?.county].filter(Boolean).join(', ') || 'Not added yet'}</dd></div><div><dt className="text-[11px] text-[#718276]">Business phone</dt><dd className="mt-0.5 font-semibold">{profile?.phone || 'Not added yet'}</dd></div><div><dt className="text-[11px] text-[#718276]">WhatsApp</dt><dd className="mt-0.5 font-semibold">{profile?.whatsapp || 'Not added yet'}</dd></div></dl><button type="button" onClick={() => go('/#/account')} className="mt-5 flex h-11 w-full items-center justify-center gap-2 rounded-full bg-[#164b37] text-sm font-semibold text-white"><Settings className="size-4" /> Edit shop details</button></div>
                <div className="rounded-2xl border border-[#e1e6dd] bg-white p-4"><h3 className="text-sm font-semibold">Share your shop</h3><p className="mt-1 text-xs text-[#718276]">Share your public shop link with customers. Your management tools stay private.</p><button type="button" onClick={() => void copyShopLink()} className="mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-full border border-[#dce3d9] text-sm font-semibold">{copied ? <Check className="size-4" /> : <Clipboard className="size-4" />}{copied ? 'Link copied' : 'Copy shop link'}</button></div>
              </section> : null}
            </>
          )}
        </div>
        {!loading && !onboarding && !error ? <nav aria-label="Merchant navigation" className="fixed inset-x-0 bottom-0 z-20 border-t border-[#dce3d9] bg-[#fbfcf8]/95 px-3 pb-[max(10px,env(safe-area-inset-bottom))] pt-2 backdrop-blur-sm"><div className="mx-auto grid max-w-xl grid-cols-4 gap-1">{([
          { id: 'home', label: 'Home', icon: Home },
          { id: 'products', label: 'Products', icon: Tag },
          { id: 'insights', label: 'Insights', icon: Eye },
          { id: 'shop', label: 'My shop', icon: Store },
        ] as const).map((item) => { const Icon = item.icon; const selected = tab === item.id; return <button key={item.id} type="button" aria-current={selected ? 'page' : undefined} onClick={() => setTab(item.id)} className={`flex min-h-14 flex-col items-center justify-center gap-1 rounded-xl text-[10px] font-semibold ${selected ? 'bg-[#eaf0e8] text-[#164b37]' : 'text-[#718276]'}`}><Icon className="size-[18px]" />{item.label}</button> })}</div></nav> : null}
      </main>
    </>
  )
}
