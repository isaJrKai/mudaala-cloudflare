import { NextResponse } from 'next/server'
import { ApiError, jsonOk, route } from '@/lib/api'
import { db } from '@/lib/db'
import { getClientIp } from '@/lib/client-ip'
import { hit, RATE_WINDOW_MS } from '@/lib/rate-limit'
import {
  extractInboundWhatsAppMessageIds,
  isPrismaUniqueConstraintError,
  readBoundedBody,
  safeSecretEquals,
  verifyMetaWebhookSignature,
  WebhookPayloadTooLargeError,
} from '@/lib/whatsapp-webhook'

const MAX_WEBHOOK_BYTES = 1_000_000
const MESSAGE_ID_RETENTION_DAYS = 7
const WEBHOOK_IP_MAX = 600
const VERIFY_IP_MAX = 20

function tooMany(retryAfterSeconds: number): NextResponse {
  return NextResponse.json(
    { error: 'Too many webhook requests. Please retry later.' },
    { status: 429, headers: { 'retry-after': String(retryAfterSeconds), 'cache-control': 'no-store' } },
  )
}

/**
 * Meta subscription handshake. A shared per-IP limit prevents repeated
 * verification-token guessing; the secret itself remains server-side.
 */
export async function GET(request: Request) {
  return route(async () => {
    const ipVerdict = await hit(`whatsapp:verify:ip:${getClientIp(request)}`, VERIFY_IP_MAX, RATE_WINDOW_MS)
    if (!ipVerdict.ok) return tooMany(ipVerdict.retryAfterSeconds)

    const url = new URL(request.url)
    const mode = url.searchParams.get('hub.mode')
    const token = url.searchParams.get('hub.verify_token')
    const challenge = url.searchParams.get('hub.challenge')

    if (
      mode !== 'subscribe' ||
      !challenge ||
      !safeSecretEquals(token, process.env.WHATSAPP_VERIFY_TOKEN)
    ) {
      return new NextResponse('Forbidden', { status: 403, headers: { 'cache-control': 'no-store' } })
    }

    return new NextResponse(challenge, {
      status: 200,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
    })
  })
}

/**
 * Verify the raw-body HMAC before parsing. Only message IDs are persisted in
 * this foundation slice; merchant linking and publishing are later slices.
 */
export async function POST(request: Request) {
  return route(async () => {
    const ipVerdict = await hit(`whatsapp:webhook:ip:${getClientIp(request)}`, WEBHOOK_IP_MAX, RATE_WINDOW_MS)
    if (!ipVerdict.ok) return tooMany(ipVerdict.retryAfterSeconds)

    const appSecret = process.env.WHATSAPP_APP_SECRET
    if (!appSecret) throw new ApiError(503, 'WhatsApp webhook is not configured')

    const contentLength = request.headers.get('content-length')
    if (contentLength !== null) {
      const declaredLength = Number(contentLength)
      if (Number.isFinite(declaredLength) && declaredLength > MAX_WEBHOOK_BYTES) {
        throw new ApiError(413, 'Webhook payload is too large')
      }
    }

    let rawBody: Uint8Array
    try {
      rawBody = await readBoundedBody(request.body, MAX_WEBHOOK_BYTES)
    } catch (error) {
      if (error instanceof WebhookPayloadTooLargeError) {
        throw new ApiError(413, 'Webhook payload is too large')
      }
      throw error
    }

    if (!verifyMetaWebhookSignature(rawBody, request.headers.get('x-hub-signature-256'), appSecret)) {
      throw new ApiError(401, 'Invalid webhook signature')
    }

    let payload: unknown
    try {
      const decodedBody = new TextDecoder('utf-8', { fatal: true }).decode(rawBody)
      payload = JSON.parse(decodedBody)
    } catch {
      throw new ApiError(400, 'Webhook payload must be valid JSON')
    }

    const messageIds = extractInboundWhatsAppMessageIds(payload)
    if (messageIds.length === 0) {
      return jsonOk({ received: true, recorded: 0, duplicates: 0 })
    }

    // Bound cleanup work per delivery. Expired markers are removed in batches
    // of at most 100 rather than an unbounded delete on every webhook request.
    const retentionCutoff = new Date(Date.now() - MESSAGE_ID_RETENTION_DAYS * 24 * 60 * 60 * 1000)
    const expiredMarkers = await db.appSetting.findMany({
      where: {
        key: { startsWith: 'whatsapp:inbound:' },
        updatedAt: { lt: retentionCutoff },
      },
      select: { key: true },
      take: 100,
    })
    if (expiredMarkers.length > 0) {
      await db.appSetting.deleteMany({
        where: { key: { in: expiredMarkers.map((marker) => marker.key) } },
      })
    }

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
