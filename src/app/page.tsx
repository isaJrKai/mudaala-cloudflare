'use client'

import { Providers, CurrentView, HashSync } from '@/components/commerce/providers'
import { AppHeader } from '@/components/commerce/app-header'
import { AppSidebar, isMerchantWorkspaceView } from '@/components/commerce/app-sidebar'
import { BottomNav } from '@/components/commerce/bottom-nav'
import { AuthDialog } from '@/components/commerce/auth-dialog'
import { ShopSetupDialog } from '@/components/commerce/shop-setup-dialog'
import { SiteFooter } from '@/components/commerce/site-footer'
import { useAppStore } from '@/lib/store'

function CommerceFrame() {
  const { view } = useAppStore()
  const workspace = isMerchantWorkspaceView(view.name)

  return (
    <>
      <AppSidebar />
      <AppHeader />
      <div className={workspace ? 'lg:ml-60' : undefined}>
        <main
          className={[
            'mx-auto w-full flex-1 px-4 pb-28 pt-5 sm:px-6 sm:pt-7 lg:px-8 lg:pb-10',
            workspace ? 'max-w-6xl' : 'max-w-7xl',
          ].join(' ')}
        >
          <CurrentView />
        </main>
        <SiteFooter padded />
      </div>
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
