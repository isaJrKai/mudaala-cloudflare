import { z } from 'zod'
import { route, jsonOk, parseBody, requireUser, ApiError } from '@/lib/api'
import { db } from '@/lib/db'
import { CATEGORY_KEYS, findProhibitedItem } from '@/lib/constants'
import { containsMarketplaceEmoji } from '@/lib/validation'

type Params = { params: Promise<{ id: string }> }

const showroomItemSchema = z.object({
  title: z.string().trim().min(4, 'Title must be at least 4 characters').max(120, 'Title must be 120 characters or fewer')
    .refine((value) => !containsMarketplaceEmoji(value), 'Please use words in the product title, not emojis.'),
  description: z.string().trim().min(20, 'Add at least 20 characters describing the item').max(1000, 'Description must be 1000 characters or fewer')
    .refine((value) => !containsMarketplaceEmoji(value), 'Please use words in the description, not emojis.'),
  category: z.enum(CATEGORY_KEYS as [string, ...string[]], { message: 'Choose a category' }),
  price: z.number().min(0).max(100_000_000).nullable(),
  availability: z.enum(['IN_STOCK', 'AVAILABLE_ON_ORDER', 'SAMPLE_ONLY']),
  photoUrl: z.string().trim().max(500).nullable().refine(
    (value) => value === null || value.startsWith('/uploads/') || /^https?:\/\/\S+$/i.test(value),
    'Use an uploaded photo or a valid photo URL.',
  ),
})

// A showroom is part of the shop, but it is not an ordinary marketplace
// listing. These records never feed Browse, saved searches, or offer counts.
export async function POST(request: Request, { params }: Params) {
  return route(async () => {
    const { id } = await params
    const user = await requireUser('Sign in as the shop owner to manage this showroom')
    if (user.id !== id) throw new ApiError(403, 'Only this shop owner can add showroom items')

    const data = await parseBody(request, showroomItemSchema)
    const banned = findProhibitedItem(data.title, data.description)
    if (banned) {
      throw new ApiError(400, banned.message, {
        title: 'This showroom item cannot be published - ' + banned.label.toLowerCase(),
      })
    }
    const count = await db.showroomItem.count({ where: { userId: user.id } })
    if (count >= 100) throw new ApiError(409, 'This showroom has reached its 100-item limit')

    const item = await db.showroomItem.create({
      data: {
        userId: user.id,
        title: data.title,
        description: data.description,
        category: data.category,
        price: data.price,
        currency: 'UGX',
        availability: data.availability,
        photoUrl: data.photoUrl,
      },
      select: {
        id: true,
        title: true,
        description: true,
        category: true,
        price: true,
        currency: true,
        availability: true,
        photoUrl: true,
        createdAt: true,
      },
    })
    return jsonOk({ item: { ...item, createdAt: item.createdAt.toISOString() } }, 201)
  })
}
