// Authenticated upload signing. The Worker never receives image bytes: the browser
// uploads directly to a private Supabase quarantine bucket using a 90-second URL.
import { randomBytes } from 'node:crypto'
import { ApiError, route, jsonOk, requireUser } from '@/lib/api'
import { hit, UPLOAD_HOUR_MAX, UPLOAD_WINDOW_MS } from '@/lib/rate-limit'
import { getClientIp } from '@/lib/client-ip'
import { chooseStorage, LocalDiskStorage, S3Storage } from '@/lib/storage'

const MAX_BYTES = 8 * 1024 * 1024
const THUMBNAIL_MAX_BYTES = 250 * 1024
const MIME_TO_EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' } as const

type ImageMime = keyof typeof MIME_TO_EXT

export async function POST(request: Request) {
  return route(async () => {
    const user = await requireUser('Sign in to upload photos')
    const ip = getClientIp(request)
    const ipVerdict = await hit(`upload-sign:ip:${ip}`, UPLOAD_HOUR_MAX, UPLOAD_WINDOW_MS)
    const userVerdict = await hit(`upload-sign:user:${user.id}`, UPLOAD_HOUR_MAX, UPLOAD_WINDOW_MS)
    if (!ipVerdict.ok || !userVerdict.ok) {
      throw new ApiError(429, 'That is a lot of photos - please wait a while before uploading more')
    }

    const payload = await request.json().catch(() => null) as {
      file?: { type?: string; size?: number }
      thumbnail?: { type?: string; size?: number } | null
    } | null
    const fileType = payload?.file?.type
    const fileSize = payload?.file?.size
    if (!fileType || !Object.prototype.hasOwnProperty.call(MIME_TO_EXT, fileType) || !Number.isInteger(fileSize) || !fileSize || fileSize < 1) {
      throw new ApiError(400, 'Choose a JPEG, PNG or WebP photo')
    }
    if (fileSize > MAX_BYTES) throw new ApiError(413, 'That photo is too large - 8MB is the limit')

    const thumbnail = payload?.thumbnail ?? null
    if (thumbnail && (thumbnail.type !== 'image/webp' || !Number.isInteger(thumbnail.size) || !thumbnail.size || thumbnail.size < 1)) {
      throw new ApiError(400, 'The small photo preview must be WebP')
    }
    if (thumbnail && thumbnail.size! > THUMBNAIL_MAX_BYTES) {
      throw new ApiError(413, 'The small photo preview is too large - please choose the photo again')
    }

    const storage = chooseStorage()
    if (storage instanceof LocalDiskStorage) return jsonOk({ localUpload: true }, 200)
    if (!(storage instanceof S3Storage)) throw new ApiError(503, 'Secure photo storage is not configured. Please try again later.')

    const id = `${randomBytes(4).toString('hex')}-${randomBytes(8).toString('hex')}`
    const hasThumbnail = Boolean(thumbnail)
    const ext = MIME_TO_EXT[fileType as ImageMime]
    const originalKey = `pending/${user.id}/${id}${hasThumbnail ? '-t' : ''}.${ext}`
    const bucket = process.env.STORAGE_QUARANTINE_BUCKET?.trim() || 'mudaala-photo-quarantine'
    const originalUrl = await storage.createSignedObjectUrl(bucket, originalKey, 'PUT', 90)
    let thumbnailUpload: { key: string; url: string; contentType: 'image/webp' } | undefined
    if (thumbnail) {
      const thumbnailKey = `pending/${user.id}/${id}-t.thumb.webp`
      const url = await storage.createSignedObjectUrl(bucket, thumbnailKey, 'PUT', 90)
      thumbnailUpload = { key: thumbnailKey, url, contentType: 'image/webp' }
    }

    return jsonOk({
      uploadId: id,
      original: { key: originalKey, url: originalUrl, contentType: fileType },
      thumbnail: thumbnailUpload,
    }, 201)
  })
}
