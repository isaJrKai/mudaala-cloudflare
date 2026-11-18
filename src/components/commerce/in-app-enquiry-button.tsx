'use client'

import { useState } from 'react'
import { MessageSquare } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { apiFetch } from '@/lib/client'
import { useSession } from '@/hooks/use-session'
import { useAppStore } from '@/lib/store'
import { useToast } from '@/hooks/use-toast'

type Props = {
  listingId: string
  shopName: string
  initialMessage: string
  label?: string
  className?: string
  variant?: 'default' | 'outline'
}

export function InAppEnquiryButton({
  listingId,
  shopName,
  initialMessage,
  label = 'Message seller',
  className,
  variant = 'outline',
}: Props) {
  const { user, isLoading } = useSession()
  const { navigate, setAuthOpen } = useAppStore()
  const { toast } = useToast()
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(initialMessage.slice(0, 1200))
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')

  function startEnquiry() {
    if (isLoading) return
    if (!user) {
      setAuthOpen(true)
      return
    }
    setDraft(initialMessage.slice(0, 1200))
    setError('')
    setOpen(true)
  }

  async function sendEnquiry() {
    const message = draft.trim()
    if (!message || sending) return
    setSending(true)
    setError('')
    try {
      await apiFetch('/api/enquiries', {
        method: 'POST',
        body: JSON.stringify({ listingId, message }),
      })
      setOpen(false)
      toast({
        title: 'Enquiry sent',
        description: shopName + ' can reply in your Mudaala messages.',
      })
      navigate({ name: 'messages' })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Your message could not be sent. Please try again.')
    } finally {
      setSending(false)
    }
  }

  return (
    <>
      <Button type="button" variant={variant} className={className} onClick={startEnquiry} disabled={isLoading}>
        <MessageSquare className="size-4" aria-hidden />
        {label}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Message {shopName}</DialogTitle>
            <DialogDescription>
              Your message goes straight to the shop&apos;s Mudaala Enquiries inbox. The seller can reply when they are back online.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            rows={5}
            maxLength={1200}
            placeholder="Write your message to the seller…"
            autoFocus
          />
          {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={sending}>Cancel</Button>
            <Button type="button" onClick={() => void sendEnquiry()} disabled={!draft.trim() || sending}>
              {sending ? 'Sending…' : 'Send enquiry'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
