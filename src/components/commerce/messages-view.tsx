'use client'

// MessagesView - buyer-seller chat: the inbox (both roles) and the thread.
// Real-time comes from polling: the thread refetches every 3s while it is
// open (which is also what grants the other side its delivery/read ticks),
// the inbox every 10s for previews and unread badges. No sockets - the
// polling endpoints ARE the transport, everywhere this app deploys.
// Architecture reference: the user's WhatsApp system-design diagram, scoped
// to one Postgres and two participants (see docs/BUYER_SELLER_CHAT.md).

import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Check, CheckCheck, Send } from 'lucide-react'
import { apiGet, apiPost } from '@/lib/client'
import type {
  ChatInboxResponse,
  ChatMessageT,
  ChatSendMessageResponse,
  ChatThreadResponse,
} from '@/lib/client'
import { useAppStore } from '@/lib/store'
import { useSession } from '@/hooks/use-session'
import { useToast } from '@/hooks/use-toast'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { EmptyState } from './empty-state'
import { cn } from '@/lib/utils'
import { timeAgo } from '@/lib/format'

const THREAD_POLL_MS = 3000
const INBOX_POLL_MS = 10_000

// Signed-out entry point: chat is an account surface, the sign-in dialog is
// one tap away, and the view keeps its place in the hash so signing in
// returns the user here.
function SignedOutNotice() {
  const { setAuthOpen } = useAppStore()
  return (
    <div className="py-10">
      <EmptyState
        title="Messages live in your account"
        description="Sign in to chat with sellers and read buyer inquiries."
        action={
          <Button onClick={() => setAuthOpen(true)}>Sign in</Button>
        }
      />
    </div>
  )
}

function Avatar({ name, photoUrl, className }: { name: string; photoUrl: string | null; className?: string }) {
  if (photoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- shop-uploaded avatars, plain img like the rest of the feed
      <img src={photoUrl} alt="" className={cn('size-10 shrink-0 rounded-full object-cover', className)} />
    )
  }
  return (
    <span
      aria-hidden
      className={cn(
        'flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary',
        className,
      )}
    >
      {name.charAt(0).toUpperCase()}
    </span>
  )
}

// WhatsApp semantics: one tick = sent, two ticks = delivered, blue two ticks
// = read. Only outgoing messages carry ticks; incoming ones don't need them.
function Ticks({ message }: { message: ChatMessageT }) {
  if (!message.mine) return null
  if (message.readAt) return <CheckCheck className="size-3.5 text-sky-500" aria-label="Read" />
  if (message.deliveredAt) return <CheckCheck className="size-3.5" aria-label="Delivered" />
  return <Check className="size-3.5" aria-label="Sent" />
}

function InboxList({
  activeId,
  onSelect,
}: {
  activeId: string | null
  onSelect: (id: string) => void
}) {
  const inboxQuery = useQuery({
    queryKey: ['chat', 'inbox'],
    queryFn: () => apiGet<ChatInboxResponse>('/api/chat/conversations'),
    refetchInterval: INBOX_POLL_MS,
  })
  const conversations = inboxQuery.data?.conversations ?? []

  return (
    <section
      aria-label="Conversations"
      className={cn('rounded-lg border bg-card', activeId ? 'hidden lg:block' : 'block')}
    >
      <header className="border-b px-4 py-3">
        <h2 className="font-display text-[17px] font-bold text-primary">Chats</h2>
        <p className="text-xs text-muted-foreground">Buyer questions and seller replies</p>
      </header>
      {inboxQuery.isLoading ? (
        <div className="space-y-2 p-3" aria-hidden>
          {[0, 1, 2].map((row) => (
            <div key={row} className="h-14 animate-pulse rounded-md bg-muted" />
          ))}
        </div>
      ) : conversations.length === 0 ? (
        <p className="p-4 text-sm text-muted-foreground">
          No chats yet. Open any ad and tap <span className="font-medium">Message</span> to start one.
        </p>
      ) : (
        <ul>
          {conversations.map((conversation) => {
            const active = conversation.id === activeId
            return (
              <li key={conversation.id}>
                <button
                  type="button"
                  onClick={() => onSelect(conversation.id)}
                  aria-current={active ? 'true' : undefined}
                  className={cn(
                    'flex w-full items-start gap-3 border-b px-4 py-3 text-left transition-colors last:border-b-0 hover:bg-secondary/60',
                    active && 'bg-secondary',
                  )}
                >
                  <Avatar name={conversation.other.shopName} photoUrl={conversation.other.photoUrl} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-sm font-semibold">{conversation.other.shopName}</span>
                      <span className="shrink-0 text-[11px] text-muted-foreground">{timeAgo(conversation.lastMessageAt)}</span>
                    </span>
                    <span className="mt-0.5 flex items-center justify-between gap-2">
                      <span className="truncate text-xs text-muted-foreground">
                        {conversation.lastMessagePreview ?? 'No messages yet'}
                      </span>
                      {conversation.unreadCount > 0 ? (
                        <span className="flex min-w-5 shrink-0 items-center justify-center rounded-full bg-primary px-1.5 text-[10px] font-semibold text-primary-foreground">
                          {conversation.unreadCount > 9 ? '9+' : conversation.unreadCount}
                        </span>
                      ) : null}
                    </span>
                    <span className="mt-1 flex items-center gap-1.5">
                      <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                        {conversation.role === 'seller' ? 'Buyer inquiry' : 'You are the buyer'}
                      </span>
                      {conversation.listing ? (
                        <span className="truncate text-[10px] text-muted-foreground">re: {conversation.listing.title}</span>
                      ) : null}
                    </span>
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

function ChatThread({ conversationId, onBack }: { conversationId: string; onBack: () => void }) {
  const threadQuery = useQuery({
    queryKey: ['chat', 'thread', conversationId],
    queryFn: () => apiGet<ChatThreadResponse>(`/api/chat/conversations/${encodeURIComponent(conversationId)}`),
    refetchInterval: THREAD_POLL_MS,
  })
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const [draft, setDraft] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)
  const lastCountRef = useRef(0)

  const messages = threadQuery.data?.messages ?? []
  const conversation = threadQuery.data?.conversation

  // Stick to the bottom when messages arrive; on first load the count
  // changes too, which covers the initial scroll into the history.
  useEffect(() => {
    if (messages.length !== lastCountRef.current) {
      lastCountRef.current = messages.length
      bottomRef.current?.scrollIntoView({ block: 'end' })
    }
  }, [messages.length])

  const send = useMutation({
    mutationFn: (body: string) =>
      apiPost<ChatSendMessageResponse>(`/api/chat/conversations/${encodeURIComponent(conversationId)}/messages`, { body }),
    onSuccess: () => {
      setDraft('')
      void queryClient.invalidateQueries({ queryKey: ['chat', 'thread', conversationId] })
      void queryClient.invalidateQueries({ queryKey: ['chat', 'inbox'] })
    },
    onError: (error) => {
      toast({ title: error instanceof Error ? error.message : 'Message failed to send', variant: 'destructive' })
    },
  })

  function submit() {
    const body = draft.trim()
    if (!body || send.isPending) return
    send.mutate(body)
  }

  return (
    <section aria-label="Chat" className="flex h-[calc(100dvh-13rem)] min-h-80 flex-col overflow-hidden rounded-lg border bg-card max-lg:fixed max-lg:inset-x-0 max-lg:top-16 max-lg:z-30 max-lg:h-[calc(100dvh-8.5rem)] max-lg:rounded-none max-lg:border-x-0">
      <header className="flex items-center gap-3 border-b px-3 py-2.5">
        <button
          type="button"
          onClick={onBack}
          className="rounded-md p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground lg:hidden"
          aria-label="Back to all chats"
        >
          <ArrowLeft className="size-5" aria-hidden />
        </button>
        {conversation ? (
          <>
            <Avatar name={conversation.other.shopName} photoUrl={conversation.other.photoUrl} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold">{conversation.other.shopName}</span>
              {conversation.listing ? (
                <span className="block truncate text-xs text-muted-foreground">re: {conversation.listing.title}</span>
              ) : null}
            </span>
          </>
        ) : (
          <span className="text-sm text-muted-foreground">Loading chat…</span>
        )}
      </header>

      <div className="flex-1 space-y-2 overflow-y-auto px-3 py-3 scrollbar-slim" aria-live="polite">
        {threadQuery.isLoading ? (
          <p className="py-8 text-center text-sm text-muted-foreground" role="status">Loading messages…</p>
        ) : messages.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">No messages yet. Say hello.</p>
        ) : (
          messages.map((message) => (
            <div key={message.id} className={cn('flex', message.mine ? 'justify-end' : 'justify-start')}>
              <div
                className={cn(
                  'max-w-[85%] rounded-2xl px-3 py-2 text-[15px] leading-snug sm:max-w-[70%]',
                  message.mine
                    ? 'rounded-br-md bg-primary text-primary-foreground'
                    : 'rounded-bl-md bg-secondary text-secondary-foreground',
                )}
              >
                <p className="whitespace-pre-wrap break-words">{message.body}</p>
                <p className={cn('mt-1 flex items-center justify-end gap-1 text-[10px]', message.mine ? 'text-primary-foreground/70' : 'text-muted-foreground')}>
                  <time dateTime={message.sentAt}>{timeAgo(message.sentAt)}</time>
                  <Ticks message={message} />
                </p>
              </div>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>

      <form
        className="flex items-end gap-2 border-t p-3"
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
      >
        <Textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            // Enter sends, Shift+Enter breaks the line - the muscle memory
            // every chat app has trained. Mobile keyboards send Enter with
            // the form anyway, so the button remains the touch path.
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              submit()
            }
          }}
          rows={1}
          placeholder="Type a message…"
          aria-label="Message"
          className="max-h-32 min-h-11 flex-1 resize-none"
        />
        <Button type="submit" size="icon" className="size-11 shrink-0" disabled={!draft.trim() || send.isPending} aria-label="Send message">
          <Send className="size-4" aria-hidden />
        </Button>
      </form>
    </section>
  )
}

export function MessagesView({ conversationId }: { conversationId: string | null }) {
  const { user, isLoading: sessionLoading } = useSession()
  const { navigate } = useAppStore()

  if (sessionLoading) {
    return <div className="p-4 text-sm text-muted-foreground" role="status">Loading…</div>
  }
  if (!user) return <SignedOutNotice />

  return (
    <div className="mx-auto max-w-7xl px-4 py-4 sm:px-6 lg:px-8">
      <div className="grid gap-4 lg:grid-cols-[minmax(300px,360px)_1fr]">
        <InboxList activeId={conversationId} onSelect={(id) => navigate({ name: 'messages', id })} />
        {conversationId ? (
          <ChatThread conversationId={conversationId} onBack={() => navigate({ name: 'messages' })} />
        ) : (
          <section
            aria-label="No conversation selected"
            className="hidden items-center justify-center rounded-lg border bg-card p-10 text-sm text-muted-foreground lg:flex"
          >
            Select a chat, or open any ad and tap Message.
          </section>
        )}
      </div>
    </div>
  )
}
