import { createHash } from 'node:crypto'
import { z } from 'zod'
import { ApiError, jsonOk, parseBody, requireUser, route } from '@/lib/api'
import { db } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const BOT_USERNAME = 'MudaalaMerchantbot'
const settingKey = (userId: string) => 'telegram:merchant:' + userId
const identityKey = (telegramUserId: number) =>
  'telegram:user:' + createHash('sha256').update(String(telegramUserId)).digest('hex')

type MerchantTelegramSettings = {
  enabled?: boolean
  activatedAt?: string | null
  chatId?: number | null
}

async function readSettings(userId: string): Promise<MerchantTelegramSettings> {
  const record = await db.appSetting.findUnique({ where: { key: settingKey(userId) } })
  if (!record) return {}
  try { return JSON.parse(record.value) as MerchantTelegramSettings } catch { return {} }
}

export async function GET() {
  return route(async () => {
    const user = await requireUser()
    const settings = await readSettings(user.id)
    return jsonOk({
      connected: Boolean(settings.activatedAt && settings.chatId),
      enabled: settings.enabled === true && Boolean(settings.activatedAt && settings.chatId),
      activatedAt: settings.activatedAt ?? null,
      botUrl: 'https://t.me/' + BOT_USERNAME,
    })
  })
}

export async function PUT(request: Request) {
  return route(async () => {
    const user = await requireUser()
    const body = await parseBody(request, z.object({ enabled: z.boolean() }))
    const settings = await readSettings(user.id)
    if (body.enabled && (!settings.activatedAt || !settings.chatId)) {
      throw new ApiError(409, 'Open the Mudaala bot in Telegram and press Start before enabling Telegram enquiries.')
    }
    const next: MerchantTelegramSettings = {
      ...settings,
      enabled: body.enabled,
    }
    await db.appSetting.upsert({
      where: { key: settingKey(user.id) },
      create: { key: settingKey(user.id), value: JSON.stringify(next) },
      update: { value: JSON.stringify(next) },
    })
    return jsonOk({
      connected: Boolean(next.activatedAt && next.chatId),
      enabled: next.enabled === true && Boolean(next.activatedAt && next.chatId),
      activatedAt: next.activatedAt ?? null,
      botUrl: 'https://t.me/' + BOT_USERNAME,
    })
  })
}

// Used only by the authenticated Telegram webhook after it has verified the
// Telegram update. The numeric chat ID remains server-side and is never public.
export async function recordTelegramActivation(telegramUserId: number, chatId: number): Promise<void> {
  const mapping = await db.appSetting.findUnique({ where: { key: identityKey(telegramUserId) } })
  if (!mapping) return
  let linked: { userId?: unknown } = {}
  try { linked = JSON.parse(mapping.value) as typeof linked } catch { return }
  if (typeof linked.userId !== 'string') return
  const key = settingKey(linked.userId)
  const current = await readSettings(linked.userId)
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
