// Next.js proxy (the layer formerly known as middleware).
//
// Two jobs:
//
// 1. CSRF protection - every state-changing API request (POST/PATCH/PUT/
//    DELETE) that carries an Origin header must come from this deployment's
//    own host. Browsers attach Origin to cross-site requests, so a foreign
//    site can no longer make a victim's cookie ride along on a write. The
//    check is strictly stronger than "cookie-authenticated only": a foreign
//    Origin is rejected even when the request also carries a Bearer token,
//    and requests without an Origin (server-to-server clients, the test
//    suite) pass - those are not browsers and cannot be forged this way.
//
// 2. The public pages /l/[id] and /s/[code] have segment not-found boundaries
//    that receive no route params. When a gone ad 404s, the boundary still
//    needs to know WHICH ad the URL pointed at, so it can offer similar live
//    ads from the same category. The proxy stamps the request path into the
//    headers; the not-found components read it with headers().

import { NextResponse, type NextRequest } from 'next/server'

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

function parseOrigin(rawOrigin: string): URL | null {
  try {
    const origin = new URL(rawOrigin)
    if ((origin.protocol !== 'https:' && origin.protocol !== 'http:') || !origin.host) return null
    return origin
  } catch {
    return null
  }
}

// Deployment hosts the Origin check accepts beyond the Host actually seen on
// the request. Needed because the sandbox preview's edge rewrites Host to an
// internal address and sends no x-forwarded-host, so a genuinely
// same-deployment login arrives looking foreign (the seller's browser really
// is talking to https://preview-…, the app just never sees that name).
// Entries are comma-separated; an entry starting with a dot matches the
// whole suffix (cookie-Domain semantics: ".space-z.ai" trusts that suffix
// and its subdomains). Leaving this unset changes nothing for deployments
// whose proxy preserves Host - the foreign-Origin block stays exactly as
// strict as before.
function trustedHostEntries(): string[] {
  return (process.env.CSRF_TRUSTED_HOSTS ?? '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)
}

function originOwnsDeployment(origin: URL, requestOrigin: string): boolean {
  // Exact origin match includes scheme and port, not just host. Never trust
  // X-Forwarded-Host here: unless an edge explicitly overwrites it, a client
  // can supply that header and make a foreign Origin appear same-host.
  if (origin.origin.toLowerCase() === requestOrigin.toLowerCase()) return true

  // The preview gateway legitimately rewrites the request Host. Its public
  // origin is allowed only through the explicit host allowlist and HTTPS.
  if (origin.protocol !== 'https:') return false
  const originHost = origin.host.toLowerCase()
  return trustedHostEntries().some((entry) =>
    entry.startsWith('.') ? originHost.endsWith(entry) || originHost === entry.slice(1) : originHost === entry,
  )
}

export default function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  if (pathname.startsWith('/api/') && !SAFE_METHODS.has(request.method)) {
    const rawOrigin = request.headers.get('origin')
    const fetchSite = request.headers.get('sec-fetch-site')?.toLowerCase()

    if (rawOrigin !== null) {
      // A present but opaque/malformed Origin (including "null") is not the
      // same as a non-browser request with no Origin header.
      const origin = parseOrigin(rawOrigin)
      if (!origin || !originOwnsDeployment(origin, request.nextUrl.origin)) {
        return NextResponse.json(
          { error: 'This request was blocked for your protection. It did not come from Mudaala' },
          { status: 403 },
        )
      }
      // Fetch Metadata is a second signal. A cross-site request is allowed
      // only when its public origin is explicitly trusted for the preview edge.
      if (fetchSite === 'cross-site' && !trustedHostEntries().some((entry) => {
        const host = origin.host.toLowerCase()
        return entry.startsWith('.') ? host.endsWith(entry) || host === entry.slice(1) : host === entry
      })) {
        return NextResponse.json(
          { error: 'This request was blocked for your protection. It did not come from Mudaala' },
          { status: 403 },
        )
      }
    } else if (fetchSite === 'cross-site') {
      // A browser says the request is cross-site but supplies no Origin to
      // validate. Reject it; server-to-server clients without Fetch Metadata
      // continue to work.
      return NextResponse.json(
        { error: 'This request was blocked for your protection. It did not come from Mudaala' },
        { status: 403 },
      )
    }
  }

  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('x-mudaala-path', pathname)
  return NextResponse.next({ request: { headers: requestHeaders } })
}

export const config = {
  matcher: ['/l/:path*', '/s/:path*', '/api/:path*'],
}
