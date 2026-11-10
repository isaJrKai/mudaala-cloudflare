import { describe, expect, it } from 'bun:test'
import { assertVapidKeyPair, createVapidJwt, encryptPushPayload, vapidPublicKeyFromJwk } from './web-push.ts'

function toBase64Url(value) {
  let binary = ''
  for (const byte of value) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
}

function fromBase64Url(value) {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=')
  return Uint8Array.from(atob(base64), (character) => character.charCodeAt(0))
}

describe('Web Push cryptography', () => {
  it('rejects a VAPID private key that does not match the configured public key', async () => {
    const pair = await crypto.subtle.generateKey(
      { name: 'ECDSA', namedCurve: 'P-256' },
      true,
      ['sign', 'verify'],
    )
    const privateJwk = await crypto.subtle.exportKey('jwk', pair.privateKey)
    const publicKey = vapidPublicKeyFromJwk(privateJwk)
    expect(publicKey).toHaveLength(87)
    expect(() => assertVapidKeyPair(privateJwk, publicKey)).not.toThrow()
    expect(() => assertVapidKeyPair(privateJwk, 'B'.repeat(87))).toThrow('VAPID public and private keys do not match')
  })

  it('creates a verifiable VAPID ES256 JWT for the push service audience', async () => {
    const pair = await crypto.subtle.generateKey(
      { name: 'ECDSA', namedCurve: 'P-256' },
      true,
      ['sign', 'verify'],
    )
    const privateJwk = await crypto.subtle.exportKey('jwk', pair.privateKey)
    const jwt = await createVapidJwt('https://fcm.googleapis.com/fcm/send/example', privateJwk)
    const [header, payload, signature] = jwt.split('.')
    const decodedPayload = JSON.parse(new TextDecoder().decode(fromBase64Url(payload)))
    expect(decodedPayload.aud).toBe('https://fcm.googleapis.com')
    expect(decodedPayload.sub).toBe('https://mudaala.store')
    expect(fromBase64Url(signature)).toHaveLength(64)
    const valid = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      pair.publicKey,
      fromBase64Url(signature),
      new TextEncoder().encode(`${header}.${payload}`),
    )
    expect(valid).toBe(true)
  })

  it('encrypts a push payload into the aes128gcm record format', async () => {
    const pair = await crypto.subtle.generateKey(
      { name: 'ECDH', namedCurve: 'P-256' },
      true,
      ['deriveBits'],
    )
    const publicKey = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey))
    const auth = crypto.getRandomValues(new Uint8Array(16))
    const encrypted = await encryptPushPayload({
      p256dh: toBase64Url(publicKey),
      auth: toBase64Url(auth),
    }, {
      title: 'Your shop has a new opportunity',
      body: 'Add a product photo and share it with customers.',
      url: '/#/publish',
      notificationId: 'notification-1',
    })

    expect(encrypted.slice(0, 16)).toHaveLength(16) // random salt
    expect(new DataView(encrypted.buffer, encrypted.byteOffset + 16, 4).getUint32(0, false)).toBe(4096)
    expect(encrypted[20]).toBe(65) // uncompressed P-256 ephemeral public key
    expect(encrypted.length).toBeGreaterThan(16 + 4 + 1 + 65 + 16)
  })
})
