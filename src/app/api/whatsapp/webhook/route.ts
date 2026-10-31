import { NextResponse } from 'next/server'
import { ApiError, jsonOk, route } from '@/lib/api'
import { db } from '@/lib/db'
import {
  extractInboundWhatsAppMessageIds,
  isPrismaUniqueConstraintError,
  safeSecretEquals,
  verifyMetaWebhookSignature,
} from '@/lib/whatsapp-webhook'

const MAX_WEBHOOK_BYTES = 1_000_000
const MESSAGE_ID_RETENTION_DAYS = 7

/**
 * Meta webhook subscription handshake.
 * Configure WHATSAPP_VERIFY_TOKEN as a Cloudflare Worker secret.
 */
export async function GET(request: Request) {
  const url = new URL(request.url)
  const mode = url.searchParams.get('hub.mode')
  const token = url.searchParams.get('hub.verify_token')
  const challenge = url.searchParams.get('hub.challenge')

  if (
    mode !== 'subscribe' ||
    !challenge ||
    !safeSecretEquals(token, process.env.WHATSAPP_VERIFY_TOKEN)
  ) {
    return new NextResponse('Forbidden', { status: 403 })
  }

  return new NextResponse(challenge, {
    status: 200,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  })
}

/**
 * Verify the raw-body HMAC before parsing or trusting any webhook fields.
 * This first slice records only message IDs for seven-day deduplication. It
 * deliberately does not publish listings or retain message contents yet.
 */
export async function POST(request: Request) {
  return route(async () => {
    const appSecret = process.env.WHATSAPP_APP_SECRET
    if (!appSecret) {
      throw new ApiError(503, 'WhatsApp webhook is not configured')
    }

    const contentLength = Number(request.headers.get('content-length') ?? 0)
    if (Number.isFinite(contentLength) && contentLength > MAX_WEBHOOK_BYTES) {
      throw new ApiError(413, 'Webhook payload is too large')
    }

    const rawBody = await request.text()
    if (new TextEncoder().encode(rawBody).byteLength > MAX_WEBHOOK_BYTES) {
      throw new ApiError(413, 'Webhook payload is too large')
    }

    if (!verifyMetaWebhookSignature(rawBody, request.headers.get('x-hub-signature-256'), appSecret)) {
      throw new ApiError(401, 'Invalid webhook signature')
    }

    let payload: unknown
    try {
      payload = JSON.parse(rawBody)
    } catch {
      throw new ApiError(400, 'Webhook payload must be valid JSON')
    }

    const messageIds = extractInboundWhatsAppMessageIds(payload)
    if (messageIds.length === 0) {
      // Delivery/status callbacks can legitimately contain no inbound messages.
      return jsonOk({ received: true, recorded: 0, duplicates: 0 })
    }

    // Keep only short-lived, non-content idempotency markers. Old markers are
    // pruned on inbound traffic; no sender, text, phone number or media URL is
    // copied into this ledger.
    const retentionCutoff = new Date(Date.now() - MESSAGE_ID_RETENTION_DAYS * 24 * 60 * 60 * 1000)
    await db.appSetting.deleteMany({
      where: {
        key: { startsWith: 'whatsapp:inbound:' },
        updatedAt: { lt: retentionCutoff },
      },
    })

    let recorded = 0
    let duplicates = 0
    for (const messageId of messageIds) {
      try {
        await db.appSetting.create({
          data: {
            key: `whatsapp:inbound:${messageId}`,
            value: JSON.stringify({ receivedAt: new Date().toISOString() }),
          },
        })
        recorded++
      } catch (error) {
        if (isPrismaUniqueConstraintError(error)) {
          duplicates++
          continue
        }
        throw error
      }
    }

    return jsonOk({ received: true, recorded, duplicates })
  })
}
