import { generateResetCode, hashResetCode, resetCodeMatches } from '@/lib/sms'
import { db } from '@/lib/db'
import { sendGmailMessage } from '@/lib/gmail'

export const EMAIL_CODE_TTL_MS = 10 * 60 * 1000
export const EMAIL_CODE_MAX_ATTEMPTS = 5

export function normalizeAccountEmail(value: string): string {
  return value.trim().toLowerCase()
}

/**
 * Serializes challenge issuance with email replacement and code redemption.
 * Login/reset challenges may only be issued for the user's currently verified
 * address. The row lock prevents a stale address from gaining new authority
 * while an email replacement is committing.
 */
export async function issueEmailCode(
  userId: string,
  targetEmail: string,
  purpose: 'VERIFY_EMAIL' | 'PASSWORD_RESET' | 'PASSWORDLESS_LOGIN',
  subject: string,
  intro: string,
): Promise<void> {
  const code = generateResetCode()
  const challenge = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`
    if (purpose !== 'VERIFY_EMAIL') {
      const account = await tx.user.findUnique({
        where: { id: userId },
        select: { email: true, emailVerifiedAt: true },
      })
      if (!account?.emailVerifiedAt || normalizeAccountEmail(account.email ?? '') !== targetEmail) {
        throw new Error('EMAIL_ADDRESS_CHANGED')
      }
    }
    await tx.emailAuthChallenge.updateMany({
      where: { userId, purpose, consumedAt: null },
      data: { consumedAt: new Date() },
    })
    return tx.emailAuthChallenge.create({
      data: {
        userId,
        purpose,
        targetEmail,
        codeHash: hashResetCode(code),
        expiresAt: new Date(Date.now() + EMAIL_CODE_TTL_MS),
      },
      select: { id: true },
    })
  })
  try {
    await sendGmailMessage(
      targetEmail,
      subject,
      `${intro}\n\nYour one-time code is ${code}. It expires in 10 minutes. If you did not request this, ignore this email.`,
    )
  } catch {
    await db.emailAuthChallenge.updateMany({
      where: { id: challenge.id, userId, consumedAt: null },
      data: { consumedAt: new Date() },
    })
    throw new Error('EMAIL_DELIVERY_FAILED')
  }
}

export function emailCodeMatches(code: string, hash: string): boolean {
  return resetCodeMatches(code, hash)
}
