'use client'

import { Providers, CurrentView, HashSync } from '@/components/commerce/providers'
import { AppHeader } from '@/components/commerce/app-header'
import { AppSidebar, isMerchantWorkspaceView } from '@/components/commerce/app-sidebar'
import { BottomNav } from '@/components/commerce/bottom-nav'
import { AuthDialog } from '@/components/commerce/auth-dialog'
import { ShopSetupDialog } from '@/components/commerce/shop-setup-dialog'
import { SiteFooter } from '@/components/commerce/site-footer'
import { RailShell } from '@/components/commerce/cart-dock'
import { useAppStore } from '@/lib/store'
import { useEffect } from 'react'
import { useSession } from '@/hooks/use-session'
import { apiFetch, apiPost } from '@/lib/client'
import { mergeLovedIds, useLovedIds } from '@/lib/loved'

function CommerceFrame() {
  const { view } = useAppStore()
  const { user } = useSession()
  const userId = user?.id
  const lovedIds = useLovedIds()

  // Restore account-saved products on every device. Also upload this device's
  // guest shortlist once the account is known, then merge the server truth.
  useEffect(() => {
    if (!userId) return
    let cancelled = false
    async function syncShortlist() {
      try {
        const guestIds = lovedIds.slice(0, 40)
        await Promise.all(guestIds.map((listingId) =>
          apiPost('/api/saved-products', { listingId }).catch(() => null)
        ))
        const result = await apiFetch<{ products: Array<{ listing: { id: string } }> }>('/api/saved-products')
        if (!cancelled) mergeLovedIds(result.products.map((item) => item.listing.id))
      } catch {
        // Keep the local shortlist available when offline or signed out.
      }
    }
    void syncShortlist()
    return () => { cancelled = true }
  }, [userId, lovedIds])
  const workspace = isMerchantWorkspaceView(view.name)

  return (
    <>
      <AppSidebar />
      <AppHeader />
      <RailShell workspace={workspace}>
        <main
          className={[
            'mx-auto w-full flex-1 px-4 pb-28 pt-5 sm:px-6 sm:pt-7 lg:px-8 lg:pb-10',
            workspace ? 'max-w-6xl' : 'max-w-7xl',
          ].join(' ')}
        >
          <CurrentView />
        </main>
        <SiteFooter padded />
      </RailShell>
      <BottomNav />
      <AuthDialog />
      <ShopSetupDialog />
    </>
  )
}

export default function Home() {
  return (
    <Providers>
      <HashSync />
      <CommerceFrame />
    </Providers>
  )
}
