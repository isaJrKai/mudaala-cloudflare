import type { Metadata } from 'next'
import { StandaloneShowroom } from '@/components/showroom/standalone-showroom'
import { db, withRequestDb } from '@/lib/db'

type Props = { params: Promise<{ slug: string }> }

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  const showroom = await withRequestDb(() => db.shopShowroom.findFirst({
    where: { slug, status: 'PUBLISHED', publishedAt: { lte: new Date() } },
    select: {
      title: true, headline: true, introduction: true, coverPhotoUrl: true, photos: true,
      user: { select: { profile: { select: { businessName: true } } } },
    },
  }))
  if (!showroom) return { title: 'Showroom unavailable | Mudaala', robots: { index: false, follow: false } }

  let gallery: string[] = []
  try {
    const parsed: unknown = JSON.parse(showroom.photos)
    if (Array.isArray(parsed)) gallery = parsed.filter((item): item is string => typeof item === 'string')
  } catch { /* no gallery photo */ }

  const shopName = showroom.user.profile?.businessName || 'Independent shop'
  const title = showroom.headline?.trim() || showroom.title
  const description = showroom.introduction?.trim() || `Explore the ${showroom.title} showroom from ${shopName}. Browse selected products and contact the shop directly.`
  const image = showroom.coverPhotoUrl || gallery[0]
  const url = `https://mudaala.store/showroom/${slug}`
  const images = image ? [{ url: image, alt: `${shopName} — ${showroom.title}` }] : []

  return {
    title: `${title} | ${shopName}`,
    description,
    alternates: { canonical: url },
    robots: { index: true, follow: true },
    openGraph: { type: 'website', title, description, url, siteName: shopName, images },
    twitter: { card: 'summary_large_image', title, description, images: image ? [image] : [] },
  }
}

export default async function ShowroomPage({ params }: Props) {
  const { slug } = await params
  return <StandaloneShowroom slug={slug} />
}
