'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { apiFetch } from '@/lib/client'
import { StandaloneShowroom } from './standalone-showroom'

type PreviewResponse = { showroom: { id: string; title: string; status: string } }

export function ShowroomPreviewShell({ slug }: { slug: string }) {
  const router = useRouter()
  const [showroom, setShowroom] = useState<PreviewResponse['showroom'] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    fetch(`/api/showrooms/public/${encodeURIComponent(slug)}?preview=1`, { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error('This draft could not be opened. Sign in as its owner.')
        return response.json() as Promise<PreviewResponse>
      })
      .then((data) => { if (active) setShowroom(data.showroom) })
      .catch((err) => { if (active) setError(err instanceof Error ? err.message : 'Preview unavailable.') })
    return () => { active = false }
  }, [slug])

  async function publish() {
    if (!showroom) return
    setBusy(true)
    setError('')
    try {
      await apiFetch(`/api/showrooms/${encodeURIComponent(showroom.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'PUBLISHED' }),
      })
      router.push(`/showroom/${encodeURIComponent(slug)}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not publish this showroom.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="sticky top-0 z-50 flex flex-wrap items-center justify-between gap-3 border-b border-black/10 bg-[#f5f3ed]/95 px-4 py-3 backdrop-blur sm:px-8">
        <div><p className="text-[9px] font-semibold uppercase tracking-[.18em] text-[#47734d]">Private preview</p><p className="mt-0.5 text-xs text-neutral-600">Only you can see this draft.</p></div>
        <div className="flex items-center gap-2"><button type="button" onClick={() => router.push('/seller/showrooms')} className="rounded-full border border-black/15 px-4 py-2 text-xs font-semibold">Back to editor</button><button type="button" disabled={!showroom || busy || showroom.status === 'PUBLISHED'} onClick={() => void publish()} className="rounded-full bg-[#47734d] px-5 py-2 text-xs font-semibold text-white disabled:opacity-40">{busy ? 'Publishing…' : showroom?.status === 'PUBLISHED' ? 'Published' : 'Publish showroom'}</button></div>
      </div>
      {error && <p role="alert" className="bg-red-50 px-5 py-3 text-center text-xs text-red-700">{error}</p>}
      <StandaloneShowroom slug={slug} preview />
    </>
  )
}
