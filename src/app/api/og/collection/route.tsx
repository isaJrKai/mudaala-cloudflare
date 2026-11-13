import { ImageResponse } from 'next/og'

export const runtime = 'edge'

const WIDTH = 1200
const HEIGHT = 630
const CREAM = '#f9f7f4'
const EDGE = '#e8e3d9'
const GREEN = '#205335'
const MUTED = '#6b675e'

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams
  const title = (params.get('title') || 'A collection of products').replace(/\s+/g, ' ').trim().slice(0, 100)
  const shop = (params.get('shop') || 'Local businesses').replace(/\s+/g, ' ').trim().slice(0, 80)

  const image = new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: CREAM }}>
        <div style={{ width: WIDTH - 64, height: HEIGHT - 64, display: 'flex', flexDirection: 'column', justifyContent: 'center', border: `2px solid ${EDGE}`, borderRadius: 24, padding: '64px 76px' }}>
          <div style={{ display: 'flex', fontSize: 42, fontWeight: 700, color: GREEN }}>mudaala</div>
          <div style={{ display: 'flex', width: 64, height: 5, borderRadius: 3, marginTop: 24, backgroundColor: GREEN }} />
          <div style={{ display: 'flex', marginTop: 32, fontSize: 54, fontWeight: 700, lineHeight: 1.12, color: GREEN, overflow: 'hidden' }}>{title}</div>
          <div style={{ display: 'flex', marginTop: 24, fontSize: 28, color: MUTED }}>A collection from {shop}</div>
        </div>
      </div>
    ),
    { width: WIDTH, height: HEIGHT },
  )
  return new Response(image.body, {
    headers: {
      'content-type': image.headers.get('content-type') ?? 'image/png',
      'cache-control': 'public, max-age=3600, s-maxage=3600',
    },
  })
}
