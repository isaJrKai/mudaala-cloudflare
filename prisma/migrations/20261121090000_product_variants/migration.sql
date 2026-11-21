-- Product variants are additive; existing listings remain valid with zero variants.
CREATE TABLE "ListingVariant" (
  "id" TEXT NOT NULL,
  "listingId" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "options" JSONB NOT NULL,
  "sku" TEXT,
  "price" DOUBLE PRECISION,
  "stockQuantity" DOUBLE PRECISION,
  "trackInventory" BOOLEAN NOT NULL DEFAULT false,
  "availabilityStatus" TEXT NOT NULL DEFAULT 'UNKNOWN',
  "photos" TEXT NOT NULL DEFAULT '[]',
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ListingVariant_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Enquiry" ADD COLUMN "variantId" TEXT;
ALTER TABLE "Enquiry" ADD COLUMN "variantSnapshot" JSONB;

CREATE UNIQUE INDEX "ListingVariant_listingId_sku_key" ON "ListingVariant"("listingId", "sku");
CREATE INDEX "ListingVariant_listingId_sortOrder_idx" ON "ListingVariant"("listingId", "sortOrder");
CREATE INDEX "Enquiry_variantId_idx" ON "Enquiry"("variantId");

ALTER TABLE "ListingVariant"
  ADD CONSTRAINT "ListingVariant_listingId_fkey"
  FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Enquiry"
  ADD CONSTRAINT "Enquiry_variantId_fkey"
  FOREIGN KEY ("variantId") REFERENCES "ListingVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;
