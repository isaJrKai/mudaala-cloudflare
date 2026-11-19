import { cookies } from 'next/headers'
import { ApiError, jsonOk, parseBody, route } from '@/lib/api'
import { db } from '@/lib/db'
import { hashPassword, setSessionCookie, toPublicUser } from '@/lib/auth'
import { normalizePhone, countryPhoneMessage, passwordProblem, registerSchema, type CountryKey } from '@/lib/validation'
import { TERMS_VERSION } from '@/lib/constants'
import { hit, REGISTER_WINDOW_MS, REGISTER_IP_MAX } from '@/lib/rate-limit'
import { getClientIp } from '@/lib/client-ip'
import { hasSameRequestOrigin, secureRandomToken, sha256Hex } from '@/lib/google-oidc'

const GOOGLE_SIGNUP_COOKIE = 'mudaala_google_signup'
const SIGNUP_SESSION_MS = 30 * 24 * 60 * 60 * 1000

export async function POST(request: Request) {
  return route(async () => {
    if (!hasSameRequestOrigin(request)) {
      throw new ApiError(403, 'Complete Google sign-up from the Mudaala website')
    }

    const cookieStore = await cookies()
    const signupToken = cookieStore.get(GOOGLE_SIGNUP_COOKIE)?.value ?? ''
    if (!/^[a-f0-9]{64}$/.test(signupToken)) {
      throw new ApiError(400, 'Your Google sign-up session has expired. Start again')
    }

    const tokenHash = await sha256Hex(signupToken)
    const now = new Date()
    const signupState = await db.googleOAuthState.findUnique({
      where: { signupTokenHash: tokenHash },
      select: {
        id: true, userId: true, purpose: true, usedAt: true, expiresAt: true,
        providerSub: true, googleEmail: true, googleEmailVerified: true,
        signupCompletedAt: true,
      },
    })
    if (
      !signupState || signupState.userId !== null || signupState.purpose !== 'LOGIN' ||
      !signupState.usedAt || signupState.signupCompletedAt || signupState.expiresAt <= now ||
      !signupState.providerSub || !signupState.googleEmail || !signupState.googleEmailVerified
    ) {
      throw new ApiError(400, 'Your Google sign-up session is invalid or has expired. Start again')
    }

    const ip = getClientIp(request)
    const limit = await hit(`register:ip:${ip}`, REGISTER_IP_MAX, REGISTER_WINDOW_MS)
    if (!limit.ok) {
      throw new ApiError(429, 'Too many accounts created from this device. Please wait about an hour, then try again.')
    }

    const data = await parseBody(request, registerSchema)
    if (data.acceptTerms !== true) {
      throw new ApiError(400, 'Please confirm you are 18 or older and accept the Terms and Privacy Policy', {
        acceptTerms: 'Confirm you are 18+ and accept the Terms and Privacy Policy',
      })
    }

    const country = data.country as CountryKey
    const phone = normalizePhone(data.phone, country)
    if (!phone) {
      const message = countryPhoneMessage(country)
      throw new ApiError(400, message, { phone: message })
    }

    // Never link by Google email. If this phone already owns a Mudaala account,
    // its owner must authenticate to that account and explicitly link Google.
    const existing = await db.user.findUnique({ where: { phone }, select: { id: true } })
    if (existing) {
      throw new ApiError(409, 'An account with this phone number already exists. Sign in with your existing phone and password, then connect Google in Settings. Use Forgot password if needed.')
    }

    const passwordIssue = passwordProblem(data.password, phone)
    if (passwordIssue) throw new ApiError(400, passwordIssue, { password: passwordIssue })

    const sessionToken = secureRandomToken()
    const expiresAt = new Date(now.getTime() + SIGNUP_SESSION_MS)
    let createdUser
    try {
      createdUser = await db.$transaction(async (tx) => {
        const consumed = await tx.googleOAuthState.updateMany({
          where: {
            id: signupState.id,
            userId: null,
            purpose: 'LOGIN',
            usedAt: { not: null },
            signupTokenHash: tokenHash,
            signupCompletedAt: null,
            expiresAt: { gt: now },
            googleEmailVerified: true,
          },
          data: { signupTokenHash: null, signupCompletedAt: now },
        })
        if (consumed.count !== 1) {
          throw new ApiError(409, 'This Google sign-up session has already been used. Start again')
        }

        const user = await tx.user.create({
          data: {
            name: data.name,
            phone,
            country,
            passwordHash: hashPassword(data.password),
            termsAcceptedAt: now,
            termsVersion: TERMS_VERSION,
          },
        })
        await tx.googleIdentity.create({
          data: {
            userId: user.id,
            provider: 'google',
            providerSub: signupState.providerSub!,
            email: signupState.googleEmail,
            emailVerified: true,
          },
        })
        await tx.session.create({
          data: { id: sessionToken, userId: user.id, authMethod: 'GOOGLE', expiresAt },
        })
        await tx.auditLog.create({
          data: {
            actorId: user.id,
            action: 'GOOGLE_SIGNUP',
            targetType: 'USER',
            targetId: user.id,
          },
        })
        return user
      })
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002') {
        throw new ApiError(409, 'This phone number or Google account is already connected to Mudaala. Sign in to your existing account instead.')
      }
      throw error
    }

    await setSessionCookie(sessionToken, expiresAt)
    cookieStore.set(GOOGLE_SIGNUP_COOKIE, '', {
      httpOnly: true,
      secure: new URL(request.url).protocol === 'https:',
      sameSite: 'lax',
      path: '/api/auth/google/complete',
      maxAge: 0,
    })
    return jsonOk({ user: toPublicUser(createdUser) }, 201)
  })
}
