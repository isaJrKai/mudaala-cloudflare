import type { Metadata } from 'next'
import { StandaloneShowroom } from '@/components/showroom/standalone-showroom'

type Props = { params: Promise<{ slug: string }> }

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  const label = slug.split('-').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ')
  const title = `${label} | Mudaala`
  const description = `Discover ${label} on Mudaala. Explore the shop's products and contact the seller directly.`
  return {
    title,
    description,
    alternates: { canonical: `/showroom/${slug}` },
    robots: { index: true, follow: true },
    openGraph: {
      type: 'website',
      title,
      description,
      url: `https://mudaala.store/showroom/${slug}`,
      siteName: 'Mudaala',
    },
    twitter: { card: 'summary_large_image', title, description },
  }
}

export default async function ShowroomPage({ params }: Props) {
  const { slug } = await params
  return <StandaloneShowroom slug={slug} />
}
