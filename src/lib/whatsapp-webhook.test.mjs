import { describe, expect, it } from 'bun:test'
import { createHmac } from 'node:crypto'
import {
  extractInboundWhatsAppMessageIds,
  isPrismaUniqueConstraintError,
  readBoundedBody,
  safeSecretEquals,
  verifyMetaWebhookSignature,
  WebhookPayloadTooLargeError,
} from './whatsapp-webhook'

describe('WhatsApp webhook security helpers', () => {
  const secret = 'test-meta-app-secret'
  const body = JSON.stringify({ object: 'whatsapp_business_account', entry: [] })
  const signature = 'sha256=' + createHmac('sha256', secret).update(body).digest('hex')

  it('accepts a valid signature for the exact raw body', () => {
    expect(verifyMetaWebhookSignature(body, signature, secret)).toBe(true)
    expect(verifyMetaWebhookSignature(Buffer.from(body), signature, secret)).toBe(true)
  })

  it('rejects a changed body, missing secret, and malformed signatures', () => {
    expect(verifyMetaWebhookSignature(body + ' ', signature, secret)).toBe(false)
    expect(verifyMetaWebhookSignature(body, signature, undefined)).toBe(false)
    expect(verifyMetaWebhookSignature(body, 'sha256=not-hex', secret)).toBe(false)
    expect(verifyMetaWebhookSignature(body, null, secret)).toBe(false)
  })

  it('compares verification tokens without accepting missing values', () => {
    expect(safeSecretEquals('same-token', 'same-token')).toBe(true)
    expect(safeSecretEquals('wrong-token', 'same-token')).toBe(false)
    expect(safeSecretEquals(null, 'same-token')).toBe(false)
    expect(safeSecretEquals('same-token', undefined)).toBe(false)
  })

  it('reads a streamed body within the configured byte limit', async () => {
    const bodyBytes = new TextEncoder().encode('hello world')
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bodyBytes.slice(0, 5))
        controller.enqueue(bodyBytes.slice(5))
        controller.close()
      },
    })
    const result = await readBoundedBody(stream, 11)
    expect(new TextDecoder().decode(result)).toBe('hello world')
  })

  it('cancels the stream immediately when the byte limit is exceeded', async () => {
    let cancelled = false
    let pulls = 0
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls++
        controller.enqueue(new Uint8Array(4))
      },
      cancel() {
        cancelled = true
      },
    })
    await expect(readBoundedBody(stream, 5)).rejects.toBeInstanceOf(WebhookPayloadTooLargeError)
    expect(cancelled).toBe(true)
    expect(pulls).toBeLessThanOrEqual(2)
  })

  it('extracts unique message IDs and ignores status callbacks', () => {
    const payload = {
      entry: [{
        changes: [
          { value: { messages: [{ id: 'wamid.HBgM123.1' }, { id: 'wamid.HBgM123.1' }, { id: 'wamid.HBgM456.2' }, { id: 'bad id' }] } },
          { value: { statuses: [{ id: 'wamid_status' }] } },
        ],
      }],
    }
    expect(extractInboundWhatsAppMessageIds(payload)).toEqual(['wamid.HBgM123.1', 'wamid.HBgM456.2'])
  })

  it('handles malformed webhook envelopes safely', () => {
    expect(extractInboundWhatsAppMessageIds(null)).toEqual([])
    expect(extractInboundWhatsAppMessageIds({ entry: 'not-an-array' })).toEqual([])
    expect(extractInboundWhatsAppMessageIds({ entry: [{ changes: [null] }] })).toEqual([])
  })

  it('recognizes only Prisma unique-key conflicts as duplicates', () => {
    expect(isPrismaUniqueConstraintError({ code: 'P2002' })).toBe(true)
    expect(isPrismaUniqueConstraintError({ code: 'P2025' })).toBe(false)
    expect(isPrismaUniqueConstraintError(new Error('duplicate'))).toBe(false)
  })
})
