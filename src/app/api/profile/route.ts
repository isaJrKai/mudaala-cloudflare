import { route, jsonOk, parseBody, requireUser, ApiError } from '@/lib/api'
import { businessProfileSchema, normalizePhone, type CountryKey } from '@/lib/validation'
import { db } from '@/lib/db'
import { deliverPushNotification } from '@/lib/push-delivery'
import { shopChecklistFor, shopChecklistComplete, generateShopCode } from '@/lib/shop'

export async function GET() {
  return route(async () => {
    const user = await requireUser()
    const profile = await db.businessProfile.findUnique({ where: { userId: user.id } })
    // The honest "verify your shop" state: what the seller has actually filled
    // in. No platform vetting is claimed - completeness is the whole story.
    const checklist = shopChecklistFor(profile)
    return jsonOk({ profile, checklist, complete: shopChecklistComplete(checklist) })
  })
}

// Upsert own business profile. The businessName here is the seller's SHOP
// NAME - the name buyers see on every listing. No verification claims are
// made anywhere: the verified flag stays false until a real process exists.
export async function PUT(request: Request) {
  return route(async () => {
    const user = await requireUser()
    const data = await parseBody(request, businessProfileSchema)

    // Contact numbers follow the account's country.
    const country = (user.country ?? 'UG') as CountryKey
    const phone = normalizePhone(data.phone, country)
    if (!phone) {
      throw new ApiError(400, 'Enter a valid phone number for your country', {
        phone: 'Invalid phone number for your country',
      })
    }
    const whatsapp = data.whatsapp ? normalizePhone(data.whatsapp, country) : null
    if (data.whatsapp && !whatsapp) {
      throw new ApiError(400, 'Enter a valid WhatsApp number for your country', {
        whatsapp: 'Invalid WhatsApp number for your country',
      })
    }

    const existingProfile = await db.businessProfile.findUnique({ where: { userId: user.id }, select: { id: true } })
    const profile = await db.businessProfile.upsert({
      where: { userId: user.id },
      create: { userId: user.id, ...data, phone, whatsapp, verified: false, shopCode: await generateShopCode() },
      // On update the shop code is deliberately untouched: it is the shop's
      // permanent identity, never recycled or re-rolled.
      update: { ...data, phone, whatsapp, verified: false },
    })

    if (!existingProfile) {
      const dedupeKey = `growth:welcome:${user.id}`
      await Promise.all([
        db.merchantGrowthEvent.createMany({
          data: [{ userId: user.id, eventType: 'SHOP_CREATED', entityId: profile.id, idempotencyKey: `shop-created:${user.id}` }],
          skipDuplicates: true,
        }),
        db.notification.createMany({
          data: [{
            userId: user.id,
            type: 'GROWTH_WELCOME',
            category: 'GROWTH',
            priority: 'HIGH',
            title: `Welcome to Mudaala, ${profile.businessName}`,
            body: 'Your shop is open. Add or improve your products, upload clear photos and share your shop poster so customers can find you.',
            actionUrl: `/#/shop/${encodeURIComponent(user.id)}`,
            actionLabel: 'Open my shop',
            source: 'SHOP_CREATED',
            dedupeKey,
          }],
          skipDuplicates: true,
        }),
      ])
      const welcome = await db.notification.findUnique({
        where: { userId_dedupeKey: { userId: user.id, dedupeKey } },
        select: { id: true, userId: true, title: true, body: true, actionUrl: true, actionLabel: true, priority: true },
      })
      if (welcome) await deliverPushNotification(user.id, welcome).catch((error) =>
        console.warn('[growth-coach] welcome push delivery failed', error instanceof Error ? error.message : 'unknown error'),
      )
    }
    return jsonOk({ profile })
  })
}
