// Mudaala - administrator identity gate for deployment-level settings.
// Production privileges are bound to stable database user IDs, never to
// an unverified phone string. ADMIN_PHONES remains a development/test fixture
// fallback only when no ID allowlist is configured and NODE_ENV is not production.

import { ApiError, requireUser } from './api'
import { phoneCandidates } from './validation'
import type { User } from '@prisma/client'

function configuredAdminIds(env: Record<string, string | undefined>): string[] {
  return (env.ADMIN_USER_IDS ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
}

function adminPhoneSets(env: Record<string, string | undefined>): string[][] {
  return (env.ADMIN_PHONES ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => phoneCandidates(entry))
}

/**
 * Pure authorization decision, exported so production/development behavior
 * can be tested without changing process-global environment variables.
 * A configured ID list always takes precedence. Production fails closed when
 * it is missing/empty, even if a legacy phone allowlist is still present.
 */
export function isAdminIdentity(
  user: Pick<User, 'id' | 'phone'>,
  env: Record<string, string | undefined> = process.env,
): boolean {
  const ids = configuredAdminIds(env)
  if (ids.length > 0) return ids.includes(user.id)
  if (env.NODE_ENV === 'production') return false
  const phone = user.phone
  return adminPhoneSets(env).some((candidates) => candidates.includes(phone))
}

export async function requireAdmin(message = 'Only the shop admin can change deployment settings'): Promise<User> {
  const user = await requireUser('Sign in to view deployment settings')
  if (!isAdminIdentity(user)) throw new ApiError(403, message)
  return user
}

/** Boolean form for surfaces that branch instead of throwing - e.g. the
 * public listing API lets admins see their own hidden listings back. */
export function isAdminUser(user: Pick<User, 'id' | 'phone'>): boolean {
  return isAdminIdentity(user)
}
