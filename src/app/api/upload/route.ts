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

const MAX_PHOTO_BYTES = 8 * 1024 * 1024 // 8 MB
const MAX_VIDEO_BYTES = 20 * 1024 * 1024 // 20 MB; original files only, no Worker transcoding

// Read the first bytes and say what the file REALLY is, if anything we accept.
function sniffVideo(b: Uint8Array): { extension: 'mp4' | 'webm'; contentType: 'video/mp4' | 'video/webm' } | null {
  // ISO Base Media File Format: the first box is ftyp for normal MP4 uploads.
  if (b.length >= 12 && String.fromCharCode(...b.slice(4, 8)) === 'ftyp') {
    return { extension: 'mp4', contentType: 'video/mp4' }
  }
  // Matroska/WebM EBML header.
  if (b.length >= 4 && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) {
    return { extension: 'webm', contentType: 'video/webm' }
  }
  return null
}

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

// Strip embedded metadata without decoding/re-encoding the image. This keeps
// the upload route compatible with Workers while preventing EXIF GPS and common
// text/XMP metadata from becoming public alongside the photo.
function stripImageMetadata(input: Uint8Array, type: 'jpg' | 'png' | 'webp'): Uint8Array {
  if (type === 'jpg') {
    if (input.length < 4 || input[0] !== 0xff || input[1] !== 0xd8) return input
    const parts: Uint8Array[] = [input.slice(0, 2)]
    let offset = 2
    while (offset < input.length && input[offset] === 0xff) {
      const start = offset
      while (offset < input.length && input[offset] === 0xff) offset++
      if (offset >= input.length) break
      const marker = input[offset++]
      if (marker === 0xda) { parts.push(input.slice(start)); break }
      if (marker === 0xd9 || marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        parts.push(input.slice(start, offset))
        continue
      }
      if (offset + 2 > input.length) { parts.push(input.slice(start)); break }
      const length = (input[offset] << 8) | input[offset + 1]
      const end = offset + length
      if (length < 2 || end > input.length) { parts.push(input.slice(start)); break }
      // APP1 (EXIF/XMP), APP13 (Photoshop/IPTC) and COM can contain location
      // or identifying metadata. The compressed image data remains untouched.
      if (marker !== 0xe1 && marker !== 0xed && marker !== 0xfe) parts.push(input.slice(start, end))
      offset = end
    }
    return concatBytes(parts)
  }

  if (type === 'png') {
    const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
    if (input.length < 8 || !signature.every((v, i) => input[i] === v)) return input
    const parts: Uint8Array[] = [input.slice(0, 8)]
    let offset = 8
    while (offset + 12 <= input.length) {
      const length = (input[offset] * 0x1000000) + (input[offset + 1] << 16) + (input[offset + 2] << 8) + input[offset + 3]
      const end = offset + 12 + length
      if (end > input.length) { parts.push(input.slice(offset)); break }
      const typeName = String.fromCharCode(...input.slice(offset + 4, offset + 8))
      if (!['eXIf', 'tEXt', 'zTXt', 'iTXt', 'tIME'].includes(typeName)) parts.push(input.slice(offset, end))
      offset = end
      if (typeName === 'IEND') {
        if (offset < input.length) parts.push(input.slice(offset))
        break
      }
    }
    return concatBytes(parts)
  }

  if (input.length < 12 || String.fromCharCode(...input.slice(0, 4)) !== 'RIFF' || String.fromCharCode(...input.slice(8, 12)) !== 'WEBP') return input
  const parts: Uint8Array[] = []
  let offset = 12
  while (offset + 8 <= input.length) {
    const name = String.fromCharCode(...input.slice(offset, offset + 4))
    const size = input[offset + 4] | (input[offset + 5] << 8) | (input[offset + 6] << 16) | (input[offset + 7] << 24)
    const end = offset + 8 + size + (size % 2)
    if (size < 0 || end > input.length) { parts.push(input.slice(offset)); break }
    if (name !== 'EXIF' && name !== 'XMP ') {
      const chunk = input.slice(offset, end)
      // VP8X feature flags: clear EXIF and XMP presence bits when those chunks
      // are removed, preserving a valid extended WebP container.
      if (name === 'VP8X' && size >= 1) chunk[8] = chunk[8] & ~0x0c
      parts.push(chunk)
    }
    offset = end
  }
  const output = concatBytes([
    new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]),
    ...parts,
  ])
  new DataView(output.buffer, output.byteOffset, output.byteLength).setUint32(4, output.length - 8, true)
  return output
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0)
  const output = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    output.set(part, offset)
    offset += part.length
  }
  return output
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
    const rawKind = form?.get('kind')
    const kind = rawKind === 'video' ? 'video' : 'photo'
    if (rawKind !== null && rawKind !== 'photo' && rawKind !== 'video') {
      throw new ApiError(400, 'Choose photo or video media')
    }
    if (!(file instanceof File) || file.size === 0) {
      throw new ApiError(400, kind === 'video' ? 'Choose a video to upload' : 'Choose a photo to upload')
    }

    const maxBytes = kind === 'video' ? MAX_VIDEO_BYTES : MAX_PHOTO_BYTES
    if (file.size > maxBytes) {
      throw new ApiError(413, kind === 'video' ? 'That video is too large - 20 MB is the limit' : 'That photo is too large - 8 MB is the limit')
    }

    // Inspect file signatures instead of trusting the browser MIME type or name.
    const head = new Uint8Array(await file.slice(0, 12).arrayBuffer())
    const original = new Uint8Array(await file.arrayBuffer())
    let input: Buffer
    let extension: string
    let contentType: string
    let prefix: 'photos' | 'videos'

    if (kind === 'video') {
      const video = sniffVideo(head)
      if (!video) {
        throw new ApiError(400, 'That file is not a supported MP4 or WebM video')
      }
      // No transcoding in the Worker: store a validated original video so
      // upload processing stays bounded and image uploads remain unchanged.
      input = Buffer.from(original)
      extension = video.extension
      contentType = video.contentType
      prefix = 'videos'
    } else {
      const detectedType = sniffImage(head)
      if (!detectedType) {
        throw new ApiError(400, 'That file is not a JPEG, PNG or WebP image')
      }
      // Keep the existing photo pipeline: strip metadata, preserve original
      // raster bytes, and store under the photos prefix.
      input = Buffer.from(stripImageMetadata(original, detectedType))
      extension = detectedType
      contentType = detectedType === 'jpg' ? 'image/jpeg' : detectedType === 'png' ? 'image/png' : 'image/webp'
      prefix = 'photos'
    }

    let url: string
    try {
      url = await chooseStorage().save(input, extension, { contentType, prefix })
    } catch (err) {
      console.error('[upload] media storage write failed:', err)
      throw new ApiError(502, kind === 'video' ? 'The video could not be stored right now. Please try again' : 'The photo could not be stored right now. Please try again')
    }

    return jsonOk({ url, kind }, 201)
  })
}
