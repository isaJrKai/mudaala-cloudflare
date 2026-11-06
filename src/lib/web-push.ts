type PushSubscriptionKeys = { p256dh: string; auth: string }
export type StoredPushSubscription = PushSubscriptionKeys & { id: string; userId: string; endpoint: string }
export type PushPayload = {
  title: string
  body: string
  url: string
  notificationId: string
  actionLabel?: string
  priority?: 'LOW' | 'NORMAL' | 'HIGH'
}

const encoder = new TextEncoder()
const utf8 = (value: string) => encoder.encode(value)

function decodeBase64Url(value: string): Uint8Array {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=')
  const binary = atob(base64)
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

function encodeBase64Url(value: Uint8Array): string {
  let binary = ''
  for (let offset = 0; offset < value.length; offset += 0x8000) {
    binary += String.fromCharCode(...value.subarray(offset, offset + 0x8000))
  }
  return btoa(binary).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
}

function concatBytes(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const length = parts.reduce((total, part) => total + part.length, 0)
  const result = new Uint8Array(length)
  let offset = 0
  for (const part of parts) {
    result.set(part, offset)
    offset += part.length
  }
  return result
}

async function hmacSha256(keyBytes: Uint8Array, message: Uint8Array): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', keyBytes as unknown as BufferSource, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, message as unknown as BufferSource))
}

async function hkdfExpand(prk: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
  const blocks: Uint8Array[] = []
  let previous: Uint8Array<ArrayBufferLike> = new Uint8Array()
  let generated = 0
  for (let counter = 1; generated < length; counter += 1) {
    previous = await hmacSha256(prk, concatBytes(previous, info, Uint8Array.of(counter)))
    blocks.push(previous)
    generated += previous.length
  }
  return concatBytes(...blocks).slice(0, length)
}

export async function createVapidJwt(
  endpoint: string,
  privateJwk: JsonWebKey,
  subject = 'https://mudaala.store',
): Promise<string> {
  const audience = new URL(endpoint).origin
  const header = encodeBase64Url(utf8(JSON.stringify({ typ: 'JWT', alg: 'ES256' })))
  const payload = encodeBase64Url(utf8(JSON.stringify({
    aud: audience,
    exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
    sub: subject,
  })))
  const signingInput = `${header}.${payload}`
  const privateKey = await crypto.subtle.importKey(
    'jwk',
    privateJwk,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    privateKey,
    utf8(signingInput) as unknown as BufferSource,
  )
  return `${signingInput}.${encodeBase64Url(new Uint8Array(signature))}`
}

/** RFC 8291 aes128gcm payload encryption for a browser PushSubscription. */
export async function encryptPushPayload(
  subscription: PushSubscriptionKeys,
  payload: PushPayload,
): Promise<Uint8Array> {
  const userAgentPublicBytes = decodeBase64Url(subscription.p256dh)
  const authSecret = decodeBase64Url(subscription.auth)
  if (userAgentPublicBytes.length !== 65 || authSecret.length !== 16) {
    throw new Error('Invalid browser push subscription keys')
  }

  const userAgentPublicKey = await crypto.subtle.importKey(
    'raw',
    userAgentPublicBytes as unknown as BufferSource,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  )
  const serverKeyPair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits'],
  ) as CryptoKeyPair
  const serverPublicBytes = new Uint8Array(await crypto.subtle.exportKey('raw', serverKeyPair.publicKey))
  const sharedSecret = new Uint8Array(await crypto.subtle.deriveBits(
    { name: 'ECDH', public: userAgentPublicKey },
    serverKeyPair.privateKey,
    256,
  ))

  const keyInfo = concatBytes(utf8('WebPush: info\0'), userAgentPublicBytes, serverPublicBytes)
  const authPrk = await hmacSha256(authSecret, sharedSecret)
  const inputKeyMaterial = await hkdfExpand(authPrk, keyInfo, 32)

  const salt = crypto.getRandomValues(new Uint8Array(16))
  const contentPrk = await hmacSha256(salt, inputKeyMaterial)
  const contentKeyBytes = await hkdfExpand(contentPrk, utf8('Content-Encoding: aes128gcm\0'), 16)
  const nonce = await hkdfExpand(contentPrk, utf8('Content-Encoding: nonce\0'), 12)
  const contentKey = await crypto.subtle.importKey('raw', contentKeyBytes as unknown as BufferSource, 'AES-GCM', false, ['encrypt'])

  // 0x02 marks the final record in the aes128gcm content encoding.
  const plaintext = concatBytes(utf8(JSON.stringify(payload)), Uint8Array.of(2))
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce as unknown as BufferSource, tagLength: 128 },
    contentKey,
    plaintext,
  ))

  const recordSize = new Uint8Array(4)
  new DataView(recordSize.buffer).setUint32(0, 4096, false)
  return concatBytes(salt, recordSize, Uint8Array.of(serverPublicBytes.length), serverPublicBytes, ciphertext)
}

export async function sendWebPush(
  subscription: StoredPushSubscription,
  payload: PushPayload,
): Promise<{ status: number; ok: boolean } | { skipped: true }> {
  const privateJwkText = process.env.VAPID_PRIVATE_JWK
  const publicKey = process.env.VAPID_PUBLIC_KEY
  if (!privateJwkText || !publicKey) return { skipped: true }

  const privateJwk = JSON.parse(privateJwkText) as JsonWebKey
  const jwt = await createVapidJwt(subscription.endpoint, privateJwk)
  const body = await encryptPushPayload(subscription, payload)
  const response = await fetch(subscription.endpoint, {
    method: 'POST',
    headers: {
      Authorization: `vapid t=${jwt}, k=${publicKey}`,
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: '3600',
      Urgency: payload.priority === 'HIGH' ? 'high' : 'normal',
    },
    body: body as unknown as BodyInit,
  })
  return { status: response.status, ok: response.ok }
}
