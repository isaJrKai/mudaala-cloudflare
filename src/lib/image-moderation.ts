import { Buffer } from 'node:buffer'

export type SupportedImageType = 'jpg' | 'png' | 'webp'
export type ImageModerationResult =
  | { status: 'safe' }
  | { status: 'blocked'; category: 'sexual' | 'sexual/minors' }
  | { status: 'not_configured' }
  | { status: 'unavailable'; providerStatus?: number }

interface ModerationOptions {
  apiKey?: string
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

interface ModerationResponse {
  results?: Array<{
    categories?: Record<string, unknown>
  }>
}

const MIME_TYPES: Record<SupportedImageType, string> = {
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
}

/**
 * Classify a single uploaded image before it is stored or made public.
 * The moderation provider receives the image bytes as a data URL. No image
 * bytes or provider response are logged. Missing credentials and provider
 * errors are explicit outcomes so production can fail closed.
 */
export async function moderateImageContent(
  bytes: Uint8Array,
  type: SupportedImageType,
  options: ModerationOptions = {},
): Promise<ImageModerationResult> {
  // Production must provide OPENAI_MODERATION_API_KEY as a Worker secret, never a plain-text variable.
  const apiKey = options.apiKey ?? process.env.OPENAI_MODERATION_API_KEY
  if (!apiKey) return { status: 'not_configured' }

  const fetchImpl = options.fetchImpl ?? fetch
  const base64 = Buffer.from(bytes).toString('base64')
  const imageUrl = `data:${MIME_TYPES[type]};base64,${base64}`

  try {
    const response = await fetchImpl('https://api.openai.com/v1/moderations', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'omni-moderation-latest',
        input: [{ type: 'image_url', image_url: { url: imageUrl } }],
      }),
      signal: AbortSignal.timeout(options.timeoutMs ?? 12_000),
    })

    if (!response.ok) return { status: 'unavailable', providerStatus: response.status }
    const payload = await response.json() as ModerationResponse
    const categories = payload.results?.[0]?.categories
    // Treat a partial category payload as malformed. In particular, never
    // interpret a missing sexual/minors result as a clean image.
    if (!categories || typeof categories.sexual !== 'boolean' || typeof categories['sexual/minors'] !== 'boolean') {
      return { status: 'unavailable' }
    }

    if (categories['sexual/minors'] === true) return { status: 'blocked', category: 'sexual/minors' }
    if (categories.sexual === true) return { status: 'blocked', category: 'sexual' }
    return { status: 'safe' }
  } catch {
    return { status: 'unavailable' }
  }
}
