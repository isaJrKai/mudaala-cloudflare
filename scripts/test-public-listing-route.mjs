const base = (process.env.APP_URL || 'http://localhost:3001').replace(/\/$/, '')
const edgeIp = '198.51.100.207'
const origin = base
const requestHeaders = {
  'content-type': 'application/json',
  'cf-connecting-ip': edgeIp,
  origin,
}

async function readJson(response) {
  return response.json().catch(() => null)
}

async function main() {
  const login = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: requestHeaders,
    body: JSON.stringify({ phone: '0772123456', password: 'demo1234' }),
  })
  if (!login.ok) {
    throw new Error(`CI fixture login failed: HTTP ${login.status}`)
  }

  const cookie = login.headers.get('set-cookie')?.split(';')[0] || ''
  if (!cookie) throw new Error('CI fixture login did not issue its httpOnly session cookie')
  const authHeaders = { ...requestHeaders, cookie }

  const title = `CI public listing route regression ${Date.now()}`
  let listingId = ''
  let failure = null

  try {
    const created = await fetch(`${base}/api/listings`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
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
        contactPhone: '0772123456',
        contactWhatsapp: null,
      }),
    })
    const createdBody = await readJson(created)
    listingId = createdBody?.listing?.id || ''
    if (
      created.status !== 201 ||
      !listingId ||
      createdBody?.listing?.status !== 'ACTIVE' ||
      createdBody?.listing?.type !== 'OFFER' ||
      createdBody?.listing?.category !== 'services' ||
      createdBody?.listing?.price !== null ||
      createdBody?.listing?.unit !== null ||
      createdBody?.listing?.quantity !== null
    ) {
      throw new Error(`Could not create the expected active no-price services fixture: HTTP ${created.status}`)
    }

    const path = `/l/${listingId}`
    const livePage = await fetch(`${base}${path}`, {
      headers: { accept: 'text/html', 'x-mudaala-path': path },
    })
    const liveHtml = await livePage.text()
    if (livePage.status !== 200 || !liveHtml.includes(title)) {
      throw new Error(`Active services OFFER with null price did not render: HTTP ${livePage.status}`)
    }

    const removed = await fetch(`${base}/api/listings/${encodeURIComponent(listingId)}`, {
      method: 'DELETE',
      headers: authHeaders,
    })
    if (!removed.ok) {
      throw new Error(`Could not remove disposable listing fixture: HTTP ${removed.status}`)
    }

    const gonePage = await fetch(`${base}${path}`, {
      headers: { accept: 'text/html', 'x-mudaala-path': path },
    })
    const goneHtml = await gonePage.text()
    if (gonePage.status !== 404 || !goneHtml.includes('This ad is no longer available')) {
      throw new Error(`Deleted public listing did not render the listing 404 boundary: HTTP ${gonePage.status}`)
    }

    console.log('Public listing route regression passed: active services OFFER with null price → HTTP 200; deleted listing → HTTP 404.')
  } catch (error) {
    failure = error
  } finally {
    if (listingId) {
      const cleanup = await fetch(`${base}/api/listings/${encodeURIComponent(listingId)}`, {
        method: 'DELETE',
        headers: authHeaders,
      }).catch(() => null)
      if (cleanup && cleanup.status !== 200 && cleanup.status !== 404 && !failure) {
        failure = new Error(`Disposable listing cleanup returned HTTP ${cleanup.status}`)
      }
    }
  }

  if (failure) throw failure
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
