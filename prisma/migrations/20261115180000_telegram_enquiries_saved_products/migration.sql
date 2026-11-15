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
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EnquiryContactToken_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "EnquiryContactToken_tokenHash_key" ON "EnquiryContactToken"("tokenHash");
CREATE INDEX "EnquiryContactToken_listingId_expiresAt_idx" ON "EnquiryContactToken"("listingId", "expiresAt");
CREATE INDEX "EnquiryContactToken_merchantId_expiresAt_idx" ON "EnquiryContactToken"("merchantId", "expiresAt");
ALTER TABLE "EnquiryContactToken" ADD CONSTRAINT "EnquiryContactToken_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EnquiryContactToken" ADD CONSTRAINT "EnquiryContactToken_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Explicit seller-reported listing availability. Existing records remain UNKNOWN.
ALTER TABLE "Listing" ADD COLUMN "availabilityStatus" TEXT NOT NULL DEFAULT 'UNKNOWN';
ALTER TABLE "Listing" ADD COLUMN "availabilityUpdatedAt" TIMESTAMP(3);
