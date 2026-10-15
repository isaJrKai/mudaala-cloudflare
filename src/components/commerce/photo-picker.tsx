'use client'

// Photo picker - built for market vendors on low-end phones:
//   • "Take photo" opens the camera directly (capture="environment") - for a
//     trader standing in front of their stock, the camera IS the flow.
//   • "Choose photo" opens the gallery for already-taken pictures.
//   • Each selected file uploads immediately; thumbnails show honest progress
//     and failures (never a fake success).
// Used for listing photos (up to 4) and the shop photo (1).

import { useId, useState } from 'react'
import { Camera, ImagePlus, Loader2, X } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'
import { apiFetch } from '@/lib/client'
import { cn } from '@/lib/utils'

// Normalize photos in the browser before upload. This works on mobile browsers
// without native image libraries in Cloudflare Workers, strips EXIF/GPS metadata,
// and keeps downloads manageable for customers on slow connections.
async function preparePhoto(file: File): Promise<File> {
  if (!file.type.startsWith('image/')) {
    throw new Error('Choose an image from your gallery.')
  }

  // Prefer ImageBitmap where available, but retain an HTMLImageElement path
  // for older/mobile Safari browsers that do not implement createImageBitmap.
  let width = 0
  let height = 0
  let drawSource: CanvasImageSource
  let bitmap: ImageBitmap | null = null
  let objectUrl: string | null = null

  try {
    if (typeof createImageBitmap === 'function') {
      try {
        bitmap = await createImageBitmap(file)
        width = bitmap.width
        height = bitmap.height
        drawSource = bitmap
      } catch {
        // Some browser/image combinations reject ImageBitmap but can still
        // decode the same file through a regular image element.
        objectUrl = URL.createObjectURL(file)
        const image = await loadImage(objectUrl)
        width = image.naturalWidth
        height = image.naturalHeight
        drawSource = image
      }
    } else {
      objectUrl = URL.createObjectURL(file)
      const image = await loadImage(objectUrl)
      width = image.naturalWidth
      height = image.naturalHeight
      drawSource = image
    }

    if (!width || !height) {
      throw new Error('This photo could not be opened. Choose a JPG, PNG or WebP image.')
    }

    const scale = Math.min(1, 1200 / Math.max(width, height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(width * scale))
    canvas.height = Math.max(1, Math.round(height * scale))
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Could not prepare this photo. Please try again.')
    context.drawImage(drawSource, 0, 0, canvas.width, canvas.height)

    // WebP is smaller, but not every browser/canvas implementation supports
    // encoding it. Fall back to JPEG rather than blocking the entire upload.
    const blob = await canvasToBlob(canvas, 'image/webp', 0.84)
      .then((result) => result.type === 'image/webp' ? result : null)
      .catch(() => null)
      ?? await canvasToBlob(canvas, 'image/jpeg', 0.86)

    const stem = file.name.replace(/\.[^.]+$/, '') || 'photo'
    const isJpeg = blob.type === 'image/jpeg'
    const extension = isJpeg ? 'jpg' : 'webp'
    return new File([blob], `${stem}.${extension}`, {
      type: isJpeg ? 'image/jpeg' : 'image/webp',
      lastModified: Date.now(),
    })
  } finally {
    bitmap?.close()
    if (objectUrl) URL.revokeObjectURL(objectUrl)
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('This photo could not be opened. Choose a JPG, PNG or WebP image.'))
    image.src = src
  })
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob)
      else reject(new Error('Could not prepare this photo. Please try again.'))
    }, type, quality)
  })
}
interface PhotoPickerProps {
  value: string[]
  onChange: (photos: string[]) => void
  max?: number
  /** Single-photo mode (shop avatar or cover) stores one URL. */
  single?: boolean
  /** Wide preview and replace controls for a shop cover image. */
  cover?: boolean
  label?: string
}

export function PhotoPicker({ value, onChange, max = 4, single = false, cover = false, label }: PhotoPickerProps) {
  const { toast } = useToast()
  const [busy, setBusy] = useState(false)
  const inputId = useId().replace(/:/g, '')
  const cameraId = `${inputId}-camera`
  const galleryId = `${inputId}-gallery`

  const full = value.length >= max

  async function upload(files: FileList | null) {
    const file = files?.[0]
    if (!file) return
    setBusy(true)
    try {
      const prepared = await preparePhoto(file)
      const body = new FormData()
      body.append('file', prepared)
      const res = await apiFetch<{ url: string }>('/api/upload', { method: 'POST', body })
      onChange(single ? [res.url] : [...value, res.url].slice(0, max))
    } catch (err) {
      toast({
        title: 'Photo could not be uploaded',
        description: err instanceof Error ? err.message : 'Choose a JPG, PNG or WebP photo under 8 MB.',
        variant: 'destructive',
      })
    } finally {
      setBusy(false)
    }
  }

  function remove(url: string) {
    onChange(value.filter((v) => v !== url))
  }

  return (
    <div>
      <input
        id={cameraId}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        onChange={(e) => {
          upload(e.target.files)
          e.currentTarget.value = ''
        }}
      />
      <input
        id={galleryId}
        type="file"
        accept="image/*"
        className="sr-only"
        onChange={(e) => {
          upload(e.target.files)
          // Allow the same gallery photo to be selected again after a failed
          // upload or after replacing the current image.
          e.currentTarget.value = ''
        }}
      />

      {single && cover ? (
        <div className="space-y-2">
          {value[0] ? (
            <div className="relative overflow-hidden rounded-md border bg-secondary/30">
              <img src={value[0]} alt="Shop cover preview" className="h-28 w-full object-cover sm:h-36" />
              <button
                type="button"
                onClick={() => onChange([])}
                className="absolute right-2 top-2 flex size-7 items-center justify-center rounded-full border bg-card/95 text-muted-foreground hover:text-destructive"
                aria-label="Remove shop cover photo"
              >
                <X className="size-3.5" aria-hidden />
              </button>
            </div>
          ) : (
            <div className="flex h-28 items-center justify-center rounded-md border border-dashed bg-secondary/30 px-3 text-center text-xs text-muted-foreground sm:h-36">
              No cover photo yet
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <label htmlFor={cameraId} className={cn('inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-3 py-2 text-xs font-medium hover:bg-accent', busy && 'pointer-events-none opacity-60')}>
              {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Camera className="size-4" aria-hidden />}
              {busy ? 'Uploading…' : 'Take photo'}
            </label>
            <label htmlFor={galleryId} className={cn('inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-3 py-2 text-xs font-medium hover:bg-accent', busy && 'pointer-events-none opacity-60')}>
              <ImagePlus className="size-4" aria-hidden /> Choose photo
            </label>
          </div>
          <p className="text-xs text-muted-foreground">Use a wide landscape photo. JPG, PNG or WebP; up to 8 MB.</p>
        </div>
      ) : single ? (
        <div className="flex items-center gap-3">
          {value[0] ? (
            <div className="relative shrink-0">
              <img
                src={value[0]}
                alt="Shop photo"
                className="size-16 rounded-full border object-cover"
              />
              <button
                type="button"
                onClick={() => onChange([])}
                className="absolute -right-1 -top-1 flex size-5 items-center justify-center rounded-full border bg-card text-muted-foreground hover:text-destructive"
                aria-label="Remove shop photo"
              >
                <X className="size-3" aria-hidden />
              </button>
            </div>
          ) : (
            <div className="flex size-16 shrink-0 items-center justify-center rounded-full border border-dashed bg-secondary/40 text-muted-foreground">
              {busy ? <Loader2 className="size-5 animate-spin" aria-hidden /> : <ImagePlus className="size-5" aria-hidden />}
            </div>
          )}
          <div className="min-w-0 space-y-2">
            <p className="text-sm text-muted-foreground">
              {value[0] ? 'Looking good. Buyers see this next to your name.' : 'Add a real photo of your shop to build trust.'}
            </p>
            <div className="flex flex-wrap gap-2">
              <label
                htmlFor={cameraId}
                className={cn('inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-3 py-2 text-xs font-medium hover:bg-accent', busy && 'pointer-events-none opacity-60')}
              >
                <Camera className="size-4" aria-hidden /> Take photo
              </label>
              <label
                htmlFor={galleryId}
                className={cn('inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-3 py-2 text-xs font-medium hover:bg-accent', busy && 'pointer-events-none opacity-60')}
              >
                <ImagePlus className="size-4" aria-hidden /> {value[0] ? 'Change photo' : 'Choose from gallery'}
              </label>
            </div>
            <p className="text-xs text-muted-foreground">JPG, PNG or WebP; up to 8 MB.</p>
          </div>
        </div>
      ) : (
        <div>
          <div className="flex flex-wrap gap-2">
            {value.map((url) => (
              <div key={url} className="group relative size-20 overflow-hidden rounded-md border bg-secondary/30">
                <img src={url} alt="Listing photo" className="size-full object-cover" />
                <button
                  type="button"
                  onClick={() => remove(url)}
                  className="absolute right-1 top-1 flex size-5 items-center justify-center rounded-full border bg-card/95 text-muted-foreground hover:text-destructive"
                  aria-label="Remove photo"
                >
                  <X className="size-3" aria-hidden />
                </button>
              </div>
            ))}

            {!full || value.length === 0 ? (
              <label
                htmlFor={cameraId}
                className={cn(
                  'flex h-20 w-20 flex-col items-center justify-center gap-1 rounded-md border border-dashed bg-secondary/30 text-muted-foreground transition-colors hover:bg-accent',
                  busy && 'pointer-events-none opacity-60',
                )}
                aria-label="Take a photo"
              >
                {busy ? <Loader2 className="size-5 animate-spin" aria-hidden /> : <Camera className="size-5" aria-hidden />}
                <span className="text-[11px] font-medium">{busy ? 'Uploading…' : 'Take photo'}</span>
              </label>
            ) : null}

            {!full ? (
              <label
                htmlFor={galleryId}
                className={cn(
                  'flex h-20 w-20 flex-col items-center justify-center gap-1 rounded-md border border-dashed bg-secondary/30 text-muted-foreground transition-colors hover:bg-accent',
                  busy && 'pointer-events-none opacity-60',
                )}
                aria-label="Choose from gallery"
              >
                <ImagePlus className="size-5" aria-hidden />
                <span className="text-[11px] font-medium">Gallery</span>
              </label>
            ) : null}
          </div>
          <p className="mt-1.5 text-xs text-muted-foreground">
            {label ?? `Up to ${max} photos. Real photos get more calls.`}
            {value.length > 0 ? ` (${value.length}/${max})` : ''}
          </p>
        </div>
      )}
    </div>
  )
}
