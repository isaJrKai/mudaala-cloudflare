'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { BarChart3, Eye, MessageCircle, RefreshCw, Share2, TrendingUp } from 'lucide-react'
import { apiGet } from '@/lib/client'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'

type Period = '7d' | '30d' | '90d'

type BusinessAnalytics = {
  intelligence?: {
    status: 'AVAILABLE' | 'UNAVAILABLE'
    module?: string
    engineVersion?: string
    insights?: Array<{
      id: string
      severity: 'INFO' | 'WATCH' | 'ACTION'
      metric: string
      statement: string
      relatedListingTitle?: string
      suggested_action: string | null
      evidence: Array<{ ref: string; label: string; value: number }>
      confidence: null
    }>
    coverageWarnings?: string[]
  }
  period: Period
  since: string
  sales: Array<{
    currency: string
    completedSales: number
    recordedRevenue: number
    estimatedGrossProfit: number | null
    saleLines: number
    linesWithKnownCost: number
    costCoverage: number | null
  }>
  engagement: {
    views: number
    callClicks: number
    whatsappClicks: number
    shareClicks: number
    contactClicks: number
    topListings: Array<{
      listingId: string
      title: string
      views: number
      callClicks: number
      whatsappClicks: number
      shareClicks: number
    }>
  }
  shopEngagement: {
    views: number
    callClicks: number
    whatsappClicks: number
    shareClicks: number
    contactClicks: number
  }
  activeBusinessProducts: number
  inventoryTrackedProducts: number
}

function number(value: number) {
  return Math.max(0, value).toLocaleString()
}

function money(value: number, currency: string) {
  try {
    return new Intl.NumberFormat('en-UG', {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    }).format(value)
  } catch {
    return `${currency} ${number(value)}`
  }
}

function InsightMetric({ label, value, note, icon }: {
  label: string
  value: number
  note: string
  icon: React.ReactNode
}) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        {icon}<span>{label}</span>
      </div>
      <p className="mt-2 text-xl font-bold tabular-nums">{number(value)}</p>
      <p className="mt-1 text-xs text-muted-foreground">{note}</p>
    </div>
  )
}

/** Insights use recorded events only. They deliberately do not imply unique reach or confirmed sales. */
export function BusinessInsightsPanel() {
  const [period, setPeriod] = useState<Period>('30d')
  const query = useQuery({
    queryKey: ['my-business-analytics', period],
    queryFn: () => apiGet<BusinessAnalytics>(`/api/my/business-analytics?period=${period}`),
    staleTime: 60_000,
  })
  const data = query.data
  const maxViews = Math.max(1, ...(data?.engagement.topListings.map((item) => item.views) ?? []))

  return (
    <Card>
      <CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <CardTitle className="flex items-center gap-2"><BarChart3 className="size-5" aria-hidden /> Business insights</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">Understand which products attract attention and how customers try to contact you.</p>
        </div>
        <div className="flex shrink-0 gap-1" aria-label="Analytics reporting period">
          {(['7d', '30d', '90d'] as const).map((value) => (
            <Button key={value} type="button" size="sm" variant={period === value ? 'default' : 'outline'} aria-pressed={period === value} onClick={() => setPeriod(value)}>
              {value === '7d' ? '7 days' : value === '30d' ? '30 days' : '90 days'}
            </Button>
          ))}
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {query.isLoading ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-busy="true">
            {Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-24" />)}
          </div>
        ) : query.isError || !data ? (
          <div className="rounded-lg border border-dashed p-5 text-sm">
            <p>We couldn't load your business insights right now.</p>
            <Button className="mt-3" size="sm" variant="outline" onClick={() => void query.refetch()}><RefreshCw className="mr-2 size-3.5" aria-hidden /> Try again</Button>
          </div>
        ) : (
          <>
            <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label={`Engagement for the last ${period}`}>
              <InsightMetric label="Product views" value={data.engagement.views} note="Recorded product-page views" icon={<Eye className="size-4" aria-hidden />} />
              <InsightMetric label="Contact taps" value={data.engagement.contactClicks} note="Call and WhatsApp taps" icon={<MessageCircle className="size-4" aria-hidden />} />
              <InsightMetric label="Shop views" value={data.shopEngagement.views} note="Recorded public shop-page views" icon={<TrendingUp className="size-4" aria-hidden />} />
              <InsightMetric label="Shares" value={data.engagement.shareClicks} note="Share or copy-link taps" icon={<Share2 className="size-4" aria-hidden />} />
            </section>

            <section className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-lg border p-4">
                <h3 className="font-semibold">Products getting attention</h3>
                <p className="mt-1 text-xs text-muted-foreground">Ranked by recorded views in this period.</p>
                {data.engagement.topListings.length ? (
                  <ol className="mt-4 space-y-4">
                    {data.engagement.topListings.map((item) => (
                      <li key={item.listingId} className="space-y-1.5">
                        <div className="flex items-start justify-between gap-3 text-sm">
                          <span className="min-w-0 break-words">{item.title}</span>
                          <span className="shrink-0 font-semibold tabular-nums">{number(item.views)}</span>
                        </div>
                        <div className="h-2 overflow-hidden rounded-full bg-muted" role="img" aria-label={`${item.title}: ${number(item.views)} views`}>
                          <div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(2, item.views / maxViews * 100)}%` }} />
                        </div>
                        <p className="text-xs text-muted-foreground">{number(item.callClicks)} call taps · {number(item.whatsappClicks)} WhatsApp taps · {number(item.shareClicks)} shares</p>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="mt-4 rounded-md bg-muted/50 p-4 text-sm text-muted-foreground">No product engagement has been recorded for this period yet. As buyers view products and tap contact links, useful patterns will appear here.</p>
                )}
              </div>

              <div className="rounded-lg border p-4">
                <h3 className="font-semibold">Recorded sales</h3>
                <p className="mt-1 text-xs text-muted-foreground">Based on sales you entered in Mudaala, not payment-processor confirmation.</p>
                {data.sales.length ? (
                  <div className="mt-4 space-y-3">
                    {data.sales.map((sale) => (
                      <div key={sale.currency} className="rounded-md bg-muted/40 p-3">
                        <p className="text-xs text-muted-foreground">{sale.currency} · {number(sale.completedSales)} completed recorded sales</p>
                        <p className="mt-1 text-xl font-bold tabular-nums">{money(sale.recordedRevenue, sale.currency)}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {sale.estimatedGrossProfit === null
                            ? 'Profit unavailable: some item costs have not been recorded.'
                            : `Estimated gross profit: ${money(sale.estimatedGrossProfit, sale.currency)}`}
                        </p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="mt-4 rounded-md bg-muted/50 p-4 text-sm text-muted-foreground">No completed sales were recorded for this period. You can still use product views and contact taps to understand customer interest.</p>
                )}
                <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                  <div><p className="text-muted-foreground">Products in catalogue</p><p className="mt-1 font-semibold tabular-nums">{number(data.activeBusinessProducts)}</p></div>
                  <div><p className="text-muted-foreground">Tracking stock</p><p className="mt-1 font-semibold tabular-nums">{number(data.inventoryTrackedProducts)}</p></div>
                </div>
              </div>
            </section>
            {data.intelligence?.status === 'AVAILABLE' && ((data.intelligence.insights?.length ?? 0) > 0 || (data.intelligence.coverageWarnings?.length ?? 0) > 0) ? (
              <section className="rounded-lg border p-4" aria-label="Mudaala business signals">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div>
                    <h3 className="font-semibold">Business signals</h3>
                    <p className="mt-1 text-xs text-muted-foreground">Patterns from your recorded listing activity, not predictions of sales.</p>
                  </div>
                  <span className="text-xs text-muted-foreground">Rule-based · {data.intelligence.engineVersion ?? 'MCI-27'}</span>
                </div>
                {(data.intelligence.insights?.length ?? 0) > 0 ? (
                  <div className="mt-3 divide-y">
                    {data.intelligence.insights!.map((insight) => (
                      <article key={insight.id} className="py-3 first:pt-0 last:pb-0">
                        <div className="flex items-center gap-2">
                          <span className={insight.severity === 'ACTION' ? 'rounded-full bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-800 dark:text-amber-300' : insight.severity === 'WATCH' ? 'rounded-full bg-muted px-2 py-0.5 text-xs font-medium' : 'rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:text-emerald-300'}>
                            {insight.severity === 'ACTION' ? 'Action to consider' : insight.severity === 'WATCH' ? 'Worth watching' : 'Positive signal'}
                          </span>
                        </div>
                        {insight.relatedListingTitle ? <p className="mt-2 text-sm font-medium">{insight.relatedListingTitle}</p> : null}
                        <p className={insight.relatedListingTitle ? 'mt-1 text-sm' : 'mt-2 text-sm'}>{insight.statement}</p>
                        {insight.suggested_action ? <p className="mt-1 text-sm text-muted-foreground"><span className="font-medium">Possible next step: </span>{insight.suggested_action}</p> : null}
                      </article>
                    ))}
                  </div>
                ) : <p className="mt-3 text-sm text-muted-foreground">There is not enough recorded activity to produce a useful signal yet.</p>}
                {(data.intelligence.coverageWarnings?.length ?? 0) > 0 ? (
                  <ul className="mt-3 space-y-1 border-t pt-3 text-xs text-muted-foreground">
                    {data.intelligence.coverageWarnings!.map((warning, index) => <li key={index}>{warning}</li>)}
                  </ul>
                ) : null}
              </section>
            ) : null}

            <p className="text-xs text-muted-foreground">
              These figures are not unique people reached, ad impressions, confirmed enquiries or verified payments. Call and WhatsApp counts record button taps only. Audience demographics are not shown because Mudaala does not currently collect reliable, consented demographic data for this purpose.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  )
}
