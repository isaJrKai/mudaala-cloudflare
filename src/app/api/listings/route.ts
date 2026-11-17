import { NextRequest } from 'next/server'
import { route, jsonOk, parseBody, requireSeller, ApiError } from '@/lib/api'
import { getClientIp } from '@/lib/client-ip'
import { listingCreateSchema, listingQuerySchema } from '@/lib/validation'
import { db } from '@/lib/db'
import { searchListings, serializeListing } from '@/lib/listings'
import { publishListingForSeller } from '@/lib/listing-publisher'

// Public search - filter, sort and paginate in the database, not the browser.
export async function GET(request: NextRequest) {
  return route(async () => {
    const raw = Object.fromEntries(request.nextUrl.searchParams.entries())
    const cleaned = Object.fromEntries(
      Object.entries(raw).filter(([, v]) => v !== '' && v !== 'any'),
    )
    // Numeric coercion for query params arriving as strings.
    const coerced: Record<string, unknown> = { ...cleaned }
    for (const key of ['minPrice', 'maxPrice', 'page', 'pageSize', 'lat', 'lng']) {
      if (typeof coerced[key] === 'string' && (coerced[key] as string) !== '') {
        coerced[key] = Number(coerced[key])
      }
    }
    const query = listingQuerySchema.safeParse(coerced)
    if (!query.success) {
      throw new ApiError(400, 'Invalid search filters')
    }
    const result = await searchListings({ query: query.data })
    return jsonOk(result)
  })
}

// Publish a listing. Ownership and every field are validated server-side.
export async function POST(request: Request) {
  return route(async () => {
    const user = await requireSeller('Sign in to publish a listing')

    const data = await parseBody(request, listingCreateSchema)
    const listing = await publishListingForSeller({
      seller: user,
      data,
      ipKey: getClientIp(request),
    })

    return jsonOk({ listing: serializeListing(listing) }, 201)
  })
}
