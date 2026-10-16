'use client'

import { useState } from 'react'
import { Loader2, Video, X } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'
import { apiFetch } from '@/lib/client'
import { cn } from '@/lib/utils'

const MAX_VIDEO_BYTES = 20 * 1024 * 1024

/** One optional, original MP4/WebM demo. Playback is always user initiated. */
export function VideoPicker({ id, value, onChange }: { id: string; value: string | null; onChange: (url: string | null) => void }) {
  const { toast } = useToast()
  const [busy, setBusy] = useState(false)

  async function upload(file: File | undefined) {
    if (!file) return
    if (file.size > MAX_VIDEO_BYTES) {
      toast({ title: 'Video is too large', description: 'Choose an MP4 or WebM video under 20 MB.', variant: 'destructive' })
      return
    }
    if (file.type && !['video/mp4', 'video/webm'].includes(file.type)) {
      toast({ title: 'Unsupported video', description: 'Choose an MP4 or WebM video.', variant: 'destructive' })
      return
    }

    setBusy(true)
    try {
      const body = new FormData()
      body.append('file', file)
      body.append('kind', 'video')
      const result = await apiFetch<{ url: string; kind: 'video' }>('/api/upload', { method: 'POST', body })
      if (result.kind !== 'video' || !result.url) throw new Error('The server did not confirm the video upload.')
      onChange(result.url)
    } catch (err) {
      toast({
        title: 'Video could not be uploaded',
        description: err instanceof Error ? err.message : 'Choose an MP4 or WebM video under 20 MB.',
        variant: 'destructive',
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-2">
      {value ? (
        <div className="overflow-hidden rounded-lg border bg-secondary/20">
          <video
            src={value}
            controls
            playsInline
            preload="metadata"
            controlsList="nodownload noplaybackrate"
            className="max-h-72 w-full bg-black"
            aria-label="Listing demo video"
          />
          <div className="flex items-center justify-between gap-3 p-2">
            <p className="text-xs text-muted-foreground">Video attached. Playback starts only when a buyer presses play.</p>
            <button type="button" onClick={() => onChange(null)} className="inline-flex shrink-0 items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-accent">
              <X className="size-3.5" aria-hidden /> Remove
            </button>
          </div>
        </div>
      ) : (
        <label
          htmlFor={id}
          className={cn(
            'flex min-h-20 cursor-pointer items-center gap-3 rounded-lg border border-dashed bg-secondary/20 p-3 transition-colors hover:bg-accent',
            busy && 'pointer-events-none opacity-60',
          )}
        >
          <span className="flex size-10 shrink-0 items-center justify-center rounded-md border bg-card">
            {busy ? <Loader2 className="size-5 animate-spin" aria-hidden /> : <Video className="size-5" aria-hidden />}
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-medium">{busy ? 'Uploading video…' : 'Add a short demo video'}</span>
            <span className="mt-0.5 block text-xs text-muted-foreground">Optional · MP4 or WebM · up to 20 MB · one video per ad</span>
          </span>
        </label>
      )}
      <input
        id={id}
        type="file"
        accept="video/mp4,video/webm"
        className="sr-only"
        disabled={busy || Boolean(value)}
        onChange={(event) => {
          void upload(event.currentTarget.files?.[0])
          event.currentTarget.value = ''
        }}
      />
    </div>
  )
}
