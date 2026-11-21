-- Mudaala Most Valuable Partner (MVP) network.
-- Offers, partner agreements, referrals and seller-reported commissions are
-- application-owned records. The Worker runtime is the only database writer.

CREATE TABLE "AffiliateOffer" (
  "id" TEXT NOT NULL,
  "merchantId" TEXT NOT NULL,
  "listingId" TEXT NOT NULL,
  "commissionType" TEXT NOT NULL,
  "commissionValue" DECIMAL(14,2) NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'UGX',
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "applicationMode" TEXT NOT NULL DEFAULT 'APPROVAL',
  "attributionWindowDays" INTEGER NOT NULL DEFAULT 14,
  "termsText" TEXT NOT NULL DEFAULT '',
  "startsAt" TIMESTAMP(3),
  "endsAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AffiliateOffer_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AffiliateOffer_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "AffiliateOffer_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "AffiliateOffer_commissionType_check" CHECK ("commissionType" IN ('PERCENT','FIXED_PER_UNIT')),
  CONSTRAINT "AffiliateOffer_commissionValue_check" CHECK ("commissionValue" > 0),
  CONSTRAINT "AffiliateOffer_applicationMode_check" CHECK ("applicationMode" IN ('OPEN','APPROVAL')),
  CONSTRAINT "AffiliateOffer_attributionWindowDays_check" CHECK ("attributionWindowDays" BETWEEN 1 AND 30)
);
CREATE INDEX "AffiliateOffer_merchantId_status_updatedAt_idx" ON "AffiliateOffer"("merchantId","status","updatedAt");
CREATE INDEX "AffiliateOffer_listingId_status_idx" ON "AffiliateOffer"("listingId","status");
CREATE INDEX "AffiliateOffer_status_startsAt_endsAt_idx" ON "AffiliateOffer"("status","startsAt","endsAt");

CREATE TABLE "AffiliatePartnership" (
  "id" TEXT NOT NULL,
  "offerId" TEXT NOT NULL,
  "mvpId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "acceptedCommissionType" TEXT NOT NULL,
  "acceptedCommissionValue" DECIMAL(14,2) NOT NULL,
  "acceptedCurrency" TEXT NOT NULL,
  "acceptedTermsText" TEXT NOT NULL DEFAULT '',
  "acceptedAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AffiliatePartnership_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AffiliatePartnership_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "AffiliateOffer"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "AffiliatePartnership_mvpId_fkey" FOREIGN KEY ("mvpId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "AffiliatePartnership_status_check" CHECK ("status" IN ('PENDING','APPROVED','REJECTED','PAUSED','REVOKED'))
);
CREATE UNIQUE INDEX "AffiliatePartnership_offerId_mvpId_key" ON "AffiliatePartnership"("offerId","mvpId");
CREATE INDEX "AffiliatePartnership_mvpId_status_updatedAt_idx" ON "AffiliatePartnership"("mvpId","status","updatedAt");
CREATE INDEX "AffiliatePartnership_offerId_status_createdAt_idx" ON "AffiliatePartnership"("offerId","status","createdAt");

CREATE TABLE "AffiliateReferral" (
  "id" TEXT NOT NULL,
  "partnershipId" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "clickCount" INTEGER NOT NULL DEFAULT 0,
  "lastClickedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AffiliateReferral_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AffiliateReferral_partnershipId_fkey" FOREIGN KEY ("partnershipId") REFERENCES "AffiliatePartnership"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "AffiliateReferral_partnershipId_key" ON "AffiliateReferral"("partnershipId");
CREATE UNIQUE INDEX "AffiliateReferral_code_key" ON "AffiliateReferral"("code");
CREATE INDEX "AffiliateReferral_createdAt_idx" ON "AffiliateReferral"("createdAt");

ALTER TABLE "Enquiry" ADD COLUMN "affiliateReferralId" TEXT;
ALTER TABLE "Enquiry"
  ADD CONSTRAINT "Enquiry_affiliateReferralId_fkey"
  FOREIGN KEY ("affiliateReferralId") REFERENCES "AffiliateReferral"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "Enquiry_affiliateReferralId_idx" ON "Enquiry"("affiliateReferralId");

CREATE TABLE "AffiliateConversion" (
  "id" TEXT NOT NULL,
  "referralId" TEXT NOT NULL,
  "partnershipId" TEXT NOT NULL,
  "offerId" TEXT NOT NULL,
  "merchantId" TEXT NOT NULL,
  "mvpId" TEXT NOT NULL,
  "listingId" TEXT NOT NULL,
  "enquiryId" TEXT,
  "merchantOrderReference" TEXT,
  "idempotencyKey" TEXT NOT NULL,
  "quantity" DECIMAL(14,3) NOT NULL,
  "productSubtotal" DECIMAL(14,2) NOT NULL,
  "commissionAmount" DECIMAL(14,2) NOT NULL,
  "currency" TEXT NOT NULL,
  "commissionTypeSnapshot" TEXT NOT NULL,
  "commissionValueSnapshot" DECIMAL(14,2) NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "confirmedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "clearedAt" TIMESTAMP(3),
  "paidAt" TIMESTAMP(3),
  "paymentChannel" TEXT,
  "paymentReference" TEXT,
  "statusReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AffiliateConversion_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AffiliateConversion_referralId_fkey" FOREIGN KEY ("referralId") REFERENCES "AffiliateReferral"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "AffiliateConversion_partnershipId_fkey" FOREIGN KEY ("partnershipId") REFERENCES "AffiliatePartnership"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "AffiliateConversion_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "AffiliateOffer"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "AffiliateConversion_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "AffiliateConversion_mvpId_fkey" FOREIGN KEY ("mvpId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "AffiliateConversion_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "AffiliateConversion_enquiryId_fkey" FOREIGN KEY ("enquiryId") REFERENCES "Enquiry"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "AffiliateConversion_quantity_check" CHECK ("quantity" > 0),
  CONSTRAINT "AffiliateConversion_productSubtotal_check" CHECK ("productSubtotal" > 0),
  CONSTRAINT "AffiliateConversion_commissionAmount_check" CHECK ("commissionAmount" > 0),
  CONSTRAINT "AffiliateConversion_status_check" CHECK ("status" IN ('PENDING','CLEARED','PAID','DISPUTED','REVERSED'))
);
CREATE UNIQUE INDEX "AffiliateConversion_idempotencyKey_key" ON "AffiliateConversion"("idempotencyKey");
CREATE UNIQUE INDEX "AffiliateConversion_merchantId_merchantOrderReference_key" ON "AffiliateConversion"("merchantId","merchantOrderReference");
CREATE INDEX "AffiliateConversion_merchantId_status_createdAt_idx" ON "AffiliateConversion"("merchantId","status","createdAt");
CREATE INDEX "AffiliateConversion_mvpId_status_createdAt_idx" ON "AffiliateConversion"("mvpId","status","createdAt");
CREATE INDEX "AffiliateConversion_referralId_createdAt_idx" ON "AffiliateConversion"("referralId","createdAt");
CREATE INDEX "AffiliateConversion_enquiryId_idx" ON "AffiliateConversion"("enquiryId");

CREATE TABLE "AffiliateConversionEvent" (
  "id" TEXT NOT NULL,
  "conversionId" TEXT NOT NULL,
  "actorId" TEXT,
  "eventType" TEXT NOT NULL,
  "reason" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AffiliateConversionEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AffiliateConversionEvent_conversionId_fkey" FOREIGN KEY ("conversionId") REFERENCES "AffiliateConversion"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "AffiliateConversionEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "AffiliateConversionEvent_conversionId_createdAt_idx" ON "AffiliateConversionEvent"("conversionId","createdAt");
CREATE INDEX "AffiliateConversionEvent_actorId_createdAt_idx" ON "AffiliateConversionEvent"("actorId","createdAt");

-- All new tables are restricted to the application runtime role.
DO $$
DECLARE
  table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'AffiliateOffer','AffiliatePartnership','AffiliateReferral',
    'AffiliateConversion','AffiliateConversionEvent'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format(
      'CREATE POLICY deny_direct_api_clients ON public.%I FOR ALL TO anon, authenticated USING (false) WITH CHECK (false)',
      table_name
    );
    EXECUTE format(
      'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO mudaala_runtime',
      table_name
    );
    EXECUTE format(
      'CREATE POLICY mudaala_runtime_access ON public.%I FOR ALL TO mudaala_runtime USING (true) WITH CHECK (true)',
      table_name
    );
  END LOOP;
END
$$;
