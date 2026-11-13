import { cookies } from 'next/headers'
import { ApiError, jsonOk, route } from '@/lib/api'
import { getSessionUser } from '@/lib/auth'
import { db } from '@/lib/db'
import { hit } from '@/lib/rate-limit'
import { getClientIp } from '@/lib/client-ip'
import { secureRandomToken, sha256Hex, pkceChallenge } from '@/lib/google-oidc'

const STATE_TTL_MS = 5 * 60 * 1000

export async function POST(request: Request) {
  return route(async () => {
    const ipLimit = await hit(`google-login:ip:${getClientIp(request)}`, 10, 60 * 60 * 1000)
    if (!ipLimit.ok) throw new ApiError(429, 'Too many Google sign-in attempts. Please try again later')

    // Do not silently replace an active account with a different Google login.
    // Users must sign out first if they intend to switch accounts.
    if (await getSessionUser()) {
      throw new ApiError(409, 'Sign out of your current Mudaala account before using Google sign-in')
    }

    const clientId = process.env.GOOGLE_CLIENT_ID?.trim()
    const redirectUri = process.env.GOOGLE_REDIRECT_URI?.trim()
    if (!clientId || !redirectUri) {
      throw new ApiError(503, 'Google sign-in is not configured yet')
    }
    const expectedOrigin = new URL(redirectUri).origin
    if (request.headers.get('origin') !== expectedOrigin) {
      throw new ApiError(403, 'Start Google sign-in from the Mudaala website')
    }

    const now = new Date()
    const state = secureRandomToken()
    const nonce = secureRandomToken()\n    const codeVerifier = secureRandomToken()
    const stateHash = await sha256Hex(state)
    await db.googleOAuthState.deleteMany({ where: { expiresAt: { lt: now } } })
    await db.googleOAuthState.create({
      data: {
        userId: null,
        purpose: 'LOGIN',
        stateHash,
        nonceHash: await sha256Hex(nonce),
        expiresAt: new Date(now.getTime() + STATE_TTL_MS),
      },
    })

    // Bind this anonymous OAuth attempt to the browser that initiated it.
    // Without this cookie, a victim could be tricked into completing an
    // attacker-started flow and be logged into the attacker's Mudaala account.
    const cookieStore = await cookies()
    cookieStore.set('mudaala_google_login_state', stateHash + '.' + codeVerifier, {
      httpOnly: true,
      secure: new URL(request.url).protocol === 'https:',
      sameSite: 'lax',
      path: '/api/auth/google/callback',
      maxAge: Math.floor(STATE_TTL_MS / 1000),
    })

    const authorization = new URL('https://accounts.google.com/o/oauth2/v2/auth')
    authorization.searchParams.set('client_id', clientId)
    authorization.searchParams.set('redirect_uri', redirectUri)
    authorization.searchParams.set('response_type', 'code')
    authorization.searchParams.set('scope', 'openid email')
    authorization.searchParams.set('state', state)
    authorization.searchParams.set('nonce', nonce)\n    authorization.searchParams.set('code_challenge', await pkceChallenge(codeVerifier))\n    authorization.searchParams.set('code_challenge_method', 'S256')
    authorization.searchParams.set('prompt', 'select_account')
    return jsonOk({ authorizationUrl: authorization.toString() })
  })
}
