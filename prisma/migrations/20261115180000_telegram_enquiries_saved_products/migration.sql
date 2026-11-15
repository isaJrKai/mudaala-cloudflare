-- Telegram commerce: saved products and private listing-bound enquiries.
CREATE TABLE "SavedProduct" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "listingId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SavedProduct_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SavedProduct_userId_listingId_key" ON "SavedProduct"("userId", "listingId");
CREATE INDEX "SavedProduct_userId_createdAt_idx" ON "SavedProduct"("userId", "createdAt");
CREATE INDEX "SavedProduct_listingId_idx" ON "SavedProduct"("listingId");
ALTER TABLE "SavedProduct" ADD CONSTRAINT "SavedProduct_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SavedProduct" ADD CONSTRAINT "SavedProduct_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "Enquiry" (
  "id" TEXT NOT NULL,
  "listingId" TEXT NOT NULL,
  "merchantId" TEXT NOT NULL,
  "shopperId" TEXT,
  "buyerTelegramHash" TEXT,
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "contactChannel" TEXT NOT NULL DEFAULT 'TELEGRAM',
  "followUpConsentAt" TIMESTAMP(3),
  "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Enquiry_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Enquiry_merchantId_status_lastMessageAt_idx" ON "Enquiry"("merchantId", "status", "lastMessageAt");
CREATE INDEX "Enquiry_shopperId_status_lastMessageAt_idx" ON "Enquiry"("shopperId", "status", "lastMessageAt");
CREATE INDEX "Enquiry_buyerTelegramHash_status_lastMessageAt_idx" ON "Enquiry"("buyerTelegramHash", "status", "lastMessageAt");
CREATE INDEX "Enquiry_listingId_createdAt_idx" ON "Enquiry"("listingId", "createdAt");
ALTER TABLE "Enquiry" ADD CONSTRAINT "Enquiry_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Enquiry" ADD CONSTRAINT "Enquiry_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Enquiry" ADD CONSTRAINT "Enquiry_shopperId_fkey" FOREIGN KEY ("shopperId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "EnquiryMessage" (
  "id" TEXT NOT NULL,
  "enquiryId" TEXT NOT NULL,
  "senderType" TEXT NOT NULL,
  "senderUserId" TEXT,
  "body" TEXT NOT NULL,
  "deliveryStatus" TEXT NOT NULL DEFAULT 'PENDING',
  "telegramUpdateId" BIGINT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EnquiryMessage_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "EnquiryMessage_telegramUpdateId_key" ON "EnquiryMessage"("telegramUpdateId");
CREATE INDEX "EnquiryMessage_enquiryId_createdAt_idx" ON "EnquiryMessage"("enquiryId", "createdAt");
ALTER TABLE "EnquiryMessage" ADD CONSTRAINT "EnquiryMessage_enquiryId_fkey" FOREIGN KEY ("enquiryId") REFERENCES "Enquiry"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EnquiryMessage" ADD CONSTRAINT "EnquiryMessage_senderUserId_fkey" FOREIGN KEY ("senderUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "EnquiryContactToken" (
  "id" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "listingId" TEXT NOT NULL,
  "merchantId" TEXT NOT NULL,
  "shopperId" TEXT,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EnquiryContactToken_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "EnquiryContactToken_tokenHash_key" ON "EnquiryContactToken"("tokenHash");
CREATE INDEX "EnquiryContactToken_listingId_expiresAt_idx" ON "EnquiryContactToken"("listingId", "expiresAt");
CREATE INDEX "EnquiryContactToken_merchantId_expiresAt_idx" ON "EnquiryContactToken"("merchantId", "expiresAt");
CREATE INDEX "EnquiryContactToken_shopperId_expiresAt_idx" ON "EnquiryContactToken"("shopperId", "expiresAt");
ALTER TABLE "EnquiryContactToken" ADD CONSTRAINT "EnquiryContactToken_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EnquiryContactToken" ADD CONSTRAINT "EnquiryContactToken_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EnquiryContactToken" ADD CONSTRAINT "EnquiryContactToken_shopperId_fkey" FOREIGN KEY ("shopperId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Private commerce records must never be reachable through Supabase's direct
-- anon/authenticated Data API roles. The Worker uses its restricted runtime
-- role; participant ownership is enforced in the application API.
ALTER TABLE public."SavedProduct" ENABLE ROW LEVEL SECURITY;
CREATE POLICY deny_direct_api_clients ON public."SavedProduct"
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
REVOKE ALL ON TABLE public."SavedProduct" FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public."SavedProduct" TO mudaala_runtime;
CREATE POLICY mudaala_runtime_access ON public."SavedProduct"
  FOR ALL TO mudaala_runtime USING (true) WITH CHECK (true);

ALTER TABLE public."Enquiry" ENABLE ROW LEVEL SECURITY;
CREATE POLICY deny_direct_api_clients ON public."Enquiry"
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
REVOKE ALL ON TABLE public."Enquiry" FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public."Enquiry" TO mudaala_runtime;
CREATE POLICY mudaala_runtime_access ON public."Enquiry"
  FOR ALL TO mudaala_runtime USING (true) WITH CHECK (true);

ALTER TABLE public."EnquiryMessage" ENABLE ROW LEVEL SECURITY;
CREATE POLICY deny_direct_api_clients ON public."EnquiryMessage"
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
REVOKE ALL ON TABLE public."EnquiryMessage" FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public."EnquiryMessage" TO mudaala_runtime;
CREATE POLICY mudaala_runtime_access ON public."EnquiryMessage"
  FOR ALL TO mudaala_runtime USING (true) WITH CHECK (true);

ALTER TABLE public."EnquiryContactToken" ENABLE ROW LEVEL SECURITY;
CREATE POLICY deny_direct_api_clients ON public."EnquiryContactToken"
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
REVOKE ALL ON TABLE public."EnquiryContactToken" FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public."EnquiryContactToken" TO mudaala_runtime;
CREATE POLICY mudaala_runtime_access ON public."EnquiryContactToken"
  FOR ALL TO mudaala_runtime USING (true) WITH CHECK (true);

-- Explicit seller-reported listing availability. Existing records remain UNKNOWN.
ALTER TABLE "Listing" ADD COLUMN "availabilityStatus" TEXT NOT NULL DEFAULT 'UNKNOWN';
ALTER TABLE "Listing" ADD COLUMN "availabilityUpdatedAt" TIMESTAMP(3);
ALTER TABLE "Listing" ADD CONSTRAINT "Listing_availabilityStatus_check"
  CHECK ("availabilityStatus" IN ('UNKNOWN', 'IN_STOCK', 'AVAILABLE_ON_ORDER', 'OUT_OF_STOCK'));

ALTER TABLE "Enquiry" ADD CONSTRAINT "Enquiry_status_check"
  CHECK ("status" IN ('OPEN', 'RESOLVED', 'CANCELLED'));
ALTER TABLE "Enquiry" ADD CONSTRAINT "Enquiry_contactChannel_check"
  CHECK ("contactChannel" IN ('TELEGRAM', 'WEB'));
ALTER TABLE "Enquiry" ADD CONSTRAINT "Enquiry_buyerIdentity_check"
  CHECK ("shopperId" IS NOT NULL OR "buyerTelegramHash" IS NOT NULL);
ALTER TABLE "Enquiry" ADD CONSTRAINT "Enquiry_buyerTelegramHash_check"
  CHECK ("buyerTelegramHash" IS NULL OR "buyerTelegramHash" ~ '^[a-f0-9]{64}

ALTER TABLE "EnquiryMessage" ADD CONSTRAINT "EnquiryMessage_senderType_check"
  CHECK ("senderType" IN ('SHOPPER', 'MERCHANT'));
ALTER TABLE "EnquiryMessage" ADD CONSTRAINT "EnquiryMessage_deliveryStatus_check"
  CHECK ("deliveryStatus" IN ('PENDING', 'SENT', 'FAILED'));
ALTER TABLE "EnquiryMessage" ADD CONSTRAINT "EnquiryMessage_body_length_check"
  CHECK (char_length("body") BETWEEN 1 AND 1200);

ALTER TABLE "EnquiryContactToken" ADD CONSTRAINT "EnquiryContactToken_tokenHash_check"
  CHECK ("tokenHash" ~ '^[a-f0-9]{64}
);

ALTER TABLE "EnquiryMessage" ADD CONSTRAINT "EnquiryMessage_senderType_check"
  CHECK ("senderType" IN ('SHOPPER', 'MERCHANT'));
ALTER TABLE "EnquiryMessage" ADD CONSTRAINT "EnquiryMessage_deliveryStatus_check"
  CHECK ("deliveryStatus" IN ('PENDING', 'SENT', 'FAILED'));
ALTER TABLE "EnquiryMessage" ADD CONSTRAINT "EnquiryMessage_body_length_check"
  CHECK (char_length("body") BETWEEN 1 AND 1200);

ALTER TABLE "EnquiryContactToken" ADD CONSTRAINT "EnquiryContactToken_tokenHash_check"
  CHECK ("tokenHash" ~ '^[a-f0-9]{64}
);
);
);

ALTER TABLE "EnquiryMessage" ADD CONSTRAINT "EnquiryMessage_senderType_check"
  CHECK ("senderType" IN ('SHOPPER', 'MERCHANT'));
ALTER TABLE "EnquiryMessage" ADD CONSTRAINT "EnquiryMessage_deliveryStatus_check"
  CHECK ("deliveryStatus" IN ('PENDING', 'SENT', 'FAILED'));
ALTER TABLE "EnquiryMessage" ADD CONSTRAINT "EnquiryMessage_body_length_check"
  CHECK (char_length("body") BETWEEN 1 AND 1200);

ALTER TABLE "EnquiryContactToken" ADD CONSTRAINT "EnquiryContactToken_tokenHash_check"
  CHECK ("tokenHash" ~ '^[a-f0-9]{64}
);
