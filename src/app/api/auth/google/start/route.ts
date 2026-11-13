import { ApiError, jsonOk, route, requireUser } from '@/lib/api'
import { getCurrentSessionToken } from '@/lib/auth'
import { db } from '@/lib/db'
import { hit } from '@/lib/rate-limit'
import { getClientIp } from '@/lib/client-ip'
import { hashPhoneForVerification } from '@/lib/sms'
import { secureRandomToken, sha256Hex, pkceChallenge, parseGoogleRedirectUri } from '@/lib/google-oidc'

const STATE_TTL_MS = 5 * 60 * 1000
const RECENT_AUTH_MS = 10 * 60 * 1000

export async function POST(request: Request) {
  return route(async () => {
    const user = await requireUser('Sign in to link Google')
    const [userLimit, ipLimit] = await Promise.all([
      hit(`google-link:user:${user.id}`, 5, 60 * 60 * 1000),
      hit(`google-link:ip:${getClientIp(request)}`, 10, 60 * 60 * 1000),
    ])
    if (!userLimit.ok || !ipLimit.ok) {
      throw new ApiError(429, 'Too many Google linking attempts. Please try again later')
    }
    const token = await getCurrentSessionToken()
    if (!token) throw new ApiError(401, 'Sign in again before linking Google')

    // Linking an external identity changes account ownership/recovery options.
    // Require a session created by a fresh password sign-in, not just an old tab.
    const session = await db.session.findUnique({
      where: { id: token },
      select: { userId: true, authMethod: true, createdAt: true, expiresAt: true },
    })
    const now = new Date()
    if (
      !session ||
      session.userId !== user.id ||
      session.authMethod !== 'PASSWORD' ||
      session.expiresAt <= now ||
      now.getTime() - session.createdAt.getTime() > RECENT_AUTH_MS
    ) {
      throw new ApiError(403, 'For your security, sign in again before linking Google')
    }

    const clientId = process.env.GOOGLE_CLIENT_ID?.trim()
    const redirectUri = process.env.GOOGLE_REDIRECT_URI?.trim()
    if (!clientId || !redirectUri) {
      throw new ApiError(503, 'Google sign-in is not configured yet')
    }
    const redirect = parseGoogleRedirectUri(redirectUri)
    if (!redirect) throw new ApiError(503, 'Google callback URL must be a valid HTTPS Mudaala callback')
    const expectedOrigin = redirect.origin
    if (request.headers.get('origin') !== expectedOrigin) {
      throw new ApiError(403, 'Start Google sign-in from the Mudaala website')
    }

    const existing = await db.googleIdentity.findUnique({
      where: { userId_provider: { userId: user.id, provider: 'google' } },
      select: { id: true },
    })
    if (existing) throw new ApiError(409, 'A Google account is already linked to this Mudaala account')

    const phoneProof = await db.phoneVerificationChallenge.findFirst({
      where: {
        userId: user.id,
        phoneHash: hashPhoneForVerification(user.phone),
        verifiedAt: { gte: new Date(now.getTime() - RECENT_AUTH_MS) },
        usedAt: { not: null },
      },
      orderBy: { verifiedAt: 'desc' },
      select: { id: true },
    })
    if (!phoneProof) {
      throw new ApiError(403, 'Verify control of your registered phone by SMS before linking Google')
    }
    const proofConsumed = await db.phoneVerificationChallenge.updateMany({
      where: {
        id: phoneProof.id,
        userId: user.id,
        phoneHash: hashPhoneForVerification(user.phone),
        proofConsumedAt: null,
        verifiedAt: { gte: new Date(now.getTime() - RECENT_AUTH_MS) },
      },
      data: { proofConsumedAt: now },
    })
    if (proofConsumed.count !== 1) {
      throw new ApiError(409, 'That phone verification has already been used. Verify your phone again')
    }

    const state = secureRandomToken()
    const nonce = secureRandomToken()
    const codeVerifier = secureRandomToken()
    const stateHash = await sha256Hex(state)
    await db.googleOAuthState.deleteMany({ where: { expiresAt: { lt: now } } })
    await db.googleOAuthState.create({
      data: {
        userId: user.id,
        stateHash,
        nonceHash: await sha256Hex(nonce),
        expiresAt: new Date(now.getTime() + STATE_TTL_MS),
      },
    })

    const authorization = new URL('https://accounts.google.com/o/oauth2/v2/auth')
    authorization.searchParams.set('client_id', clientId)
    authorization.searchParams.set('redirect_uri', redirectUri)
    authorization.searchParams.set('response_type', 'code')
    authorization.searchParams.set('scope', 'openid email')
    authorization.searchParams.set('state', state)
    authorization.searchParams.set('nonce', nonce)
    authorization.searchParams.set('code_challenge', await pkceChallenge(codeVerifier))
    authorization.searchParams.set('code_challenge_method', 'S256')
    authorization.searchParams.set('prompt', 'select_account')
    const cookieStore = await (await import('next/headers')).cookies()
    cookieStore.set('mudaala_google_login_state', stateHash + '.' + codeVerifier, {
      httpOnly: true,
      secure: expectedOrigin.startsWith('https://'),
      sameSite: 'lax',
      path: '/api/auth/google/callback',
      maxAge: Math.floor(STATE_TTL_MS / 1000),
    })
    return jsonOk({ authorizationUrl: authorization.toString() })
  })
}
