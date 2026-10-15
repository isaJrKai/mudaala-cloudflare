import { LegalPage, legalPageMetadata } from '@/components/commerce/legal-page'
import { SiteFooter } from '@/components/commerce/site-footer'

export const metadata = legalPageMetadata({
  file: 'business-terms.md',
  title: 'Business Terms',
  description: 'Practical terms for businesses publishing products and services on Mudaala.',
})

export default async function BusinessTermsPage() {
  return (
    <>
      <LegalPage
        file="business-terms.md"
        title="Business Terms"
        description="For shops, service providers and other businesses using Mudaala."
      />
      <SiteFooter />
    </>
  )
}
