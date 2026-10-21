import { route, jsonOk, parseBody, requireUser } from '@/lib/api'
import { db } from '@/lib/db'
import { SHOP_OWNER_INCLUDE, serializeListing } from '@/lib/listings'
import { productCollectionCreateSchema } from '@/lib/product-collections'

export async function GET() {
  return route(async () => {
    const user = await requireUser()
    const collections = await db.productCollection.findMany({
      where: { userId: user.id },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      include: {
        items: {
          where: { listing: { is: { userId: user.id } } },
          orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
          include: { listing: { include: SHOP_OWNER_INCLUDE } },
        },
      },
    })
    return jsonOk({
      collections: collections.map((collection) => ({
        ...collection,
        items: collection.items.map((item) => ({ ...item, listing: serializeListing(item.listing) })),
      })),
    })
  })
}

export async function POST(request: Request) {
  return route(async () => {
    const user = await requireUser()
    const data = await parseBody(request, productCollectionCreateSchema)
    const sortOrder = data.sortOrder ?? await db.productCollection.count({ where: { userId: user.id } })
    const collection = await db.productCollection.create({
      data: {
        userId: user.id,
        title: data.title,
        description: data.description?.trim() || null,
        coverPhotoUrl: data.coverPhotoUrl ?? null,
        startsAt: data.startsAt ? new Date(data.startsAt) : null,
        endsAt: data.endsAt ? new Date(data.endsAt) : null,
        isActive: data.isActive ?? true,
        sortOrder,
      },
    })
    return jsonOk({ collection: { ...collection, items: [] } }, 201)
  })
}
