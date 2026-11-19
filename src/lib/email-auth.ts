import { generateResetCode, hashResetCode, resetCodeMatches } from '@/lib/sms'
import { db } from '@/lib/db'
import { sendGmailMessage } from '@/lib/gmail'

export const EMAIL_CODE_TTL_MS = 10 * 60 * 1000
export const EMAIL_CODE_MAX_ATTEMPTS = 5

export function normalizeAccountEmail(value: string): string {
  return value.trim().toLowerCase()
}

export async function issueEmailCode(
  userId: string,
  targetEmail: string,
  purpose: 'VERIFY_EMAIL' | 'PASSWORD_RESET' | 'PASSWORDLESS_LOGIN',
  subject: string,
  intro: string,
): Promise<void> {
  const code = generateResetCode()
  await db.$transaction(async (tx) => {
    await tx.emailAuthChallenge.updateMany({
      where: { userId, purpose, consumedAt: null },
      data: { consumedAt: new Date() },
    })
    await tx.emailAuthChallenge.create({
      data: {
        userId,
        purpose,
        targetEmail,
        codeHash: hashResetCode(code),
        expiresAt: new Date(Date.now() + EMAIL_CODE_TTL_MS),
      },
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
      where: { userId, purpose, targetEmail, consumedAt: null },
      data: { consumedAt: new Date() },
    })
    throw new Error('EMAIL_DELIVERY_FAILED')
  }
}

export function emailCodeMatches(code: string, hash: string): boolean {
  return resetCodeMatches(code, hash)
}
