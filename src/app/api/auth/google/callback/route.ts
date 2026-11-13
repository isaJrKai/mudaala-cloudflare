import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { ApiError, route, requireUser } from '@/lib/api'
import { createSession, getSessionUser, setSessionCookie } from '@/lib/auth'
import { db } from '@/lib/db'
import { sha256Hex, verifyGoogleIdToken } from '@/lib/google-oidc'

function returnToApp(result: 'linked' | 'signed-in' | 'error', reason?: string) {
  // Never derive a redirect destination from the incoming Host header. A forged
  // Host can otherwise turn an OAuth callback into an open redirect.
  const destination = new URL(result === 'error' ? '/auth/google/error' : '/', 'https://mudaala.store')
  if (reason) destination.searchParams.set('reason', reason)
  return NextResponse.redirect(destination, 303)
}

export async function GET(request: Request) {
  return route(async () => {
    const url = new URL(request.url)
    const cookieStore = await cookies()
    const clearLoginStateCookie = () => cookieStore.set('mudaala_google_login_state', '', {
      httpOnly: true,
      secure: url.protocol === 'https:',
      sameSite: 'lax',
      path: '/api/auth/google/callback',
      maxAge: 0,
    })
    const providerError = url.searchParams.get('error')
    if (providerError) {
      clearLoginStateCookie()
      return returnToApp('error', 'cancelled')
    }

    const code = url.searchParams.get('code')
    const state = url.searchParams.get('state')
    if (!code || code.length > 4096 || !state || !/^[a-f0-9]{64}$/.test(state)) {
      throw new ApiError(400, 'This Google sign-in attempt is invalid or incomplete')
    }

    const stateRecord = await db.googleOAuthState.findUnique({
      where: { stateHash: await sha256Hex(state) },
      select: { id: true, userId: true, purpose: true, stateHash: true, nonceHash: true, expiresAt: true, usedAt: true },
    })
    const now = new Date()
    if (!stateRecord || stateRecord.usedAt || stateRecord.expiresAt <= now) {
      throw new ApiError(400, 'This Google sign-in attempt has expired. Start again')
    }

    let linkUserId: string | null = null
    if (stateRecord.purpose === 'LINK') {
      const user = await requireUser('Your Mudaala session expired. Sign in and try linking Google again.')
      if (!stateRecord.userId || stateRecord.userId !== user.id) {
        throw new ApiError(400, 'This Google linking attempt belongs to a different Mudaala account')
      }
      linkUserId = user.id
    } else if (stateRecord.purpose === 'LOGIN') {
      if (stateRecord.userId !== null) throw new ApiError(400, 'This Google sign-in attempt is invalid')
      if (cookieStore.get('mudaala_google_login_state')?.value !== stateRecord.stateHash) {
        throw new ApiError(400, 'This Google sign-in attempt was not started in this browser. Start again')
      }
      if (await getSessionUser()) {
        throw new ApiError(409, 'Sign out of your current Mudaala account before using Google sign-in')
      }
    } else {
      throw new ApiError(400, 'This Google sign-in attempt has an unsupported purpose')
    }

    // Atomically consume the state before exchanging the authorization code.
    // Concurrent callbacks and replayed URLs cannot both complete.
    const consumed = await db.googleOAuthState.updateMany({
      where: {
        id: stateRecord.id,
        userId: stateRecord.userId,
        purpose: stateRecord.purpose,
        usedAt: null,
        expiresAt: { gt: now },
      },
      data: { usedAt: now },
    })
    if (consumed.count !== 1) throw new ApiError(409, 'This Google sign-in attempt has already been used')
    if (stateRecord.purpose === 'LOGIN') clearLoginStateCookie()

    const clientId = process.env.GOOGLE_CLIENT_ID?.trim()
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET
    const redirectUri = process.env.GOOGLE_REDIRECT_URI?.trim()
    if (!clientId || !clientSecret || !redirectUri) {
      throw new ApiError(503, 'Google sign-in is not configured yet')
    }

    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
      signal: AbortSignal.timeout(8000),
    })
    if (!tokenResponse.ok) {
      console.error('[auth/google] authorization code exchange failed:', tokenResponse.status)
      throw new ApiError(400, 'Google could not complete this sign-in attempt. Please start again')
    }
    const tokenBody: unknown = await tokenResponse.json()
    if (!tokenBody || typeof tokenBody !== 'object' || typeof (tokenBody as { id_token?: unknown }).id_token !== 'string') {
      throw new ApiError(400, 'Google did not return a valid identity token')
    }

    let identity
    try {
      identity = await verifyGoogleIdToken(
        (tokenBody as { id_token: string }).id_token,
        clientId,
        stateRecord.nonceHash,
      )
    } catch (error) {
      console.error('[auth/google] ID token verification failed:', error instanceof Error ? error.message : 'unknown error')
      throw new ApiError(401, 'Google identity verification failed. Please start again')
    }

    if (stateRecord.purpose === 'LOGIN') {
      const linkedIdentity = await db.googleIdentity.findUnique({
        where: { provider_providerSub: { provider: 'google', providerSub: identity.sub } },
        include: { user: true },
      })
      if (!linkedIdentity) return returnToApp('error', 'not-linked')

      // Create the Mudaala session only for the exact immutable Google subject
      // that was explicitly linked earlier. Email equality never links accounts.
      const session = await createSession(linkedIdentity.userId)
      await db.auditLog.create({
        data: {
          actorId: linkedIdentity.userId,
          action: 'GOOGLE_LOGIN',
          targetType: 'USER',
          targetId: linkedIdentity.userId,
        },
      })
      await setSessionCookie(session.token, session.expiresAt)
      return returnToApp('signed-in')
    }

    if (!linkUserId) throw new ApiError(400, 'This Google linking attempt is invalid')
    try {
      await db.$transaction(async (tx) => {
        await tx.googleIdentity.create({
          data: {
            userId: linkUserId,
            provider: 'google',
            providerSub: identity.sub,
            email: identity.email,
            emailVerified: identity.emailVerified,
          },
        })
        await tx.auditLog.create({
          data: {
            actorId: linkUserId,
            action: 'LINK_GOOGLE_IDENTITY',
            targetType: 'USER',
            targetId: linkUserId,
          },
        })
      })
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002') {
        throw new ApiError(409, 'That Google account is already linked to a Mudaala account, or this account already has a Google login')
      }
      throw error
    }

    return returnToApp('linked')
  })
}
