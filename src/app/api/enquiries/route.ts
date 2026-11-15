import { ApiError, jsonOk, requireUser, route } from '@/lib/api'
import { db } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  return route(async () => {
    const user = await requireUser()
    const items = await db.enquiry.findMany({
      where: { OR: [{ merchantId: user.id }, { shopperId: user.id }] },
      include: {
        listing: { select: { id: true, title: true, price: true, currency: true, photos: true, status: true } },
        merchant: { select: { id: true, profile: { select: { businessName: true } } } },
        shopper: { select: { id: true, name: true } },
        messages: { orderBy: { createdAt: 'desc' }, take: 1, select: { body: true, senderType: true, createdAt: true, deliveryStatus: true } },
      },
      orderBy: { lastMessageAt: 'desc' },
      take: 100,
    })
    return jsonOk({ enquiries: items.map((item) => ({
      id: item.id,
      status: item.status,
      role: item.merchantId === user.id ? 'MERCHANT' : 'SHOPPER',
      listing: item.listing,
      shopName: item.merchant.profile?.businessName || 'Mudaala shop',
      shopperName: item.merchantId === user.id ? null : item.shopper?.name || null,
      lastMessage: item.messages[0] || null,
      lastMessageAt: item.lastMessageAt,
    })) })
  })
}
