// Photo upload - the ONLY way images enter Mudaala.
// requireUser: uploads are a seller action, buyers never need this.
// Trust is decided by magic bytes, never by the filename a client claims -
// "evil.png" that is really text (or worse) is rejected before it is decoded.
// Accepted JPEG, PNG and WebP uploads are validated by magic bytes before
// being stored. Cloudflare Workers does not run sharp's native binaries, so
// this route preserves the supported original format instead of re-encoding.
// Storage sits behind an interface (src/lib/storage.ts): development writes
// to the local disk (public/uploads, served statically by Next), production
// writes to any S3-compatible bucket (Cloudflare R2, Supabase Storage) using
// the STORAGE_* environment variables. The route itself never knows which.

import { ApiError, route, jsonOk, requireUser } from '@/lib/api'
import { hit, UPLOAD_HOUR_MAX, UPLOAD_WINDOW_MS } from '@/lib/rate-limit'
import { getClientIp } from '@/lib/client-ip'
import { chooseStorage } from '@/lib/storage'

const MAX_BYTES = 8 * 1024 * 1024 // 8MB upload limit

// Read the first bytes and say what the file REALLY is, if anything we accept.
function sniffImage(b: Uint8Array): 'jpg' | 'png' | 'webp' | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg'
  if (
    b.length >= 8 &&
    b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
    b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a
  ) return 'png'
  if (
    b.length >= 12 &&
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && // "RIFF"
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50 // "WEBP"
  ) return 'webp'
  return null
}

export async function POST(request: Request) {
  return route(async () => {
    const user = await requireUser('Sign in to upload photos')

    // 30 photos per user per hour: a whole catalogue shoot in a sitting is
    // fine; bulk-filling the disk is not. The IP bucket rides beside it so
    // one machine juggling accounts cannot multiply the budget.
    const ip = getClientIp(request)
    const ipVerdict = await hit(`upload:ip:${ip}`, UPLOAD_HOUR_MAX, UPLOAD_WINDOW_MS)
    if (!ipVerdict.ok) {
      throw new ApiError(429, 'That is a lot of photos - please wait a while before uploading more')
    }
    const verdict = await hit(`upload:user:${user.id}`, UPLOAD_HOUR_MAX, UPLOAD_WINDOW_MS)
    if (!verdict.ok) {
      throw new ApiError(429, 'That is a lot of photos - please wait a while before uploading more')
    }

    const form = await request.formData().catch(() => null)
    const file = form?.get('file')
    if (!(file instanceof File) || file.size === 0) {
      throw new ApiError(400, 'Choose a photo to upload')
    }
    if (file.size > MAX_BYTES) {
      throw new ApiError(413, 'That photo is too large - 8MB is the limit')
    }

    // Magic bytes, not the filename, decide acceptance.
    const head = new Uint8Array(await file.slice(0, 12).arrayBuffer())
    const detectedType = sniffImage(head)
    if (!detectedType) {
      throw new ApiError(400, 'That file is not a JPEG, PNG or WebP image')
    }

    // Cloudflare Workers cannot run sharp's native binaries, and canvas
    // image APIs are not part of the documented Workers runtime. Keep the
    // upload compatible by storing the validated original raster image.
    // The storage layer derives Content-Type from the detected magic bytes.
    const input = Buffer.from(await file.arrayBuffer())
    let url: string
    try {
      url = await chooseStorage().save(input, detectedType)
    } catch (err) {
      console.error('[upload] storage write failed:', err)
      throw new ApiError(502, 'The photo could not be stored right now. Please try again')
    }

    return jsonOk({ url }, 201)
  })
}
