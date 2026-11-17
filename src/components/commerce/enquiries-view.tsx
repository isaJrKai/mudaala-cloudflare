'use client'

import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { apiFetch } from '@/lib/client'
import { useSession } from '@/hooks/use-session'
import { useAppStore } from '@/lib/store'

type Enquiry = {
  id: string
  status: 'OPEN' | 'RESOLVED' | 'CANCELLED'
  followUpConsentAt: string | null
  role: 'MERCHANT' | 'SHOPPER'
  listing: { id: string; title: string; status: string }
  shopName: string
  lastMessage: { body: string; senderType: string; createdAt: string; deliveryStatus: string } | null
  lastMessageAt: string
}

type EnquiryMessage = {
  id: string
  senderType: 'MERCHANT' | 'SHOPPER'
  body: string
  deliveryStatus: string
  createdAt: string
}

function timeLabel(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

export function EnquiriesView({ shopperOnly = false }: { shopperOnly?: boolean }) {
  const { user, isLoading } = useSession()
  const userId = user?.id
  const { navigate, setAuthOpen } = useAppStore()
  const [items, setItems] = useState<Enquiry[]>([])
  const [loadedForUserId, setLoadedForUserId] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [messages, setMessages] = useState<EnquiryMessage[]>([])
  const [messagesFor, setMessagesFor] = useState<{ userId: string; enquiryId: string } | null>(null)
  const [messageError, setMessageError] = useState('')
  const [draft, setDraft] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')

  // Load the current account inbox. State updates happen in the asynchronous
  // response callback, and stale responses are discarded after account changes.
  useEffect(() => {
    if (!userId) return
    let cancelled = false
    apiFetch<{ enquiries: Enquiry[] }>('/api/enquiries')
      .then((result) => {
        if (cancelled) return
        const accountItems = shopperOnly ? result.enquiries.filter((item) => item.role === 'SHOPPER') : result.enquiries
        setItems(accountItems)
        setSelectedId((current) => current && accountItems.some((item) => item.id === current)
          ? current
          : accountItems[0]?.id ?? null)
        setError('')
        setLoadedForUserId(userId)
      })
      .catch((err) => {
        if (cancelled) return
        setItems([])
        setSelectedId(null)
        setError(err instanceof Error ? err.message : 'Could not load enquiries.')
        setLoadedForUserId(userId)
      })
    return () => { cancelled = true }
  }, [userId, shopperOnly])

  const refresh = useCallback(async () => {
    if (!userId) return
    setRefreshing(true)
    setError('')
    try {
      const result = await apiFetch<{ enquiries: Enquiry[] }>('/api/enquiries')
      const accountItems = shopperOnly ? result.enquiries.filter((item) => item.role === 'SHOPPER') : result.enquiries
      setItems(accountItems)
      setSelectedId((current) => current && accountItems.some((item) => item.id === current)
        ? current
        : accountItems[0]?.id ?? null)
      setLoadedForUserId(userId)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load enquiries.')
    } finally {
      setRefreshing(false)
    }
  }, [userId, shopperOnly])

  // The previous account's inbox stays hidden until this account's response
  // arrives. This avoids briefly showing another account's private messages.
  const visibleItems = loadedForUserId === userId ? items : []
  const loading = Boolean(userId && loadedForUserId !== userId) || refreshing

  useEffect(() => {
    if (!selectedId || !userId) return
    let cancelled = false
    apiFetch<{ messages: EnquiryMessage[] }>(`/api/enquiries/${encodeURIComponent(selectedId)}/messages`)
      .then((result) => {
        if (cancelled) return
        setMessages(result.messages)
        setMessagesFor({ userId, enquiryId: selectedId })
        setMessageError('')
      })
      .catch((err) => {
        if (cancelled) return
        setMessages([])
        setMessagesFor({ userId, enquiryId: selectedId })
        setMessageError(err instanceof Error ? err.message : 'Could not load this conversation.')
      })
    return () => { cancelled = true }
  }, [selectedId, userId])

  const selected = visibleItems.find((item) => item.id === selectedId) ?? null
  const messagesLoading = Boolean(selectedId && (messagesFor?.userId !== userId || messagesFor?.enquiryId !== selectedId))
  const visibleMessages = messagesLoading ? [] : messages

  async function sendMessage(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const message = draft.trim()
    if (!selectedId || !userId || !message || sending) return
    setSending(true)
    setError('')
    try {
      await apiFetch(`/api/enquiries/${encodeURIComponent(selectedId)}/messages`, {
        method: 'POST',
        body: JSON.stringify({ message }),
      })
      setDraft('')
      const result = await apiFetch<{ messages: EnquiryMessage[] }>(`/api/enquiries/${encodeURIComponent(selectedId)}/messages`)
      setMessages(result.messages)
      setMessagesFor({ userId, enquiryId: selectedId })
      setMessageError('')
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Message could not be sent.')
    } finally {
      setSending(false)
    }
  }

  if (isLoading) return <div className="py-12 text-center text-sm text-muted-foreground">Loading your enquiries…</div>
  if (!user) return <div className="rounded-lg border bg-card p-6 text-center"><h1 className="font-semibold">Sign in to view enquiries</h1><p className="mt-1 text-sm text-muted-foreground">Messages about your products and enquiries you have sent appear here.</p><Button className="mt-4" onClick={() => setAuthOpen(true)}>Sign in</Button></div>

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <button type="button" onClick={() => navigate({ name: shopperOnly ? 'browse' : 'business' })} className="mb-2 text-sm text-muted-foreground hover:text-foreground">{shopperOnly ? 'Back to Explore' : 'Business overview'}</button>
          <h1 className="text-xl font-semibold tracking-tight">{shopperOnly ? 'Messages' : 'Your enquiries'}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{shopperOnly ? 'Private conversations with shops on Mudaala.' : 'Private conversations with your customers and shops you contact.'}</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void refresh()} disabled={loading}>Refresh</Button>
      </div>

      {loadedForUserId === userId && error ? <p role="alert" className="rounded-md border border-destructive/30 px-3 py-2 text-sm text-destructive">{error}</p> : null}

      <div className="grid min-h-[460px] overflow-hidden rounded-lg border bg-card md:grid-cols-[minmax(220px,0.8fr)_minmax(0,1.6fr)]">
        <aside className="border-b md:border-b-0 md:border-r">
          <div className="border-b px-4 py-3"><p className="text-sm font-semibold">Inbox <span className="ml-1 text-muted-foreground">({visibleItems.length})</span></p></div>
          {loading && visibleItems.length === 0 ? <p className="p-4 text-sm text-muted-foreground">Loading enquiries…</p> : null}
          {!loading && visibleItems.length === 0 ? <div className="p-5"><p className="text-sm font-medium">No enquiries yet</p><p className="mt-1 text-xs text-muted-foreground">When you contact a seller or a shopper contacts your shop, the conversation will appear here.</p></div> : null}
          <div className="max-h-[520px] overflow-y-auto">
            {visibleItems.map((item) => (
              <button key={item.id} type="button" onClick={() => setSelectedId(item.id)} className={`block w-full border-b px-4 py-3 text-left transition-colors hover:bg-secondary/60 ${selectedId === item.id ? 'bg-secondary' : ''}`}>
                <span className="flex items-center justify-between gap-2"><span className="truncate text-sm font-medium">{item.listing.title}</span><span className="shrink-0 text-[10px] text-muted-foreground">{timeLabel(item.lastMessageAt)}</span></span>
                <span className="mt-1 block truncate text-xs text-muted-foreground">{item.role === 'MERCHANT' ? 'Customer' : 'You contacted seller'} · {item.lastMessage?.body ?? 'New enquiry'}</span>
                {item.role === 'SHOPPER' ? <span className="mt-1 block text-[11px] text-muted-foreground">Seller follow-up: {item.followUpConsentAt ? 'Allowed' : 'Not allowed'}</span> : null}
              </button>
            ))}
          </div>
        </aside>

        <div className="flex min-h-[460px] flex-col">
          {selected ? <>
            <header className="border-b px-4 py-3">
              <p className="text-sm font-semibold">{selected.listing.title}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{selected.role === 'MERCHANT' ? 'Customer enquiry' : 'Your enquiry'} · {selected.status.toLowerCase()}</p>
              {selected.role === 'SHOPPER' ? <div className="mt-2 flex flex-wrap items-center gap-2"><span className="text-xs text-muted-foreground">Allow seller to send a later follow-up?</span><Button size="sm" variant={selected.followUpConsentAt ? 'outline' : 'secondary'} onClick={async () => { try { const result = await apiFetch<{ followUpConsentAt: string | null }>(`/api/enquiries/${encodeURIComponent(selected.id)}/follow-up-consent`, { method: 'PATCH', body: JSON.stringify({ consent: !selected.followUpConsentAt }) }); setItems((current) => current.map((item) => item.id === selected.id ? { ...item, followUpConsentAt: result.followUpConsentAt } : item)) } catch (err) { setError(err instanceof Error ? err.message : 'Could not update consent.') } }}>{selected.followUpConsentAt ? 'Turn off follow-ups' : 'Allow follow-up'}</Button></div> : null}
            </header>
            <div className="flex-1 space-y-3 overflow-y-auto p-4">
              {messagesLoading ? <p className="text-sm text-muted-foreground">Loading conversation…</p> : null}
              {!messagesLoading && messageError ? <p role="alert" className="text-sm text-destructive">{messageError}</p> : null}
              {!messagesLoading && !messageError ? visibleMessages.map((message) => {
                const mine = selected.role === 'MERCHANT'
                  ? message.senderType === 'MERCHANT'
                  : message.senderType === 'SHOPPER'
                return <div key={message.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}><div className={`max-w-[85%] rounded-lg px-3 py-2 ${mine ? 'bg-primary text-primary-foreground' : 'bg-secondary text-foreground'}`}><p className="whitespace-pre-wrap break-words text-sm">{message.body}</p><p className={`mt-1 text-[10px] ${mine ? 'text-primary-foreground/70' : 'text-muted-foreground'}`}>{timeLabel(message.createdAt)}{mine && message.deliveryStatus === 'FAILED' ? ' · Telegram delivery failed' : ''}</p></div></div>
              }) : null}
              {!messagesLoading && !messageError && visibleMessages.length === 0 ? <p className="text-sm text-muted-foreground">No messages in this enquiry yet.</p> : null}
            </div>
            <form onSubmit={sendMessage} className="border-t p-3">
              <div className="flex items-end gap-2"><Textarea value={draft} onChange={(event) => setDraft(event.target.value)} rows={2} maxLength={1200} placeholder="Write a reply…" className="min-h-11 resize-y" /><Button type="submit" disabled={!draft.trim() || sending}>{sending ? 'Sending…' : 'Send reply'}</Button></div>
              <p className="mt-1 text-[11px] text-muted-foreground">Messages are saved in Mudaala. Both sides can return to this conversation at any time.</p>
            </form>
          </> : <div className="flex flex-1 items-center justify-center p-8 text-center"><div><p className="text-sm font-medium">Select an enquiry</p><p className="mt-1 text-xs text-muted-foreground">Choose a customer message to read and reply.</p></div></div>}
        </div>
      </div>
    </section>
  )
}
