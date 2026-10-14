// Mudaala - step 2 of password reset: code + new password.
//
// EVERY failure mode below returns the same message - unknown phone, no code
// ever issued, expired code, already-used code, killed code, wrong code -
// because distinguishing them would tell an attacker which of their guesses
// got warmer. One generic sentence, every time.
//
// A code dies after 5 wrong submissions. Guessing a 6-digit code therefore
// buys at most 5 tries in 10 minutes, then the door shuts.
//
// On success: the new password must pass the SAME rulebook as registration
// (min 8, not common, not the phone number), every session for the user is
// deleted (a stolen session does not survive a password change), the used
// code is marked consumed, and any login lockout on the phone is cleared so
// the user can actually sign in with their new password.

import { db } from '@/lib/db'
import { route, jsonOk, jsonError, parseBody } from '@/lib/api'
import { resetPasswordSchema, phoneCandidates, passwordProblem } from '@/lib/validation'
import { hashPassword } from '@/lib/auth'
import { resetCodeMatches } from '@/lib/sms'
import { clear, hit, RESET_WINDOW_MS } from '@/lib/rate-limit'
import { getClientIp } from '@/lib/client-ip'
import { NextResponse } from 'next/server'

const GENERIC_FAIL = 'That code did not work or has expired. Request a new code and try again.'
const RESET_SUBMIT_PHONE_MAX = Number(process.env.RATE_LIMIT_RESET_SUBMIT_PHONE_MAX ?? 10)
const RESET_SUBMIT_IP_MAX = Number(process.env.RATE_LIMIT_RESET_SUBMIT_IP_MAX ?? 30)

export async function POST(request: Request) {
  return route(async () => {
    const data = await parseBody(request, resetPasswordSchema)
    const candidates = phoneCandidates(data.phone)
    const phone = candidates[0]
    const ip = getClientIp(request)

    // Apply the same budgets to real and nonexistent numbers before lookup.
    // A caller cannot turn reset verification into an unlimited guessing or
    // CPU-amplification endpoint. Limits are separate from SMS-send budgets.
    if (!phone) return jsonError(400, GENERIC_FAIL)
    const phoneBudget = await hit(`reset:submit:phone:${phone}`, RESET_SUBMIT_PHONE_MAX, RESET_WINDOW_MS)
    const ipBudget = await hit(`reset:submit:ip:${ip}`, RESET_SUBMIT_IP_MAX, RESET_WINDOW_MS)
    if (!phoneBudget.ok || !ipBudget.ok) {
      const retryAfter = Math.max(phoneBudget.retryAfterSeconds, ipBudget.retryAfterSeconds)
      return NextResponse.json(
        { error: 'Too many reset attempts. Wait before trying again.' },
        { status: 429, headers: { 'retry-after': String(retryAfter) } },
      )
    }
    const user = candidates.length
      ? await db.user.findFirst({ where: { phone: { in: candidates } } })
      : null

    // Same generic answer when the account does not exist - no enumeration.
    if (!user) return jsonError(400, GENERIC_FAIL)

    const reset = await db.passwordReset.findFirst({
      where: { userId: user.id, usedAt: null, expiresAt: { gt: new Date() }, attempts: { lt: 5 } },
      orderBy: { createdAt: 'desc' },
    })
    if (!reset) return jsonError(400, GENERIC_FAIL)

    if (!resetCodeMatches(data.code, reset.codeHash)) {
      const now = new Date()
      // The attempt counter is incremented atomically. Once four failures have
      // already been recorded, the next failed request consumes/kills the code
      // in the SAME conditional write. Concurrent guesses cannot overwrite
      // each other's increments or leave a fifth-failed-attempt window open.
      const counted = await db.passwordReset.updateMany({
        where: {
          id: reset.id,
          userId: user.id,
          usedAt: null,
          expiresAt: { gt: now },
          attempts: { lt: 4 },
        },
        data: { attempts: { increment: 1 } },
      })
      if (counted.count === 0) {
        await db.passwordReset.updateMany({
          where: {
            id: reset.id,
            userId: user.id,
            usedAt: null,
            expiresAt: { gt: now },
            attempts: { gte: 4, lt: 5 },
          },
          data: { attempts: { increment: 1 }, usedAt: now },
        })
      }
      return jsonError(400, GENERIC_FAIL)
    }

    // Correct code - now the new password must earn its place.
    const pwProblem = passwordProblem(data.newPassword, user.phone)
    if (pwProblem) {
      // The code stays alive: fixing a weak password should not cost another SMS.
      return jsonError(400, pwProblem, { newPassword: pwProblem })
    }

    const resetCompleted = await db.$transaction(async (tx) => {
      // Claim the code with a compare-and-set transition. Only one concurrent
      // valid submission can consume it; expiry, lockout and prior use are
      // rechecked inside the transaction rather than trusted from the read.
      const consumed = await tx.passwordReset.updateMany({
        where: {
          id: reset.id,
          userId: user.id,
          usedAt: null,
          expiresAt: { gt: new Date() },
          attempts: { lt: 5 },
        },
        data: { usedAt: new Date() },
      })
      if (consumed.count !== 1) return false

      await tx.user.update({ where: { id: user.id }, data: { passwordHash: hashPassword(data.newPassword) } })
      // A password change revokes EVERYWHERE - every device, every channel.
      await tx.session.deleteMany({ where: { userId: user.id } })
      await tx.passwordReset.deleteMany({ where: { userId: user.id, usedAt: null } })
      return true
    })
    if (!resetCompleted) return jsonError(400, GENERIC_FAIL)

    // Clear any stale failed-login lockout so the new password works right away.
    for (const phone of candidates) await clear(`login:fail:${phone}`)

    return jsonOk({ ok: true, message: 'Password updated. Sign in with your new password.' })
  })
}
// Note: the old password is never compared here - the SMS code IS the proof
// of identity, and a user who forgot their password cannot repeat it.
