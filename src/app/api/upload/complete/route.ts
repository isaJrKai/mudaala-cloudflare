// Finalize an uploaded photo only after checking ownership, stored metadata and moderation.
import { ApiError, route, jsonOk, requireUser } from '@/lib/api'
import { moderateImageUrl } from '@/lib/image-moderation'
import { chooseStorage, S3Storage } from '@/lib/storage'
import { hit, UPLOAD_HOUR_MAX, UPLOAD_WINDOW_MS } from '@/lib/rate-limit'
import { getClientIp } from '@/lib/client-ip'

const MAX_BYTES = 8 * 1024 * 1024
const THUMBNAIL_MAX_BYTES = 250 * 1024
const EXT_TO_MIME = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' } as const

function validImageHeader(bytes: Uint8Array, extension: keyof typeof EXT_TO_MIME): boolean {
  if (extension === 'jpg') return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
  if (extension === 'png') return bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  return bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
}

export async function POST(request: Request) {
  return route(async () => {
    const user = await requireUser('Sign in to finish uploading photos')
    const ip = getClientIp(request)
    const ipVerdict = await hit(`upload-complete:ip:${ip}`, UPLOAD_HOUR_MAX, UPLOAD_WINDOW_MS)
    const userVerdict = await hit(`upload-complete:user:${user.id}`, UPLOAD_HOUR_MAX, UPLOAD_WINDOW_MS)
    if (!ipVerdict.ok || !userVerdict.ok) throw new ApiError(429, 'That is a lot of photos - please wait a while before uploading more')
    const payload = await request.json().catch(() => null) as { key?: string } | null
    const key = payload?.key
    const prefix = `pending/${user.id}/`
    if (typeof key !== 'string' || !key.startsWith(prefix)) {
      throw new ApiError(400, 'This photo upload is not valid for your account')
    }
    const match = /^([a-f0-9]{8}-[a-f0-9]{16})(-t)?\.(jpg|png|webp)$/.exec(key.slice(prefix.length))
    if (!match) throw new ApiError(400, 'This photo upload has an invalid file name')

    const storage = chooseStorage()
    if (!(storage instanceof S3Storage)) {
      throw new ApiError(503, 'Secure photo storage is not configured. Please try again later.')
    }

    const id = match[1]!
    const hasThumbnail = Boolean(match[2])
    const extension = match[3] as keyof typeof EXT_TO_MIME
    const expectedMime = EXT_TO_MIME[extension]
    const thumbnailKey = hasThumbnail ? `${prefix}${id}-t.thumb.webp` : null
    const quarantineBucket = process.env.STORAGE_QUARANTINE_BUCKET?.trim() || 'mudaala-photo-quarantine'

    let originalMeta: { size: number; contentType: string; header: Uint8Array }
    let thumbnailMeta: { size: number; contentType: string; header: Uint8Array } | null = null
    try {
      originalMeta = await storage.inspectQuarantineObject(key)
      if (thumbnailKey) thumbnailMeta = await storage.inspectQuarantineObject(thumbnailKey)
    } catch {
      throw new ApiError(400, 'The photo upload is incomplete or has expired. Please choose it again.')
    }

    if (originalMeta.size < 1 || originalMeta.size > MAX_BYTES || originalMeta.contentType !== expectedMime || !validImageHeader(originalMeta.header, extension)) {
      await storage.discardQuarantineObject(key).catch(() => undefined)
      if (thumbnailKey) await storage.discardQuarantineObject(thumbnailKey).catch(() => undefined)
      throw new ApiError(400, 'The uploaded photo did not pass file checks. Please choose it again.')
    }
    if (thumbnailMeta && (thumbnailMeta.size < 1 || thumbnailMeta.size > THUMBNAIL_MAX_BYTES || thumbnailMeta.contentType !== 'image/webp' || !validImageHeader(thumbnailMeta.header, 'webp'))) {
      await storage.discardQuarantineObject(key).catch(() => undefined)
      if (thumbnailKey) await storage.discardQuarantineObject(thumbnailKey).catch(() => undefined)
      throw new ApiError(400, 'The photo preview did not pass file checks. Please choose the photo again.')
    }

    // Moderation receives a 60-second read URL for a private object. No image
    // bytes are base64-encoded or processed inside the Worker.
    const originalReadUrl = await storage.createSignedObjectUrl(quarantineBucket, key, 'GET', 60)
    const moderation = await moderateImageUrl(originalReadUrl)
    if (moderation.status === 'blocked') {
      await storage.discardQuarantineObject(key).catch(() => undefined)
      if (thumbnailKey) await storage.discardQuarantineObject(thumbnailKey).catch(() => undefined)
      throw new ApiError(400, 'This photo is not allowed on Mudaala. Please choose another photo.')
    }
    if (moderation.status !== 'safe') {
      await storage.discardQuarantineObject(key).catch(() => undefined)
      if (thumbnailKey) await storage.discardQuarantineObject(thumbnailKey).catch(() => undefined)
      console.error('[upload] image moderation unavailable', {
        status: moderation.status,
        providerStatus: moderation.status === 'unavailable' ? moderation.providerStatus : undefined,
      })
      throw new ApiError(503, 'Photo safety checks are temporarily unavailable. Please try again later.')
    }

    if (thumbnailKey) {
      const thumbnailReadUrl = await storage.createSignedObjectUrl(quarantineBucket, thumbnailKey, 'GET', 60)
      const thumbnailModeration = await moderateImageUrl(thumbnailReadUrl)
      if (thumbnailModeration.status !== 'safe') {
        await storage.discardQuarantineObject(key).catch(() => undefined)
        await storage.discardQuarantineObject(thumbnailKey).catch(() => undefined)
        if (thumbnailModeration.status === 'blocked') {
          throw new ApiError(400, 'The photo preview is not allowed on Mudaala. Please choose the photo again.')
        }
        console.error('[upload] thumbnail moderation unavailable', {
          status: thumbnailModeration.status,
          providerStatus: thumbnailModeration.status === 'unavailable' ? thumbnailModeration.providerStatus : undefined,
        })
        throw new ApiError(503, 'Photo safety checks are temporarily unavailable. Please try again later.')
      }
    }

    const publicKey = `photos/${id}${hasThumbnail ? '-t' : ''}.${extension}`
    let url: string
    try {
      url = await storage.promoteQuarantineObject(key, publicKey, expectedMime)
    } catch (error) {
      console.error('[upload] approved photo could not be published:', error instanceof Error ? error.name : 'unknown')
      throw new ApiError(502, 'The photo could not be stored right now. Please try again.')
    }

    if (thumbnailKey) {
      try {
        await storage.promoteQuarantineObject(thumbnailKey, `photos/${id}-t.thumb.webp`, 'image/webp')
      } catch (error) {
        // The original remains valid; listing cards fall back to the full image.
        await storage.discardQuarantineObject(thumbnailKey).catch(() => undefined)
        console.error('[upload] thumbnail promotion failed:', error instanceof Error ? error.name : 'unknown')
      }
    }

    return jsonOk({ url }, 201)
  })
}
