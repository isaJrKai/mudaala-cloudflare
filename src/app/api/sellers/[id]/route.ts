import { NextRequest } from 'next/server'
import { route, jsonOk, ApiError } from '@/lib/api'
import { db } from '@/lib/db'
import { expireOverdueListings, serializeListing } from '@/lib/listings'

type Params = { params: Promise<{ id: string }> }

// Public seller storefront - the seller's named shop.
// One account, one sign-in: the "shop" is the business profile attached to the
// same account, not a separate login. Shows only genuinely ACTIVE listings.
export async function GET(_request: NextRequest, { params }: Params) {
  return route(async () => {
    const { id } = await params
    await expireOverdueListings()

    const seller = await db.user.findUnique({
      where: { id },
      select: { id: true, name: true, createdAt: true, country: true },
    })
    if (!seller) throw new ApiError(404, 'This shop does not exist')

    // This legacy public endpoint must not spread the full profile row. Keep its
    // public storefront fields, but never serialize internal ownership,
    // verification, seed, or database bookkeeping fields.
    const profile = await db.businessProfile.findUnique({
      where: { userId: id },
      select: {
        businessName: true,
        photoUrl: true,
        coverPhotoUrl: true,
        category: true,
        description: true,
        county: true,
        area: true,
        websiteUrl: true,
        phone: true,
        whatsapp: true,
        hours: true,
        shopCode: true,
        momoMerchantCode: true,
        momoNetwork: true,
        momoMerchantName: true,
      },
    })

    const listings = await db.listing.findMany({
      where: { userId: id, status: 'ACTIVE' },
      orderBy: { refreshedAt: 'desc' },
      take: 50,
    })

    return jsonOk({
      seller,
      profile,
      listings: listings.map(serializeListing),
    })
  })
}
