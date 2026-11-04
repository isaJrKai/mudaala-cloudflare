import { createHmac, timingSafeEqual } from 'node:crypto'

const MESSAGE_ID_PATTERN = /^[A-Za-z0-9._:-]{1,256}$/

export class WebhookPayloadTooLargeError extends Error {
  constructor() {
    super('Webhook payload is too large')
    this.name = 'WebhookPayloadTooLargeError'
  }
}

/**
 * Read at most maxBytes from a request stream. Unlike arrayBuffer(), this
 * stops buffering as soon as the limit is crossed and cancels the reader.
 */
export async function readBoundedBody(
  body: ReadableStream<Uint8Array> | null,
  maxBytes: number,
): Promise<Uint8Array> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
    throw new RangeError('maxBytes must be a non-negative safe integer')
  }
  if (!body) return new Uint8Array(0)

  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      total += value.byteLength
      if (total > maxBytes) {
        try {
          await reader.cancel('Webhook payload exceeded configured limit')
        } catch {
          // The size limit is already decisive; cancellation is best-effort.
        }
        throw new WebhookPayloadTooLargeError()
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }

  const output = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    output.set(chunk, offset)
    offset += chunk.byteLength
  }
  return output
}

/** Verify Meta's X-Hub-Signature-256 against the exact, unparsed request bytes. */
export function verifyMetaWebhookSignature(
  rawBody: string | Uint8Array,
  signatureHeader: string | null,
  appSecret: string | undefined,
): boolean {
  if (!appSecret || !signatureHeader) return false
  const match = /^sha256=([a-f0-9]{64})$/i.exec(signatureHeader.trim())
  if (!match) return false

  const supplied = Buffer.from(match[1]!, 'hex')
  const expected = createHmac('sha256', appSecret).update(rawBody).digest()
  return supplied.length === expected.length && timingSafeEqual(supplied, expected)
}

/** Constant-time comparison for the webhook verification token. */
export function safeSecretEquals(actual: string | null, expected: string | undefined): boolean {
  if (actual === null || !expected) return false
  const actualBytes = Buffer.from(actual, 'utf8')
  const expectedBytes = Buffer.from(expected, 'utf8')
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes)
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

/** Return unique inbound WhatsApp message IDs; status callbacks are ignored. */
export function extractInboundWhatsAppMessageIds(payload: unknown): string[] {
  const root = asRecord(payload)
  if (!root || !Array.isArray(root.entry)) return []

  const ids = new Set<string>()
  for (const entryValue of root.entry) {
    const entry = asRecord(entryValue)
    if (!entry || !Array.isArray(entry.changes)) continue

    for (const changeValue of entry.changes) {
      const change = asRecord(changeValue)
      const value = asRecord(change?.value)
      if (!value || !Array.isArray(value.messages)) continue

      for (const messageValue of value.messages) {
        const message = asRecord(messageValue)
        const id = message?.id
        if (typeof id === 'string' && MESSAGE_ID_PATTERN.test(id)) ids.add(id)
      }
    }
  }
  return [...ids]
}

/** Treat only Prisma's unique-key conflict as an expected duplicate delivery. */
export function isPrismaUniqueConstraintError(error: unknown): boolean {
  return asRecord(error)?.code === 'P2002'
}
