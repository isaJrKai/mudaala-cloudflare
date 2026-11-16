-- Add seller-reported listing attribution to the existing seller sales ledger.
-- Nullable columns preserve every existing sale without inventing historical sources.
ALTER TABLE "Sale"
  ADD COLUMN "sourceListingId" TEXT,
  ADD COLUMN "sourceListingTitle" TEXT;

ALTER TABLE "Sale"
  ADD CONSTRAINT "Sale_sourceListingId_fkey"
  FOREIGN KEY ("sourceListingId") REFERENCES "Listing"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Sale_userId_sourceListingId_status_soldAt_idx"
  ON "Sale"("userId", "sourceListingId", "status", "soldAt");
