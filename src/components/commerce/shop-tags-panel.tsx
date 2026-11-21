'use client'

// Seller tool: tap-to-shop tags. A tag (NTAG213 sticker, ~UGX 1-3k) stores the
// shop link only - buyers tap or scan, the shop opens, and they pay through the
// shop's own pay sheet. So a seller with no physical shop can put one on a
// hostel door or notice board and sell while away. Web NFC (Android Chrome)
// writes and locks the tag in-app; every other phone gets the NFC Tools guide.

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Copy, Nfc, Printer } from 'lucide-react'
import QRCode from 'react-qr-code'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { apiFetch, apiGet } from '@/lib/client'
import type { OwnerTag, OwnerTagsResponse } from '@/lib/shop-tags'

type NdefReaderLike = {
  write: (message: { records: { recordType: string; data: string }[] }) => Promise<void>
  makeReadOnly?: () => Promise<void>
}

function ndefReader(): NdefReaderLike | null {
  if (typeof window === 'undefined') return null
  const Ctor = (window as unknown as { NDEFReader?: new () => NdefReaderLike }).NDEFReader
  return Ctor ? new Ctor() : null
}

const escapeHtml = (v: string) => v.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string)

function printSticker(tag: OwnerTag, shopName: string, shopCode: string): boolean {
  const svg = document.querySelector(`[data-tag-qr="${tag.id}"] svg`)?.cloneNode(true) as SVGElement | undefined
  const w = window.open('', '_blank', 'width=480,height=640')
  if (!svg || !w) return false
  svg.setAttribute('width', '220')
  svg.setAttribute('height', '220')
  w.document.write(
    `<!doctype html><title>Mudaala tag sticker</title><style>body{margin:0;display:flex;justify-content:center;font-family:Arial,sans-serif}` +
      `.s{width:7cm;margin:16px;padding:14px;border:3px solid #174a35;border-radius:18px;text-align:center;color:#174a35}` +
      `.h{font-size:20px;font-weight:700}.n{font-size:17px;font-weight:700;margin-top:8px}.c{font-size:15px;margin-top:4px}</style>` +
      `<div class="s"><div class="h">Tap your phone here<br>or scan to shop</div>${svg.outerHTML}` +
      `<div class="n">${escapeHtml(shopName)}</div><div class="c">Shop code: ${escapeHtml(shopCode)}</div></div>`,
  )
  w.document.close()
  w.focus()
  w.print()
  return true
}

export function ShopTagsPanel({ shopName }: { shopName: string }) {
  const qc = useQueryClient()
  const [label, setLabel] = useState('')
  const [notice, setNotice] = useState<{ id: string; text: string } | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const { data, isError } = useQuery({ queryKey: ['my-shop-tags'], queryFn: () => apiGet<OwnerTagsResponse>('/api/my/tags') })
  const save = (res: OwnerTagsResponse) => qc.setQueryData(['my-shop-tags'], res)
  const say = (id: string, text: string) => setNotice({ id, text })
  const fail = (id: string) => (e: unknown) => say(id, e instanceof Error ? e.message : 'Something went wrong. Try again.')

  const create = useMutation({
    mutationFn: () => apiFetch<OwnerTagsResponse>('/api/my/tags', { method: 'POST', body: JSON.stringify({ label }) }),
    onSuccess: (res) => { save(res); setLabel(''); setNotice(null) },
    onError: fail('new'),
  })
  const patch = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) =>
      apiFetch<OwnerTagsResponse>(`/api/my/tags/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    onSuccess: save,
    onError: (e, v) => fail(v.id)(e),
  })

  async function copyLink(tag: OwnerTag) {
    try { await navigator.clipboard.writeText(tag.nfcUrl); say(tag.id, 'Link copied. Paste it into NFC Tools to write the tag.') }
    catch { say(tag.id, tag.nfcUrl) }
  }

  async function writeTag(tag: OwnerTag) {
    const reader = ndefReader()
    if (!reader) return say(tag.id, 'In-app writing works on Android Chrome. On other phones, copy the link and write it with the free NFC Tools app.')
    setBusyId(tag.id)
    say(tag.id, 'Hold the back of your phone against the tag...')
    try { await reader.write({ records: [{ recordType: 'url', data: tag.nfcUrl }] }); say(tag.id, 'Written. Now lock the tag so nobody can change it.') }
    catch { say(tag.id, 'Could not write the tag. Hold it steady against the phone and try again.') }
    finally { setBusyId(null) }
  }

  async function lockTag(tag: OwnerTag) {
    const reader = ndefReader()
    if (!reader?.makeReadOnly) return say(tag.id, 'Lock it in NFC Tools (Other > Lock tag), then tap "I locked it".')
    if (!window.confirm('Locking is permanent: this tag can never be rewritten. Lock it now?')) return
    setBusyId(tag.id)
    say(tag.id, 'Hold the tag against your phone to lock it...')
    try { await reader.makeReadOnly(); patch.mutate({ id: tag.id, body: { locked: true } }); say(tag.id, 'Locked. Stick it where buyers will tap.') }
    catch { say(tag.id, 'Could not lock the tag. Hold it steady and try again.') }
    finally { setBusyId(null) }
  }

  if (isError || !data) return null
  const canLockInApp = typeof window !== 'undefined' && Boolean(ndefReader()?.makeReadOnly)

  return (
    <section aria-label="Tap-to-shop tags" className="rounded-lg border bg-card p-4 sm:p-5">
      <div className="flex items-start gap-2">
        <Nfc className="mt-0.5 size-5 text-primary" aria-hidden />
        <div>
          <h2 className="text-base font-semibold">Tap-to-shop tags</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Stick an NFC tag on a door, notice board or table. One tap opens your shop, so you sell even when you are away. Buyers pay through your shop, never a number on the tag.
          </p>
        </div>
      </div>

      <ul className="mt-4 space-y-3">
        {data.tags.map((tag) => (
          <li key={tag.id} className="rounded-md border p-3">
            <div className="flex items-start gap-3">
              <div data-tag-qr={tag.id} className="size-16 shrink-0 rounded border bg-white p-1">
                <QRCode value={tag.qrUrl} size={56} role="img" aria-label={`QR code for ${tag.label}`} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{tag.label}</p>
                <p className="text-xs text-muted-foreground">
                  {tag.taps30d} taps · {tag.qrScans30d} scans in 30 days · {tag.status === 'ACTIVE' ? 'Active' : 'Off'} · {tag.lockedAt ? 'Locked' : 'Not locked yet'}
                </p>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button size="sm" variant="outline" className="gap-1.5" disabled={busyId === tag.id} onClick={() => writeTag(tag)}><Nfc className="size-4" aria-hidden /> Write to tag</Button>
              {!tag.lockedAt ? <Button size="sm" variant="outline" disabled={busyId === tag.id} onClick={() => lockTag(tag)}>Lock tag</Button> : null}
              {!tag.lockedAt && !canLockInApp ? <Button size="sm" variant="ghost" onClick={() => patch.mutate({ id: tag.id, body: { locked: true } })}>I locked it</Button> : null}
              <Button size="sm" variant="outline" className="gap-1.5" onClick={() => copyLink(tag)}><Copy className="size-4" aria-hidden /> Copy link</Button>
              <Button size="sm" variant="outline" className="gap-1.5" onClick={() => { if (!printSticker(tag, shopName, data.shopCode)) say(tag.id, 'Allow pop-ups to print the sticker.') }}><Printer className="size-4" aria-hidden /> Sticker</Button>
              <Button size="sm" variant="ghost" onClick={() => patch.mutate({ id: tag.id, body: { status: tag.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE' } })}>{tag.status === 'ACTIVE' ? 'Turn off' : 'Turn on'}</Button>
              <Button size="sm" variant="ghost" onClick={() => { if (window.confirm('Get a fresh link for this spot? The old link stops counting, and you will need to write the new one onto the tag.')) patch.mutate({ id: tag.id, body: { rotate: true } }) }}>New link</Button>
            </div>
            {notice?.id === tag.id ? <p role="status" className="mt-2 flex items-center gap-1 break-all text-xs text-muted-foreground"><Check className="size-3.5 shrink-0" aria-hidden />{notice.text}</p> : null}
          </li>
        ))}
      </ul>

      {data.tags.length < data.max ? (
        <div className="mt-4 flex gap-2">
          <Input value={label} maxLength={40} placeholder="Where will it go? e.g. Hostel A door" aria-label="Tag name" onChange={(e) => setLabel(e.target.value)} />
          <Button disabled={create.isPending || label.trim().length < 2} onClick={() => create.mutate()}>Add tag</Button>
        </div>
      ) : (
        <p className="mt-4 text-xs text-muted-foreground">You have {data.max} tags, the most a shop can keep. Turn one off or give it a new link to reuse the spot.</p>
      )}
      {notice?.id === 'new' ? <p role="alert" className="mt-2 text-xs text-destructive">{notice.text}</p> : null}

      <details className="mt-4 text-sm">
        <summary className="cursor-pointer font-medium">How to set up a tag</summary>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-muted-foreground">
          <li>Buy NTAG213 (or 215/216) stickers. Use "on-metal" ones if the spot is metal.</li>
          <li>Add a tag above, then tap "Write to tag". On Android Chrome it writes in-app. Otherwise copy the link and write it with the free NFC Tools app.</li>
          <li>Lock the tag so nobody can overwrite it with another link.</li>
          <li>Print the sticker and stick the QR next to the tag, for phones without NFC.</li>
          <li>Ask permission before placing tags on doors or boards you do not own.</li>
        </ol>
      </details>
    </section>
  )
}
