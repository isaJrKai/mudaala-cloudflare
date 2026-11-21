// "Before you pay" - shown only when a shop page is opened from a tap-to-shop
// tag or its QR. A sticker can be covered or swapped, so the buyer gets three
// checks they can do in seconds, plus a one-tap report that reaches moderation.

import { ShieldCheck } from 'lucide-react'
import { ReportButton } from '@/components/commerce/report-button'

export function TagSafetyNotice({ shopId, shopName, shopCode, host }: { shopId: string; shopName: string; shopCode: string; host: string }) {
  return (
    <section aria-label="Before you pay" className="mx-4 mt-3 rounded-lg border border-emerald-200 bg-emerald-50/60 p-3">
      <h2 className="flex items-center gap-1.5 text-sm font-semibold text-emerald-900">
        <ShieldCheck className="size-4" aria-hidden /> Before you pay: 3 quick checks
      </h2>
      <ol className="mt-1.5 list-decimal space-y-0.5 pl-5 text-[13px] leading-snug text-emerald-950/80">
        <li>Your browser address shows <span className="font-semibold">{host}</span>.</li>
        <li>The shop name and code here (<span className="font-semibold">{shopName}</span>, <span className="font-semibold">{shopCode}</span>) match the sticker.</li>
        <li>The name on your MoMo or Airtel confirmation matches the pay sheet.</li>
      </ol>
      <p className="mt-1.5 text-[13px] text-emerald-950/80">If anything is different, stop and tell us.</p>
      <div className="mt-2 border-t border-emerald-200 pt-2">
        <ReportButton targetType="SHOP" targetId={shopId} noun="tag" contextNote="[Reported from a tap-to-shop tag]" />
      </div>
    </section>
  )
}
