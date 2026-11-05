import { chooseStorage, S3Storage } from '@/lib/storage'

// This endpoint is a short-lived bearer capability used only by the moderation
// provider. The token is HMAC-signed, expires quickly, and can read only a
// single object inside the private pending/ quarantine prefix.
export async function GET(
  _request: Request,
  context: { params: Promise<{ token: string }> },
) {
  try {
    const { token } = await context.params
    const storage = chooseStorage()
    if (!(storage instanceof S3Storage)) return new Response('Not found', { status: 404 })
    const object = await storage.readModerationProxyObject(token)
    if (!object) return new Response('Not found', { status: 404 })
    return new Response(object.body, {
      status: 200,
      headers: {
        'content-type': object.contentType,
        'cache-control': 'private, no-store, max-age=0',
        'x-content-type-options': 'nosniff',
      },
    })
  } catch (error) {
    console.error('[moderation-proxy] private image retrieval failed', error instanceof Error ? error.name : 'unknown')
    return new Response('Temporarily unavailable', { status: 503 })
  }
}
