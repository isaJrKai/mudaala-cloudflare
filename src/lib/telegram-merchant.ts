import { createHash } from 'node:crypto'
import { db } from '@/lib/db'

type MerchantTelegramSettings = {
  enabled?: boolean
  activatedAt?: string | null
  chatId?: number | null
}

const settingKey = (userId: string) => 'telegram:merchant:' + userId
const identityKey = (telegramUserId: number) =>
  'telegram:user:' + createHash('sha256').update(String(telegramUserId)).digest('hex')

export async function recordTelegramActivation(telegramUserId: number, chatId: number): Promise<void> {
  const mapping = await db.appSetting.findUnique({ where: { key: identityKey(telegramUserId) } })
  if (!mapping) return
  let linked: { userId?: unknown } = {}
  try { linked = JSON.parse(mapping.value) as typeof linked } catch { return }
  if (typeof linked.userId !== 'string') return
  const key = settingKey(linked.userId)
  const existing = await db.appSetting.findUnique({ where: { key } })
  let current: MerchantTelegramSettings = {}
  try { current = JSON.parse(existing?.value || '{}') as MerchantTelegramSettings } catch { /* reset malformed settings safely */ }
  const next: MerchantTelegramSettings = {
    ...current,
    chatId,
    activatedAt: current.activatedAt ?? new Date().toISOString(),
  }
  await db.appSetting.upsert({
    where: { key },
    create: { key, value: JSON.stringify(next) },
    update: { value: JSON.stringify(next) },
  })
}
