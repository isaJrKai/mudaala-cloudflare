// Mudaala - SMS delivery behind a swappable provider.
//
// Production always uses Africa's Talking. The console provider is strictly
// non-production: printing an OTP in production logs would turn log access
// into an account-takeover path. A preview without SMS credentials must fail
// closed rather than disclose codes in logs.

import { createHash, createHmac, randomInt, timingSafeEqual } from 'node:crypto'

export interface SmsProvider {
  readonly name: string
  send(to: string, message: string): Promise<void>
}

class AfricasTalkingProvider implements SmsProvider {
  readonly name = 'africas-talking'

  async send(to: string, message: string): Promise<void> {
    const apiKey = process.env.AT_API_KEY
    const username = process.env.AT_USERNAME
    const senderId = process.env.AT_SENDER_ID
    if (!apiKey || !username) throw new Error('SMS provider is not configured')

    const form = new URLSearchParams({ username, to, message })
    if (senderId) form.set('from', senderId)

    try {
      const res = await fetch('https://api.africastalking.com/version1/messaging', {
        method: 'POST',
        headers: { apiKey, 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: form.toString(),
        signal: AbortSignal.timeout(15_000),
      })
      if (!res.ok) throw new Error(`provider status ${res.status}`)
    } catch (err) {
      if (err instanceof Error && err.message.startsWith('provider status')) throw err
      throw new Error('provider unreachable')
    }
  }
}

// Development/test only. The console is the developer's inbox; it must never
// be selectable in a production Worker, even by an accidental env override.
class ConsoleProvider implements SmsProvider {
  readonly name = 'console'

  async send(to: string, message: string): Promise<void> {
    console.log(`[sms:${this.name}] to ${to}: ${message}`)
  }
}

export function chooseSmsProvider(): SmsProvider {
  if (process.env.NODE_ENV === 'production') return new AfricasTalkingProvider()
  if (process.env.SMS_PROVIDER === 'africas-talking') return new AfricasTalkingProvider()
  return new ConsoleProvider()
}

const RESET_HASH_PREFIX = 'hmac-sha256-v1:'

function resetCodeHmacKey(): Buffer {
  const secret = process.env.RESET_CODE_PEPPER ?? process.env.SETTINGS_ENCRYPTION_KEY ?? process.env.SETTINGS_ENC_KEY
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('A reset-code pepper or settings encryption key is required in production')
    }
    return createHmac('sha256', 'mudaala-development-only-reset-code-key')
      .update('mudaala:password-reset-code:hmac-key:v1')
      .digest()
  }
  return createHmac('sha256', secret)
    .update('mudaala:password-reset-code:hmac-key:v1')
    .digest()
}

export function generateResetCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0')
}

export function hashResetCode(code: string): string {
  const digest = createHmac('sha256', resetCodeHmacKey()).update(code, 'utf8').digest('hex')
  return RESET_HASH_PREFIX + digest
}

export function resetCodeMatches(code: string, codeHash: string): boolean {
  const expectedHex = codeHash.startsWith(RESET_HASH_PREFIX)
    ? codeHash.slice(RESET_HASH_PREFIX.length)
    : codeHash
  if (!/^[a-f0-9]{64}$/.test(expectedHex)) return false

  const candidateHex = codeHash.startsWith(RESET_HASH_PREFIX)
    ? createHmac('sha256', resetCodeHmacKey()).update(code, 'utf8').digest('hex')
    : createHash('sha256').update(code, 'utf8').digest('hex')
  const candidate = Buffer.from(candidateHex, 'hex')
  const expected = Buffer.from(expectedHex, 'hex')
  return candidate.length === expected.length && timingSafeEqual(candidate, expected)
}

// Bind a phone-verification proof to the current registered phone without
// duplicating the phone number in the short-lived challenge table.
export function hashPhoneForVerification(phone: string): string {
  return createHmac('sha256', resetCodeHmacKey())
    .update('mudaala:google-phone-verification:v1:', 'utf8')
    .update(phone, 'utf8')
    .digest('hex')
}
