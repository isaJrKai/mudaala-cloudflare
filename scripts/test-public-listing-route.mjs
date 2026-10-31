import { PrismaClient } from '@prisma/client'

const base = (process.env.APP_URL || 'http://localhost:3001').replace(/\/$/, '')
const db = new PrismaClient()

async function listingPage(id) {
  const path = `/l/${encodeURIComponent(id)}`
  const response = await fetch(`${base}${path}`, {
    headers: {
      accept: 'text/html',
      'x-mudaala-path': path,
    },
  })
  return { response, html: await response.text() }
}

async function main() {
  let listingId = ''
  let failure = null

  try {
    // This is a public-page regression, not an authentication test. Create a
    // disposable fixture with the same restricted runtime DB role used by the
    // app, then exercise the unauthenticated public route. Avoid calling the
    // login API here: production-mode CI intentionally has no Cloudflare
    // Durable Object binding, and its fail-closed auth limiter must stay on.
    const owner = await db.user.findFirst({
      where: { phone: '+256772123456', isSeed: true },
      select: { id: true, phone: true },
    })
    if (!owner) {
      throw new Error('CI fixture owner is missing; the disposable database seed did not run')
    }

    const title = `CI public listing route regression ${Date.now()}`
    const photos = Array.from(
      { length: 4 },
      (_, index) => `https://example.test/mudaala-ci-${Date.now()}-${index}.jpg`,
    )
    const listing = await db.listing.create({
      data: {
        userId: owner.id,
        type: 'OFFER',
        title,
        description: 'Temporary CI fixture for the public listing route.',
        category: 'services',
        price: null,
        currency: 'UGX',
        priceNegotiable: true,
        unit: null,
        quantity: null,
        country: 'UG',
        county: 'Kampala',
        area: 'Nakasero',
        contactPhone: owner.phone,
        contactWhatsapp: null,
        photos: JSON.stringify(photos),
        isSeed: true,
        status: 'ACTIVE',
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    })
    listingId = listing.id

    const activePage = await listingPage(listingId)
    if (activePage.response.status !== 200 || !activePage.html.includes(title)) {
      throw new Error(`Active services OFFER with null price did not render: HTTP ${activePage.response.status}`)
    }

    await db.listing.delete({ where: { id: listingId } })
    listingId = ''

    const gonePage = await listingPage(listing.id)
    if (
      gonePage.response.status !== 404 ||
      !gonePage.html.includes('This ad is no longer available')
    ) {
      throw new Error(`Deleted public listing did not render the listing 404 boundary: HTTP ${gonePage.response.status}`)
    }

    console.log(
      'Public listing route regression passed: active services OFFER with null price and four photos → HTTP 200; deleted listing → HTTP 404.',
    )
  } catch (error) {
    failure = error
  } finally {
    if (listingId) {
      await db.listing.deleteMany({ where: { id: listingId } }).catch((error) => {
        if (!failure) failure = error
      })
    }
    await db.$disconnect().catch((error) => {
      if (!failure) failure = error
    })
  }

  if (failure) throw failure
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
