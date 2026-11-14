'use client'

import { Bell, Bookmark, Compass, LayoutDashboard, Package, Plus, Settings, Store } from 'lucide-react'
import { useAppStore, type ViewName } from '@/lib/store'
import { useSession } from '@/hooks/use-session'
import { useBellShake } from '@/hooks/use-bell-shake'
import { apiGet } from '@/lib/client'
import { useQuery } from '@tanstack/react-query'
import { cn } from '@/lib/utils'

interface NavItem {
  name: ViewName
  label: string
  icon: React.ReactNode
  destinationId?: string
}

export function BottomNav() {
  const { view, navigate } = useAppStore()
  const { user } = useSession()

  const notificationsQuery = useQuery({
    queryKey: ['notifications', 'badge'],
    enabled: Boolean(user),
    queryFn: () => apiGet<{ notifications: unknown[]; unreadCount: number }>('/api/notifications'),
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  })
  const unread = user ? (notificationsQuery.data?.unreadCount ?? 0) : 0
  const bellRef = useBellShake(unread)

  const workspace = ['business', 'my-listings', 'edit', 'account', 'settings'].includes(view.name)

  const publicItems: NavItem[] = [
    { name: 'browse', label: 'Explore', icon: <Compass aria-hidden /> },
    { name: 'saved', label: 'Saved', icon: <Bookmark aria-hidden /> },
    { name: 'publish', label: 'Post', icon: <Plus aria-hidden /> },
    { name: 'business', label: 'My Business', icon: <Store aria-hidden /> },
    { name: 'notifications', label: 'Alerts', icon: <Bell aria-hidden /> },
  ]

  const workspaceItems: NavItem[] = [
    { name: 'business', label: 'Overview', icon: <LayoutDashboard aria-hidden /> },
    { name: 'my-listings', label: 'Products', icon: <Package aria-hidden /> },
    { name: 'publish', label: 'Add', icon: <Plus aria-hidden /> },
    { name: 'account', label: 'Shop profile', icon: <Store aria-hidden /> },
    { name: 'settings', label: 'Settings', icon: <Settings aria-hidden /> },
  ]

  const items = workspace ? workspaceItems : publicItems

  function isActive(item: NavItem): boolean {
    if (item.name === 'browse' && ['browse', 'listing', 'shop'].includes(view.name)) return true
    if (item.name === 'my-listings' && view.name === 'edit') return true
    return view.name === item.name
  }

  return (
    <nav
      aria-label={workspace ? 'Business workspace navigation' : 'Marketplace navigation'}
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border/80 bg-card pb-[env(safe-area-inset-bottom)] lg:hidden"
    >
      <div className="mx-auto grid max-w-xl grid-cols-5">
        {items.map((item) => {
          const active = isActive(item)
          const isPost = item.name === 'publish'
          return (
            <button
              key={item.name}
              type="button"
              onClick={() => navigate({ name: item.name, ...(item.destinationId ? { id: item.destinationId } : {}) })}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'relative flex min-h-[60px] flex-col items-center justify-center gap-1 px-1 text-[10px] font-medium transition-colors focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary',
                active ? 'text-primary' : 'text-muted-foreground',
              )}
            >
              {isPost ? (
                <span className="mudaala-money-cta flex size-9 items-center justify-center rounded-xl">
                  <Plus className="size-5" aria-hidden />
                </span>
              ) : (
                <span className={cn('[&_svg]:size-[19px]', active && 'text-primary')}>
                  {item.name === 'notifications' ? (
                    <span ref={bellRef} className="relative inline-flex" style={{ transformOrigin: '50% 18%' }}>
                      {item.icon}
                    </span>
                  ) : item.icon}
                </span>
              )}
              <span className={cn('max-w-full truncate', isPost && 'font-semibold')}>{item.label}</span>
              {item.name === 'notifications' && unread > 0 ? (
                <span className="absolute right-[20%] top-1.5 flex min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[9px] font-semibold text-white">
                  {unread > 9 ? '9+' : unread}
                </span>
              ) : null}
            </button>
          )
        })}
      </div>
    </nav>
  )
}
