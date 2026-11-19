import { afterEach, describe, expect, it, mock } from 'bun:test'
import { gmailSenderAddress, resetGmailTokenCacheForTests, sendGmailMessage } from './gmail.ts'

const originalFetch = globalThis.fetch
const env = {
  GOOGLE_CLIENT_ID: 'client-id',
  GOOGLE_CLIENT_SECRET: 'client-secret',
  GOOGLE_GMAIL_REFRESH_TOKEN: 'refresh-token',
}

afterEach(() => {
  globalThis.fetch = originalFetch
  resetGmailTokenCacheForTests()
})

describe('Mudaala Gmail delivery', () => {
  it('uses the configured sender or the agreed Mudaala sender', () => {
    expect(gmailSenderAddress({})).toBe('mudaalakatale@gmail.com')
    expect(gmailSenderAddress({ GOOGLE_GMAIL_SENDER: 'custom@example.com' })).toBe('custom@example.com')
    expect(() => gmailSenderAddress({ GOOGLE_GMAIL_SENDER: 'bad address' })).toThrow('invalid')
  })

  it('refreshes an OAuth token and sends a base64url Gmail API message', async () => {
    const calls = []
    globalThis.fetch = mock(async (input, init) => {
      const url = String(input)
      calls.push({ url, init })
      if (url.includes('oauth2.googleapis.com')) {
        return new Response(JSON.stringify({ access_token: 'short-lived-access-token', expires_in: 3600 }), { status: 200 })
      }
      return new Response(JSON.stringify({ id: 'gmail-message-id' }), { status: 200 })
    })

    await sendGmailMessage('buyer@example.com', 'Your Mudaala code', 'Your code is 123456.', env)

    expect(calls).toHaveLength(2)
    expect(calls[0]?.url).toBe('https://oauth2.googleapis.com/token')
    expect(calls[1]?.url).toBe('https://gmail.googleapis.com/gmail/v1/users/me/messages/send')
    expect(new Headers(calls[1]?.init?.headers).get('authorization')).toBe('Bearer short-lived-access-token')

    const payload = JSON.parse(String(calls[1]?.init?.body))
    const base64 = payload.raw.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(payload.raw.length / 4) * 4, '=')
    const decoded = new TextDecoder().decode(Uint8Array.from(atob(base64), (character) => character.charCodeAt(0)))
    expect(decoded).toContain('To: buyer@example.com')
    expect(decoded).toContain('Subject: =?UTF-8?B?WW91ciBNdWRhYWxhIGNvZGU=?=')
    const encodedBody = decoded.split(/\r?\n\r?\n/)[1]?.trim()
    expect(encodedBody).toBeDefined()
    const body = new TextDecoder().decode(Uint8Array.from(atob(encodedBody ?? ''), (character) => character.charCodeAt(0)))
    expect(body).toBe('Your code is 123456.')
  })

  it('reuses a valid cached access token for subsequent messages', async () => {
    let tokenRequests = 0
    let sends = 0
    globalThis.fetch = mock(async (input) => {
      if (String(input).includes('oauth2.googleapis.com')) {
        tokenRequests += 1
        return new Response(JSON.stringify({ access_token: 'cached-token', expires_in: 3600 }), { status: 200 })
      }
      sends += 1
      return new Response('{}', { status: 200 })
    })

    await sendGmailMessage('one@example.com', 'First', 'First body', env)
    await sendGmailMessage('two@example.com', 'Second', 'Second body', env)
    expect(tokenRequests).toBe(1)
    expect(sends).toBe(2)
  })

  it('rejects header injection and never attempts a send without credentials', async () => {
    globalThis.fetch = mock(async () => new Response('{}', { status: 200 }))
    await expect(sendGmailMessage('person@example.com\r\nBcc: thief@example.com', 'Hi', 'Body', env)).rejects.toThrow()
    await expect(sendGmailMessage('person@example.com', 'Hi\r\nBcc: thief@example.com', 'Body', env)).rejects.toThrow('subject')
    await expect(sendGmailMessage('person@example.com', 'Hi', 'Body', {})).rejects.toThrow('not configured')
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('fails closed when Google refuses delivery', async () => {
    globalThis.fetch = mock(async (input) => {
      if (String(input).includes('oauth2.googleapis.com')) {
        return new Response(JSON.stringify({ access_token: 'valid-token', expires_in: 3600 }), { status: 200 })
      }
      return new Response('private provider detail', { status: 403 })
    })

    await expect(sendGmailMessage('person@example.com', 'Hi', 'Body', env)).rejects.toThrow('Gmail message delivery failed')
  })
})
