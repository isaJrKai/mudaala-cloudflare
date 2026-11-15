import { jsonOk, requireUser, route } from '@/lib/api'
import { db } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  return route(async () => {
    const user = await requireUser()
    const items = await db.enquiry.findMany({
      where: { OR: [{ merchantId: user.id }, { shopperId: user.id }] },
      include: {
        listing: { select: { id: true, title: true, status: true } },
        merchant: { select: { profile: { select: { businessName: true } } } },
        messages: { orderBy: { createdAt: 'desc' }, take: 1, select: { body: true, senderType: true, createdAt: true, deliveryStatus: true } },
      },
      orderBy: { lastMessageAt: 'desc' },
      take: 100,
    })
    return jsonOk({ enquiries: items.map((item) => ({
      id: item.id,
      status: item.status,
      followUpConsentAt: item.followUpConsentAt,
      role: item.merchantId === user.id ? 'MERCHANT' : 'SHOPPER',
      listing: item.listing,
      shopName: item.merchant.profile?.businessName || 'Mudaala shop',
      lastMessage: item.messages[0] || null,
      lastMessageAt: item.lastMessageAt,
    })) })
  })
}
