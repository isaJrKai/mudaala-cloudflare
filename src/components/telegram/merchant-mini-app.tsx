'use client'

import { useEffect, useState } from 'react'
import { ArrowUpRight, Bell, Box, ChartNoAxesCombined, ChevronRight, CircleAlert, ExternalLink, Plus, RefreshCw, Store } from 'lucide-react'

declare global {
  interface Window {
    Telegram?: {
      WebApp?: {
        initData?: string
        ready?: () => void
        expand?: () => void
      }
    }
  }
}

type User = { id: string; name: string; phone: string }
type Profile = { businessName?: string | null; area?: string | null; county?: string | null; shopCode?: string | null } | null
type Listing = { id: string; title: string; status: string; price: number | null; currency: string; viewCount: number; photoUrl?: string | null }
type Analytics = { listingViews?: number; engagement?: { callClicks?: number; whatsappClicks?: number; shareClicks?: number } }

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { credentials: 'same-origin', cache: 'no-store' })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : 'Could not load your shop.')
  return data as T
}

function go(path: string) {
  window.location.href = path
}

export function TelegramMerchantMiniApp() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [user, setUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<Profile>(null)
  const [listings, setListings] = useState<Listing[]>([])
  const [analytics, setAnalytics] = useState<Analytics | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  async function loadShop() {
    setRefreshing(true)
    try {
      const [profileData, listingData, analyticsData] = await Promise.all([
        getJson<{ profile: Profile }>('/api/profile'),
        getJson<{ listings: Listing[] }>('/api/my/listings'),
        getJson<Analytics>('/api/my/business-analytics?period=30d').catch(() => null),
      ])
      setProfile(profileData.profile)
      setListings(listingData.listings)
      setAnalytics(analyticsData)
      setError('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load your shop.')
    } finally {
      setRefreshing(false)
      setLoading(false)
    }
  }

  useEffect(() => {
    let active = true
    const webApp = window.Telegram?.WebApp
    webApp?.ready?.()
    webApp?.expand?.()

    async function authenticate() {
      const initData = webApp?.initData
      if (!initData) {
        if (active) {
          setError('Open this Mini App from the Mudaala Merchant bot in Telegram. Telegram sign-in data was not provided.')
          setLoading(false)
        }
        return
      }
      try {
        const response = await fetch('/api/telegram/mini-app/session', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          credentials: 'same-origin',
          cache: 'no-store',
          body: JSON.stringify({ initData }),
        })
        const data = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : 'Telegram sign-in failed.')
        if (!active) return
        setUser(data.user as User)
        await loadShop()
      } catch (cause) {
        if (active) {
          setError(cause instanceof Error ? cause.message : 'Telegram sign-in failed.')
          setLoading(false)
        }
      }
    }
    void authenticate()
    return () => { active = false }
  // Authenticate once per Mini App launch; loadShop is intentionally stable for this mount.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const activeCount = listings.filter((item) => item.status === 'ACTIVE').length
  const pendingCount = listings.filter((item) => item.status !== 'ACTIVE' && item.status !== 'ARCHIVED' && item.status !== 'HIDDEN').length
  const shopName = profile?.businessName?.trim() || user?.name || 'Your shop'

  return (
    <main className="min-h-dvh bg-[#f5f5ef] px-4 pb-8 pt-[max(18px,env(safe-area-inset-top))] text-[#183b2d]">
      <div className="mx-auto max-w-xl space-y-5">
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className="flex size-10 items-center justify-center rounded-2xl bg-[#164b37] text-[#f5c65e]"><Store className="size-5" /></span>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#718276]">MUDAALA MERCHANT</p>
              <p className="text-sm font-semibold">Your shop workspace</p>
            </div>
          </div>
          <button type="button" onClick={() => void loadShop()} disabled={loading || refreshing} aria-label="Refresh shop" className="flex size-10 items-center justify-center rounded-full border border-[#dce3d9] bg-white text-[#315b46] disabled:opacity-50">
            <RefreshCw className={`size-4 ${refreshing ? 'animate-spin' : ''}`} />
          </button>
        </header>

        {loading ? (
          <section className="space-y-3 rounded-[26px] border border-[#e1e6dd] bg-white p-5" aria-busy="true">
            <div className="h-3 w-24 animate-pulse rounded bg-[#e9eee6]" />
            <div className="h-7 w-48 animate-pulse rounded bg-[#e9eee6]" />
            <div className="grid grid-cols-2 gap-3 pt-2"><div className="h-24 animate-pulse rounded-2xl bg-[#f1f4ee]" /><div className="h-24 animate-pulse rounded-2xl bg-[#f1f4ee]" /></div>
          </section>
        ) : error ? (
          <section className="rounded-[26px] border border-[#e4d9c6] bg-white p-5">
            <span className="flex size-10 items-center justify-center rounded-2xl bg-[#fff2d7] text-[#96651b]"><CircleAlert className="size-5" /></span>
            <h1 className="mt-3 text-lg font-semibold">We couldn't open your shop</h1>
            <p className="mt-2 text-sm leading-6 text-[#65766a]">{error}</p>
            <a href="https://t.me/MudaalaMerchantbot" className="mt-4 inline-flex h-11 items-center gap-2 rounded-full bg-[#164b37] px-5 text-sm font-semibold text-white">Open Mudaala bot <ExternalLink className="size-4" /></a>
          </section>
        ) : (
          <>
            <section className="overflow-hidden rounded-[26px] bg-[#164b37] p-5 text-white">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-medium text-white/65">Good to see you, {user?.name?.split(' ')[0] || 'merchant'}</p>
                  <h1 className="mt-1 text-[26px] font-semibold tracking-tight">{shopName}</h1>
                  <p className="mt-1 text-xs text-white/65">{[profile?.area, profile?.county].filter(Boolean).join(', ') || 'Your Mudaala shop'}</p>
                </div>
                <span className="rounded-full border border-white/20 px-3 py-1 text-[10px] font-semibold tracking-wide text-[#f5d17b]">MERCHANT</span>
              </div>
              <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
                <div><p className="text-[10px] uppercase tracking-[0.15em] text-white/60">Shop code</p><p className="mt-1 text-lg font-semibold tracking-[0.12em]">{profile?.shopCode || 'Not set up'}</p></div>
                <button type="button" onClick={() => go(`/#/shop/${encodeURIComponent(user?.id || '')}`)} className="inline-flex h-10 items-center gap-2 rounded-full bg-[#f4c45d] px-4 text-xs font-bold text-[#263e2f]">View public shop <ArrowUpRight className="size-4" /></button>
              </div>
            </section>

            <section className="grid grid-cols-2 gap-3" aria-label="Shop overview">
              <div className="rounded-2xl border border-[#e1e6dd] bg-white p-4">
                <div className="flex items-center justify-between text-[#718276]"><span className="text-xs font-medium">Active products</span><Box className="size-4" /></div>
                <p className="mt-3 text-3xl font-semibold tabular-nums">{activeCount}</p>
                <p className="mt-1 text-[11px] text-[#718276]">{pendingCount} other listings</p>
              </div>
              <div className="rounded-2xl border border-[#e1e6dd] bg-white p-4">
                <div className="flex items-center justify-between text-[#718276]"><span className="text-xs font-medium">Listing views</span><ChartNoAxesCombined className="size-4" /></div>
                <p className="mt-3 text-3xl font-semibold tabular-nums">{(analytics?.listingViews ?? listings.reduce((sum, item) => sum + (item.viewCount || 0), 0)).toLocaleString()}</p>
                <p className="mt-1 text-[11px] text-[#718276]">Recorded views</p>
              </div>
            </section>

            <section className="rounded-2xl border border-[#e1e6dd] bg-white p-4">
              <div className="flex items-center justify-between gap-3">
                <div><h2 className="text-sm font-semibold">Quick actions</h2><p className="mt-1 text-xs text-[#718276]">Manage your shop without leaving Telegram</p></div>
                <Bell className="size-4 text-[#718276]" />
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2">
                <button type="button" onClick={() => go('/#/publish')} className="flex min-h-12 items-center justify-center gap-2 rounded-xl bg-[#164b37] px-3 text-xs font-semibold text-white"><Plus className="size-4" /> Add product</button>
                <button type="button" onClick={() => go('/#/my-listings')} className="flex min-h-12 items-center justify-center gap-2 rounded-xl bg-[#edf2eb] px-3 text-xs font-semibold text-[#244b37]">My catalogue <ChevronRight className="size-4" /></button>
                <button type="button" onClick={() => go('/#/business')} className="flex min-h-12 items-center justify-center gap-2 rounded-xl bg-[#edf2eb] px-3 text-xs font-semibold text-[#244b37]">Business insights <ChevronRight className="size-4" /></button>
                <button type="button" onClick={() => go('/#/account')} className="flex min-h-12 items-center justify-center gap-2 rounded-xl bg-[#edf2eb] px-3 text-xs font-semibold text-[#244b37]">Shop settings <ChevronRight className="size-4" /></button>
              </div>
            </section>

            <section className="rounded-2xl border border-[#e1e6dd] bg-white p-4">
              <div className="flex items-center justify-between">
                <div><h2 className="text-sm font-semibold">Recent products</h2><p className="mt-1 text-xs text-[#718276]">Your latest catalogue updates</p></div>
                <button type="button" onClick={() => go('/#/my-listings')} className="text-xs font-semibold text-[#286344]">See all</button>
              </div>
              {listings.length ? (
                <div className="mt-3 divide-y divide-[#edf0ea]">
                  {listings.slice(0, 5).map((item) => (
                    <button type="button" key={item.id} onClick={() => go('/#/edit/' + encodeURIComponent(item.id))} className="flex w-full items-center justify-between gap-3 py-3 text-left">
                      <span className="min-w-0"><span className="block truncate text-sm font-medium">{item.title}</span><span className="mt-1 block text-[11px] text-[#718276]">{item.status === 'ACTIVE' ? 'Live' : item.status.toLowerCase()}</span></span>
                      <span className="shrink-0 text-sm font-semibold">{item.price == null ? 'Ask seller' : `${item.currency} ${Number(item.price).toLocaleString('en-UG')}`}</span>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="py-7 text-center"><Box className="mx-auto size-7 text-[#9aa99d]" /><p className="mt-2 text-sm font-medium">Your catalogue is waiting</p><p className="mt-1 text-xs text-[#718276]">Add your first product to help customers find you.</p><button type="button" onClick={() => go('/#/publish')} className="mt-3 rounded-full bg-[#164b37] px-4 py-2 text-xs font-semibold text-white">Add a product</button></div>
              )}
            </section>
          </>
        )}
        <footer className="pb-2 text-center text-[10px] text-[#8a988c]">Mudaala · Buy and sell near you</footer>
      </div>
    </main>
  )
}
