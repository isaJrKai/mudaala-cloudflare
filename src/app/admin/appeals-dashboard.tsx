'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2, RefreshCw, Send } from 'lucide-react'

type CaseStatus = 'OPEN' | 'IN_REVIEW' | 'WAITING_ON_OWNER' | 'DECIDED' | 'CLOSED' | 'ALL'
type AppealCase = {
  id: string
  targetType: 'USER' | 'SHOP' | 'LISTING'
  targetId: string
  targetReference: string | null
  title: string
  statement: string
  status: Exclude<CaseStatus, 'ALL'>
  priority: 'NORMAL' | 'HIGH' | 'URGENT'
  decision: 'UPHELD' | 'REVERSED' | null
  decisionReason: string | null
  owner: { id: string; name: string; phone: string }
  assignedAdmin: { id: string; name: string } | null
  _count?: { messages: number; events: number }
  events?: Array<{ id: string; eventType: string; createdAt: string; actorId?: string | null; details?: unknown }>
}
type CaseMessage = { id: string; body: string; senderRole: string; evidenceUrls: string; internal: boolean; createdAt: string; sender: { name: string } }

function parseEvidenceUrls(raw: string): string[] {
  try { const parsed = JSON.parse(raw); return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string' && value.startsWith('https://')) : [] } catch { return [] }
}

export function AppealsDashboard() {
  const [status, setStatus] = useState<CaseStatus>('OPEN')
  const [cases, setCases] = useState<AppealCase[]>([])
  const [selected, setSelected] = useState<AppealCase | null>(null)
  const [messages, setMessages] = useState<CaseMessage[]>([])
  const [reply, setReply] = useState('')
  const [evidenceInput, setEvidenceInput] = useState('')
  const [decisionReason, setDecisionReason] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setError('')
    try {
      const response = await fetch('/api/admin/appeals?status=' + status)
      const payload = await response.json().catch(() => null)
      if (!response.ok) throw new Error(payload?.error ?? 'Could not load appeal cases.')
      setCases(payload?.appealCases ?? [])
      if (selected) {
        const refreshed = (payload?.appealCases ?? []).find((item: AppealCase) => item.id === selected.id)
        if (refreshed) setSelected(refreshed)
      }
    } catch (err) { setError(err instanceof Error ? err.message : 'Connection problem.') }
  }, [status, selected?.id])

  const openCase = useCallback(async (item: AppealCase) => {
    setSelected(item)
    setError('')
    try {
      const response = await fetch('/api/appeals/' + item.id)
      const payload = await response.json().catch(() => null)
      if (!response.ok) throw new Error(payload?.error ?? 'Could not load this case.')
      setSelected(payload.appealCase)
      setMessages(payload.appealCase.messages ?? [])
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not load this case.') }
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => { void load() }, 0)
    return () => window.clearTimeout(timer)
  }, [load])

  async function updateCase(changes: Record<string, unknown>) {
    if (!selected) return
    setBusy(true); setError('')
    try {
      const response = await fetch('/api/appeals/' + selected.id, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(changes) })
      const payload = await response.json().catch(() => null)
      if (!response.ok) throw new Error(payload?.error ?? 'Could not update this case.')
      await load()
      const refreshed = cases.find((item) => item.id === selected.id)
      if (refreshed) await openCase(refreshed)
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not update this case.') }
    finally { setBusy(false) }
  }

  async function sendReply(event: React.FormEvent) {
    event.preventDefault()
    if (!selected || !reply.trim()) return
    setBusy(true); setError('')
    try {
      const response = await fetch('/api/appeals/' + selected.id, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ body: reply.trim(), evidenceUrls: evidenceInput.split(/\r?\n/).map((value) => value.trim()).filter(Boolean).slice(0, 5) }) })
      const payload = await response.json().catch(() => null)
      if (!response.ok) throw new Error(payload?.error ?? 'Could not send your reply.')
      setReply('')
      setEvidenceInput('')
      await openCase(selected)
      await load()
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not send your reply.') }
    finally { setBusy(false) }
  }

  return (
    <div className="mt-4">
      <div className="flex flex-wrap items-center gap-2">
        {(['OPEN', 'IN_REVIEW', 'WAITING_ON_OWNER', 'DECIDED', 'CLOSED', 'ALL'] as const).map((value) => (
          <button key={value} type="button" onClick={() => setStatus(value)} aria-pressed={status === value} className={`rounded-full border px-3 py-1.5 text-xs font-medium ${status === value ? 'border-foreground bg-foreground text-background' : 'bg-card hover:bg-accent/50'}`}>
            {value.replaceAll('_', ' ')}
          </button>
        ))}
        <button type="button" onClick={() => void load()} className="ml-auto inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs"><RefreshCw className="size-3.5" /> Refresh</button>
      </div>
      {error ? <p role="alert" className="mt-3 rounded-md border border-destructive/30 p-3 text-sm text-destructive">{error}</p> : null}
      <div className="mt-3 grid gap-4 lg:grid-cols-[minmax(240px,0.8fr)_minmax(0,1.5fr)]">
        <div className="space-y-2">
          {cases.length === 0 ? <p className="rounded-lg border p-4 text-sm text-muted-foreground">No appeal cases in this queue.</p> : cases.map((item) => (
            <button key={item.id} type="button" onClick={() => void openCase(item)} className={`w-full rounded-lg border p-3 text-left ${selected?.id === item.id ? 'border-primary bg-primary/5' : 'bg-card hover:bg-accent/30'}`}>
              <span className="flex items-center justify-between gap-2 text-xs text-muted-foreground"><span>{item.targetType} · {item.status.replaceAll('_', ' ')}</span><span>{item.priority}</span></span>
              <span className="mt-1 block text-sm font-semibold">{item.title}</span>
              <span className="mt-1 block text-xs text-muted-foreground">{item.owner.name} · {item.owner.phone}</span>
              <span className="mt-1 block text-xs text-muted-foreground">{item._count?.messages ?? 0} messages</span>
            </button>
          ))}
        </div>
        {selected ? (
          <section className="min-w-0 rounded-lg border p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div><h3 className="font-semibold">{selected.title}</h3><p className="mt-1 text-xs text-muted-foreground">{selected.targetType} · {selected.targetId} · {selected.owner.name} ({selected.owner.phone})</p></div>
              <span className="rounded-full border px-2 py-1 text-xs">{selected.status.replaceAll('_', ' ')}</span>
            </div>
            <p className="mt-3 whitespace-pre-wrap text-sm">{selected.statement}</p>
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              <label className="text-xs font-medium">Assign to
                <button type="button" disabled={busy} onClick={() => void updateCase({ assignedAdminId: 'SELF' })} className="mt-1 block h-9 w-full rounded-md border px-2 text-left text-sm">Assign to me</button>
              </label>
              <label className="text-xs font-medium">Case status
                <select value={selected.status} onChange={(event) => void updateCase({ status: event.target.value })} className="mt-1 h-9 w-full rounded-md border bg-background px-2 text-sm">
                  <option value="OPEN">Open</option><option value="IN_REVIEW">In review</option><option value="WAITING_ON_OWNER">Waiting on owner</option><option value="CLOSED">Closed</option>
                </select>
              </label>
            </div>
            {selected.events?.length ? <details className="mt-4 border-t pt-3"><summary className="cursor-pointer text-sm font-semibold">Case timeline ({selected.events.length})</summary><ol className="mt-2 space-y-2">{selected.events.map((event) => <li key={event.id} className="flex flex-wrap justify-between gap-2 text-xs"><span>{event.eventType.replaceAll('_', ' ')}</span><time className="text-muted-foreground">{new Date(event.createdAt).toLocaleString()}</time></li>)}</ol></details> : null}
            <div className="mt-4 space-y-2 border-t pt-3">
              <h4 className="text-sm font-semibold">Case conversation</h4>
              {messages.map((message) => (
                <article key={message.id} className="rounded-md bg-muted/40 p-3">
                  <p className="text-xs text-muted-foreground">{message.senderRole === 'MODERATOR' ? 'Mudaala review team' : message.sender.name} · {new Date(message.createdAt).toLocaleString()}</p>
                  <p className="mt-1 whitespace-pre-wrap text-sm">{message.body}</p>
                  {parseEvidenceUrls(message.evidenceUrls).map((url, index) => <a key={url} href={url} target="_blank" rel="noreferrer" className="mt-2 mr-3 inline-block text-xs text-primary underline">Evidence {index + 1}</a>)}
                </article>
              ))}
              <form onSubmit={sendReply} className="space-y-2">
                <textarea value={reply} onChange={(event) => setReply(event.target.value)} rows={3} maxLength={3000} className="w-full rounded-md border bg-background p-3 text-sm" placeholder="Ask for evidence, clarify the case, or explain next steps…" />
                <label className="block text-xs text-muted-foreground">Evidence links (optional, up to 5 HTTPS links; one per line)<textarea value={evidenceInput} onChange={(event) => setEvidenceInput(event.target.value)} rows={2} className="mt-1 w-full rounded-md border bg-background p-2 text-xs" placeholder="https://…" /></label>
                <button type="submit" disabled={busy || !reply.trim()}                <button type="submit" disabled={busy || !reply.trim()} className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-3 text-sm text-primary-foreground disabled:opacity-50"><Send className="size-4" /> Send reply</button>
              </form>
            </div>
            {!selected.decision ? (
              <div className="mt-4 space-y-2 border-t pt-3">
                <label className="block text-xs font-medium">Final decision reason
                  <textarea value={decisionReason} onChange={(event) => setDecisionReason(event.target.value)} rows={2} maxLength={1000} className="mt-1 w-full rounded-md border bg-background p-2 text-sm" placeholder="Record the reason for the decision (at least 10 characters)." />
                </label>
                <div className="flex flex-wrap gap-2">
                  <button type="button" disabled={busy || decisionReason.trim().length < 10} onClick={() => { if (window.confirm('Uphold the restriction?')) void updateCase({ decision: 'UPHELD', decisionReason }) }} className="h-9 rounded-md border px-3 text-xs disabled:opacity-50">Uphold restriction</button>
                  <button type="button" disabled={busy || decisionReason.trim().length < 10} onClick={() => { if (window.confirm('Accept the appeal and restore the account, shop or listing?')) void updateCase({ decision: 'REVERSED', decisionReason }) }} className="h-9 rounded-md bg-primary px-3 text-xs text-primary-foreground disabled:opacity-50">Accept and restore</button>
                </div>
              </div>
            ) : <p className="mt-4 border-t pt-3 text-sm font-medium">Decision: {selected.decision} — {selected.decisionReason}</p>}
          </section>
        ) : <div className="rounded-lg border p-6 text-sm text-muted-foreground">Select an appeal case to review its history and respond.</div>}
      </div>
      {busy ? <p className="mt-2 flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="size-3 animate-spin" /> Saving…</p> : null}
    </div>
  )
}
