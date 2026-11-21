// Mudaala - NFC / QR shop tags.
//
// A tag is a sticker that stores ONE thing: a Mudaala link to the seller's
// shop page (/s/MD-4821?t=<tagCode>). It never holds a payment number - money
// is only ever paid through the shop's own pay sheet, so a tampered tag can at
// worst open a link, and the tag's code can be rotated to retire it.
//
// Everything here is pure and client-safe (no db import). Database work lives
// in shop-tags-server.ts.

import { z } from 'zod'

export const MAX_TAGS_PER_SHOP = 10

// Unambiguous alphabet (no 0/1/i/l/o) so a code survives being read aloud.
const TAG_ALPHABET = '23456789abcdefghjkmnpqrstuvwxyz'
const TAG_CODE_LENGTH = 10
const TAG_CODE_PATTERN = /^[2-9a-hjkmnp-z]{10}$/

export type TagVia = 'nfc' | 'qr'

// Unguessable code from the platform CSPRNG. Rejection sampling avoids modulo
// bias: only bytes below the largest multiple of the alphabet size are used.
export function generateTagCode(): string {
  const limit = 256 - (256 % TAG_ALPHABET.length)
  let out = ''
  while (out.length < TAG_CODE_LENGTH) {
    const bytes = new Uint8Array(TAG_CODE_LENGTH * 2)
    crypto.getRandomValues(bytes)
    for (const byte of bytes) {
      if (byte < limit && out.length < TAG_CODE_LENGTH) out += TAG_ALPHABET[byte % TAG_ALPHABET.length]
    }
  }
  return out
}

// Null for anything that is not exactly a tag code - used on untrusted input
// (query strings, request bodies) before it goes anywhere near the database.
export function normalizeTagCode(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const code = raw.trim().toLowerCase()
  return TAG_CODE_PATTERN.test(code) ? code : null
}

// The link written onto the tag (nfc) or printed as the sticker's QR (qr).
// shopCode is validated upstream (MD-dddd); the origin is the canonical site.
export function buildTagUrl(origin: string, shopCode: string, tagCode: string, via: TagVia = 'nfc'): string {
  const base = `${origin.replace(/\/+$/, '')}/s/${shopCode}?t=${tagCode}`
  return via === 'qr' ? `${base}&v=qr` : base
}

export const tagLabelSchema = z.string().trim().min(2, 'Give the tag a short name').max(40, 'Keep the name under 40 characters')

export const createTagSchema = z.object({ label: tagLabelSchema })

export const updateTagSchema = z
  .object({
    label: tagLabelSchema.optional(),
    status: z.enum(['ACTIVE', 'DISABLED']).optional(),
    rotate: z.literal(true).optional(),
    locked: z.boolean().optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: 'Nothing to change' })

export const tagTapSchema = z.object({
  t: z.string().max(40),
  v: z.enum(['nfc', 'qr']).optional(),
})

// What the seller dashboard receives. The tag code travels only inside the two
// links; labels are private and never shown on a public page.
export interface OwnerTag {
  id: string
  label: string
  status: 'ACTIVE' | 'DISABLED'
  lockedAt: string | null
  createdAt: string
  taps30d: number
  qrScans30d: number
  nfcUrl: string
  qrUrl: string
}

export interface OwnerTagsResponse {
  tags: OwnerTag[]
  shopCode: string
  max: number
}
