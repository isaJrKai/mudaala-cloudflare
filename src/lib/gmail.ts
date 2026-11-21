/**
 * Mudaala transactional email through the Gmail API.
 *
 * Cloudflare Workers cannot rely on raw SMTP sockets, so delivery uses the
 * Gmail REST API. Credentials are Worker secrets, never source-controlled.
 * The refresh token must be authorized for the gmail.send scope.
 */

type GmailEnvironment = {
  GOOGLE_CLIENT_ID?: string
  GOOGLE_CLIENT_SECRET?: string
  GOOGLE_GMAIL_REFRESH_TOKEN?: string
  GOOGLE_GMAIL_SENDER?: string
}

type CachedAccessToken = { value: string; expiresAt: number }
let cachedAccessToken: CachedAccessToken | null = null

const encoder = new TextEncoder()

function encodeBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  }
  return btoa(binary)
}

function encodeBase64Url(bytes: Uint8Array): string {
  return encodeBase64(bytes).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
}

function base64Lines(value: string): string {
  const encoded = encodeBase64(encoder.encode(value))
  return encoded.match(/.{1,76}/g)?.join('\r\n') ?? ''
}

function safeHeader(value: string, label: string): string {
  if (!value || /[\r\n]/.test(value)) throw new Error(`Invalid email ${label}`)
  return value
}

function encodedSubject(value: string): string {
  return `=?UTF-8?B?${encodeBase64(encoder.encode(safeHeader(value, 'subject')))}?=`
}

async function getAccessToken(env: GmailEnvironment): Promise<string> {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_GMAIL_REFRESH_TOKEN } = env
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_GMAIL_REFRESH_TOKEN) {
    throw new Error('Gmail delivery is not configured')
  }

  if (cachedAccessToken && cachedAccessToken.expiresAt > Date.now() + 60_000) {
    return cachedAccessToken.value
  }

  const body = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    client_secret: GOOGLE_CLIENT_SECRET,
    refresh_token: GOOGLE_GMAIL_REFRESH_TOKEN,
    grant_type: 'refresh_token',
  })
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(15_000),
  })
  if (!response.ok) throw new Error('Gmail authorization failed')

  const payload = await response.json() as { access_token?: string; expires_in?: number }
  if (!payload.access_token || !payload.expires_in) {
    throw new Error('Gmail authorization returned an invalid response')
  }

  cachedAccessToken = {
    value: payload.access_token,
    expiresAt: Date.now() + payload.expires_in * 1000,
  }
  return payload.access_token
}

function runtimeGmailEnvironment(): GmailEnvironment {
  return {
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
    GOOGLE_GMAIL_REFRESH_TOKEN: process.env.GOOGLE_GMAIL_REFRESH_TOKEN,
    GOOGLE_GMAIL_SENDER: process.env.GOOGLE_GMAIL_SENDER,
  }
}

export function gmailSenderAddress(env: GmailEnvironment = runtimeGmailEnvironment()): string {
  const sender = env.GOOGLE_GMAIL_SENDER?.trim() || 'mudaalakatale@gmail.com'
  if (!/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(sender)) {
    throw new Error('Gmail sender address is invalid')
  }
  return sender
}

/** Send a plain-text transactional message. Never logs recipients, content or tokens. */
export async function sendGmailMessage(
  to: string,
  subject: string,
  text: string,
  env: GmailEnvironment = runtimeGmailEnvironment(),
): Promise<void> {
  const recipient = safeHeader(to.trim(), 'recipient')
  if (!/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(recipient)) {
    throw new Error('Invalid email recipient')
  }
  if (!text.trim()) throw new Error('Email message cannot be empty')

  const sender = gmailSenderAddress(env)
  const message = [
    `From: Mudaala <${sender}>`,
    `To: ${recipient}`,
    `Subject: ${encodedSubject(subject)}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    base64Lines(text),
    '',
  ].join('\r\n')

  const accessToken = await getAccessToken(env)
  const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ raw: encodeBase64Url(encoder.encode(message)) }),
    signal: AbortSignal.timeout(15_000),
  })
  if (!response.ok) {
    // Do not include Google's response body: it may contain account metadata.
    cachedAccessToken = null
    throw new Error('Gmail message delivery failed')
  }
}

/** Test-only cache reset; not used by application routes. */
export function resetGmailTokenCacheForTests(): void {
  cachedAccessToken = null
}
