import type { Metadata } from 'next'
import { ShowroomPreviewShell } from '@/components/showroom/showroom-preview-shell'

type Props = { params: Promise<{ slug: string }> }

export const metadata: Metadata = { title: 'Preview your showroom | Mudaala', robots: { index: false, follow: false } }
export const dynamic = 'force-dynamic'

export default async function ShowroomPreviewPage({ params }: Props) {
  const { slug } = await params
  return <ShowroomPreviewShell slug={slug} />
}
