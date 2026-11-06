'use client'

import { useQuery } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { apiGet } from '@/lib/client'
import { useAppStore } from '@/lib/store'

type Recommendation = {
  key: string
  type: string
  title: string
  body: string
  actionLabel: string
  actionUrl: string
  priority: 'NORMAL' | 'HIGH'
  reason: string
}

function openRecommendation(url: string, navigate: ReturnType<typeof useAppStore.getState>['navigate']) {
  if (url === '/#/publish') navigate({ name: 'publish' })
  else if (url === '/#/account') navigate({ name: 'account' })
  else if (url === '/#/home') navigate({ name: 'home' })
  else if (url.startsWith('/#/shop/')) navigate({ name: 'shop', id: decodeURIComponent(url.slice('/#/shop/'.length)) })
  else if (url.startsWith('/#/listing/')) navigate({ name: 'listing', id: decodeURIComponent(url.slice('/#/listing/'.length)) })
  else if (url.startsWith('/#/edit/')) navigate({ name: 'edit', id: decodeURIComponent(url.slice('/#/edit/'.length)) })
}

export function MerchantGrowthCoachCard() {
  const { navigate } = useAppStore()
  const query = useQuery({
    queryKey: ['growth-recommendation'],
    queryFn: () => apiGet<{ recommendation: Recommendation | null }>('/api/growth/recommendation'),
    staleTime: 5 * 60_000,
  })

  const recommendation = query.data?.recommendation
  if (query.isLoading || query.isError || !recommendation) return null

  return (
    <section className="relative overflow-hidden rounded-xl border border-[#dfcfaa] bg-[#fbf6e9] p-4 shadow-[0_1px_2px_rgba(46,55,39,0.05)] sm:p-5" aria-label="Mudaala Growth Coach">
      <div className="absolute inset-x-0 top-0 h-1 bg-[#e7bd4c]" />
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="mb-2 flex items-center gap-2">
            <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#80601e]">Mudaala Growth Coach</span>
            {recommendation.priority === 'HIGH' ? <span className="rounded-full bg-[#174a35]/10 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-[#174a35]">Worth doing first</span> : null}
          </div>
          <h2 className="font-display text-lg font-semibold leading-snug text-[#174a35]">{recommendation.title}</h2>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-[#53594e]">{recommendation.body}</p>
        </div>
        <Button
          className="h-11 shrink-0 bg-[#174a35] px-5 text-white hover:bg-[#103b2a]"
          onClick={() => openRecommendation(recommendation.actionUrl, navigate)}
        >
          {recommendation.actionLabel}
        </Button>
      </div>
    </section>
  )
}
