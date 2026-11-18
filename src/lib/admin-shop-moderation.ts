import type { Prisma } from '@prisma/client'

type Transaction = Prisma.TransactionClient
type Action = 'HIDE' | 'RESTORE'

export async function applyShopModeration(
  tx: Transaction,
  input: { profileId: string; actorId: string; action: Action; reason: string },
): Promise<{ ok: true; status: 'ACTIVE' | 'HIDDEN'; changed: boolean } | { ok: false; error: string }> {
  const profile = await tx.businessProfile.findUnique({
    where: { id: input.profileId },
    select: { id: true, userId: true, businessName: true, moderationStatus: true },
  })
  if (!profile) return { ok: false, error: 'This shop no longer exists' }

  if (input.action === 'RESTORE') {
    const activeViolation = await tx.policyViolation.findFirst({
      where: { targetType: 'SHOP', targetId: profile.id, reversedAt: null },
      select: { id: true },
    })
    if (activeViolation) {
      return { ok: false, error: 'Overturn the confirmed shop violation before restoring this shop' }
    }
    if (profile.moderationStatus === 'ACTIVE') return { ok: true, status: 'ACTIVE', changed: false }

    await tx.businessProfile.update({
      where: { id: profile.id },
      data: { moderationStatus: 'ACTIVE', moderatedAt: null, moderationReason: null, moderatedBy: null },
    })
    await tx.notification.create({
      data: {
        userId: profile.userId,
        type: 'SHOP_RESTORED',
        title: 'Your shop is visible again',
        body: 'Mudaala has restored your shop after review. Your public shop page, products, collections and showrooms are visible again.',
      },
    })
    await tx.auditLog.create({
      data: {
        actorId: input.actorId,
        action: 'RESTORE_SHOP',
        targetType: 'SHOP',
        targetId: profile.id,
        reason: input.reason,
      },
    })
    return { ok: true, status: 'ACTIVE', changed: true }
  }

  if (profile.moderationStatus === 'HIDDEN') return { ok: true, status: 'HIDDEN', changed: false }
  await tx.businessProfile.update({
    where: { id: profile.id },
    data: {
      moderationStatus: 'HIDDEN',
      moderatedAt: new Date(),
      moderationReason: input.reason,
      moderatedBy: input.actorId,
    },
  })
  await tx.notification.create({
    data: {
      userId: profile.userId,
      type: 'SHOP_HIDDEN',
      title: 'Your shop has been hidden from Mudaala',
      body: 'Mudaala has temporarily hidden your public shop, products, collections and showrooms while this decision is reviewed. Reason: ' + input.reason + '. To appeal, open “Report a bug / Send feedback” and choose “Appeal”.',
    },
  })
  await tx.auditLog.create({
    data: {
      actorId: input.actorId,
      action: 'HIDE_SHOP',
      targetType: 'SHOP',
      targetId: profile.id,
      reason: input.reason,
    },
  })
  return { ok: true, status: 'HIDDEN', changed: true }
}
