import { randomBytes } from 'node:crypto'
import { Buffer } from 'node:buffer'
import { ApiError } from '@/lib/api'
import { moderateImageUrl } from '@/lib/image-moderation'
import { chooseStorage, S3Storage } from '@/lib/storage'
import { telegramApiUrl } from '@/lib/telegram-api'

const MAX_BYTES = 8 * 1024 * 1024

type TelegramFileResponse = {
  ok?: boolean
  result?: { file_path?: string; file_size?: number }
}

function stripJpegMetadata(input: Uint8Array): Uint8Array {
  if (input.length < 4 || input[0] !== 0xff || input[1] !== 0xd8) {
    throw new ApiError(400, 'Telegram did not provide a valid JPEG product photo. Please send it as a photo, not a document.')
  }
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
    if (offset + 2 > input.length) throw new ApiError(400, 'The product photo is incomplete. Please send it again.')
    const length = (input[offset] << 8) | input[offset + 1]
    const end = offset + length
    if (length < 2 || end > input.length) throw new ApiError(400, 'The product photo is incomplete. Please send it again.')
    // Strip EXIF, XMP, IPTC and comment segments before the photo becomes public.
    if (marker !== 0xe1 && marker !== 0xed && marker !== 0xfe) parts.push(input.slice(start, end))
    offset = end
  }
  const size = parts.reduce((sum, part) => sum + part.length, 0)
  const output = new Uint8Array(size)
  let cursor = 0
  for (const part of parts) { output.set(part, cursor); cursor += part.length }
  return output
}

async function readLimited(response: Response, maxBytes: number): Promise<Buffer> {
  if (!response.body) throw new ApiError(502, 'Telegram could not provide that product photo. Please send it again.')
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined)
        throw new ApiError(413, 'That product photo is too large. Telegram photos must be 8MB or smaller.')
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), total)
}

/** Downloads a Telegram photo, strips JPEG metadata, moderates it privately, then promotes it. */
export async function importTelegramProductPhoto(fileId: string, sellerId: string): Promise<string> {
  if (!/^[A-Za-z0-9_-]{10,256}$/.test(fileId)) throw new ApiError(400, 'That Telegram photo reference is invalid.')
  const token = process.env.TELEGRAM_BOT_TOKEN
  if (!token) throw new ApiError(503, 'Telegram photo uploads are not configured right now.')

  const metadataResponse = await fetch(telegramApiUrl(token, 'getFile'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ file_id: fileId }),
    signal: AbortSignal.timeout(8000),
  })
  if (!metadataResponse.ok) throw new ApiError(502, 'Telegram could not prepare that photo. Please send it again.')
  const metadata = await metadataResponse.json() as TelegramFileResponse
  const filePath = metadata.result?.file_path
  const fileSize = metadata.result?.file_size
  if (!metadata.ok || typeof filePath !== 'string' || !filePath || filePath.startsWith('/') || filePath.split('/').includes('..')) {
    throw new ApiError(502, 'Telegram could not locate that photo. Please send it again.')
  }
  if (typeof fileSize === 'number' && (!Number.isSafeInteger(fileSize) || fileSize < 1 || fileSize > MAX_BYTES)) {
    throw new ApiError(413, 'That product photo is too large. Telegram photos must be 8MB or smaller.')
  }

  const fileUrl = 'https://api.telegram.org/file/bot' + token + '/' + filePath
  const photoResponse = await fetch(fileUrl, { signal: AbortSignal.timeout(15000) })
  if (!photoResponse.ok) throw new ApiError(502, 'Telegram could not download that photo. Please send it again.')
  const raw = await readLimited(photoResponse, MAX_BYTES)
  const clean = stripJpegMetadata(raw)
  if (clean.length < 4) throw new ApiError(400, 'That product photo is empty or invalid.')

  const storage = chooseStorage()
  if (!(storage instanceof S3Storage)) throw new ApiError(503, 'Secure product photo storage is not configured.')

  const id = randomBytes(16).toString('hex')
  const key = `pending/${sellerId}/telegram-${id}.jpg`
  const publicKey = `photos/telegram-${id}.jpg`
  try {
    await storage.putQuarantine(key, clean, 'image/jpeg')
    const tokenForProxy = storage.createModerationProxyToken(key, 90)
    const proxyUrl = 'https://mudaala.store/api/moderation-image/' + encodeURIComponent(tokenForProxy)
    const moderation = await moderateImageUrl(proxyUrl)
    if (moderation.status === 'blocked') throw new ApiError(400, 'This photo is not allowed on Mudaala. Please send a different product photo.')
    if (moderation.status !== 'safe') {
      console.error('[telegram-photo] moderation unavailable', {
        status: moderation.status,
        providerStatus: moderation.status === 'unavailable' ? moderation.providerStatus : undefined,
      })
      throw new ApiError(503, 'Photo safety checks are temporarily unavailable. Please try again later.')
    }
    return await storage.promoteQuarantineObject(key, publicKey, 'image/jpeg')
  } catch (error) {
    await storage.discardQuarantineObject(key).catch(() => undefined)
    if (error instanceof ApiError) throw error
    console.error('[telegram-photo] import failed', error instanceof Error ? error.name : 'unknown')
    throw new ApiError(502, 'The product photo could not be saved. Please send it again.')
  }
}
