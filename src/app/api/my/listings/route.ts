import { route, jsonOk, requireUser } from '@/lib/api'
import { db } from '@/lib/db'
import { serializeListing } from '@/lib/listings'
import { visibleListingStatus } from '@/lib/listing-visibility'

// The signed-in user's own listings - every status, expiry truthfully shown.
export async function GET() {
  return route(async () => {
    const user = await requireUser()
    const listings = await db.listing.findMany({
      where: { userId: user.id },
      orderBy: { refreshedAt: 'desc' },
    })
    const now = new Date()
    return jsonOk({ listings: listings.map((listing) => serializeListing({
      ...listing,
      // Seller reads stay truthful without making a write/notification pass.
      status: visibleListingStatus(listing.status, listing.expiresAt, now) as typeof listing.status,
    })) })
  })
}
