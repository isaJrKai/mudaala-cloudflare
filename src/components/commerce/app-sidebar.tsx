'use client'

import { ArrowLeft, ExternalLink, LayoutDashboard, Package, Plus, Settings, Store } from 'lucide-react'
import { useAppStore, type ViewName } from '@/lib/store'
import { useSession } from '@/hooks/use-session'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

const WORKSPACE_VIEWS: ViewName[] = ['business', 'my-listings', 'edit', 'account', 'settings']

export function isMerchantWorkspaceView(name: ViewName): boolean {
  return WORKSPACE_VIEWS.includes(name)
}

/**
 * A focused merchant workspace rail. Customer discovery never inherits this
 * navigation; the rail appears only while a merchant is managing their shop.
 */
export function AppSidebar() {
  const { view, navigate } = useAppStore()
  const { user } = useSession()

  if (!isMerchantWorkspaceView(view.name)) return null

  const items: Array<{ name: ViewName; label: string; icon: React.ReactNode }> = [
    { name: 'business', label: 'Overview', icon: <LayoutDashboard aria-hidden /> },
    { name: 'my-listings', label: 'Products', icon: <Package aria-hidden /> },
    { name: 'account', label: 'Shop profile', icon: <Store aria-hidden /> },
    { name: 'settings', label: 'Settings', icon: <Settings aria-hidden /> },
  ]

  return (
    <aside
      aria-label="Merchant workspace"
      className="fixed inset-y-16 left-0 z-30 hidden w-60 flex-col border-r border-border/80 bg-card lg:flex"
    >
      <div className="border-b border-border/70 px-4 py-4">
        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Your workspace</p>
        <p className="mt-1 text-sm font-semibold text-foreground">Manage your business</p>
      </div>

      <nav className="flex-1 space-y-1 px-3 py-4" aria-label="Business sections">
        {items.map((item) => {
          const active =
            view.name === item.name ||
            (item.name === 'my-listings' && view.name === 'edit')
          return (
            <button
              key={item.name}
              type="button"
              onClick={() => navigate({ name: item.name })}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors',
                active
                  ? 'bg-primary text-primary-foreground'
                  : 'text-foreground/75 hover:bg-secondary hover:text-foreground',
              )}
            >
              <span className="[&_svg]:size-[18px]">{item.icon}</span>
              <span>{item.label}</span>
            </button>
          )
        })}
      </nav>

      <div className="space-y-2 border-t border-border/70 p-3">
        <Button className="mudaala-money-cta h-11 w-full justify-start gap-2" onClick={() => navigate({ name: 'publish' })}>
          <Plus className="size-4" aria-hidden />
          Add a product
        </Button>
        {user ? (
          <Button
            type="button"
            variant="outline"
            className="h-10 w-full justify-start gap-2"
            onClick={() => navigate({ name: 'shop', id: user.id })}
          >
            <ExternalLink className="size-4" aria-hidden />
            View public shop
          </Button>
        ) : null}
        <button
          type="button"
          onClick={() => navigate({ name: 'browse' })}
          className="flex min-h-10 w-full items-center gap-2 rounded-lg px-3 text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden />
          Back to Explore
        </button>
      </div>
    </aside>
  )
}
