'use client'

import { useState } from 'react'
import { MessageSquare, Send } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { apiFetch } from '@/lib/client'
import { useSession } from '@/hooks/use-session'
import { useAppStore } from '@/lib/store'

type Props = {
  listingId: string
  shopName: string
  initialMessage?: string
  label?: string
  className?: string
}

export function StartEnquiryButton({
  listingId,
  shopName,
  initialMessage = 'Hi, I am interested in this product. Is it available?',
  label = 'Message seller',
  className,
}: Props) {
  const { user } = useSession()
  const { navigate, setAuthOpen } = useAppStore()
  const [open, setOpen] = useState(false)
  const [message, setMessage] = useState(initialMessage)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')

  function begin() {
    if (!user) {
      setAuthOpen(true)
      return
    }
    setMessage(initialMessage)
    setError('')
    setOpen(true)
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const body = message.trim()
    if (!body || sending) return
    setSending(true)
    setError('')
    try {
      await apiFetch('/api/enquiries', {
        method: 'POST',
        body: JSON.stringify({ listingId, message: body }),
      })
      setOpen(false)
      navigate({ name: 'enquiries' })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Your message could not be sent. Please try again.')
    } finally {
      setSending(false)
    }
  }

  return (
    <>
      <Button type="button" variant="outline" className={className} onClick={begin}>
        <MessageSquare className="size-4" aria-hidden /> {label}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Message {shopName}</DialogTitle>
            <DialogDescription>
              Your message is saved in the shop's Mudaala inbox. The seller can reply when they come back online.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submit} className="space-y-3">
            <Textarea
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              rows={5}
              maxLength={1200}
              placeholder="Write your message to the seller…"
              autoFocus
            />
            {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={sending}>Cancel</Button>
              <Button type="submit" disabled={!message.trim() || sending}>
                <Send className="size-4" aria-hidden /> {sending ? 'Sending…' : 'Send enquiry'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
