'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2, Send } from 'lucide-react'

type AppealCaseView = {
  id: string
  title: string
  status: string
  decision: string | null
  decisionReason: string | null
  messages: Array<{ id: string; body: string; senderRole: string; createdAt: string; evidenceUrls: string }>
}

export function AppealCasePortal({ caseId, accessToken }: { caseId: string; accessToken: string }) {
  const [appealCase, setAppealCase] = useState<AppealCaseView | null>(null)
  const [reply, setReply] = useState('')
  const [evidenceInput, setEvidenceInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    const response = await fetch('/api/appeals/' + caseId, { headers: { 'x-appeal-access-token': accessToken } })
    const payload = await response.json().catch(() => null)
    if (!response.ok) throw new Error(payload?.error ?? 'Could not open this appeal case.')
    setAppealCase(payload.appealCase)
  }, [caseId, accessToken])

  useEffect(() => { void load().catch((err) => setError(err instanceof Error ? err.message : 'Could not load the case.')) }, [load])

  async function sendReply(event: React.FormEvent) {
    event.preventDefault()
    if (!reply.trim()) return
    setBusy(true); setError('')
    try {
      const response = await fetch('/api/appeals/' + caseId, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-appeal-access-token': accessToken },
        body: JSON.stringify({ body: reply.trim(), evidenceUrls: evidenceInput.split(/\r?\n/).map((value) => value.trim()).filter(Boolean).slice(0, 5) }),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok) throw new Error(payload?.error ?? 'Could not send your reply.')
      setReply('')
      setEvidenceInput('')
      await load()
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not send your reply.') }
    finally { setBusy(false) }
  }

  return (
    <section className="mt-4 rounded-lg border bg-background p-3">
      <div className="flex items-center justify-between gap-2"><h4 className="text-sm font-semibold">Your appeal case</h4>{appealCase ? <span className="rounded-full border px-2 py-1 text-xs">{appealCase.status.replaceAll('_', ' ')}</span> : null}</div>
      {appealCase ? (
        <>
          <div className="mt-3 max-h-64 space-y-2 overflow-y-auto">
            {appealCase.messages.map((message) => (
              <article key={message.id} className="rounded-md bg-muted/40 p-3">
                <p className="text-xs text-muted-foreground">{message.senderRole === 'MODERATOR' ? 'Mudaala review team' : 'You'} · {new Date(message.createdAt).toLocaleString()}</p>
                <p className="mt-1 whitespace-pre-wrap text-sm">{message.body}</p>
                {message.evidenceUrls && message.evidenceUrls !== '[]' ? <p className="mt-1 break-all text-xs">{message.evidenceUrls}</p> : null}
              </article>
            ))}
          </div>
          {appealCase.decision ? <p className="mt-3 text-sm"><strong>Decision: {appealCase.decision}</strong><br />{appealCase.decisionReason}</p> : (
            <form onSubmit={sendReply} className="mt-3 space-y-2">
              <textarea value={reply} onChange={(event) => setReply(event.target.value)} rows={2} maxLength={3000} className="w-full rounded-md border bg-background p-2 text-sm" placeholder="Reply to the Mudaala review team…" />
              <label className="block text-xs text-muted-foreground">Evidence links (optional, up to 5 HTTPS links; one per line)<textarea value={evidenceInput} onChange={(event) => setEvidenceInput(event.target.value)} rows={2} className="mt-1 w-full rounded-md border bg-background p-2 text-xs" placeholder="https://…" /></label>
              <button type="submit" disabled={busy || !reply.trim()} className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-3 text-sm text-primary-foreground disabled:opacity-50"><Send className="size-4" /> Send reply</button>
            </form>
          )}
        </>
      ) : <p className="mt-2 flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="size-3 animate-spin" /> Loading case…</p>}
      {error ? <p role="alert" className="mt-2 text-xs text-destructive">{error}</p> : null}
    </section>
  )
}
