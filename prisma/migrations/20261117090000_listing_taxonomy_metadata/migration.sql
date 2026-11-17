-- Add optional structured taxonomy metadata while preserving legacy category keys.
ALTER TABLE "Listing"
  ADD COLUMN "taxonomyId" TEXT,
  ADD COLUMN "brand" TEXT,
  ADD COLUMN "model" TEXT,
  ADD COLUMN "attributes" JSONB;

CREATE INDEX "Listing_taxonomyId_status_idx" ON "Listing"("taxonomyId", "status");