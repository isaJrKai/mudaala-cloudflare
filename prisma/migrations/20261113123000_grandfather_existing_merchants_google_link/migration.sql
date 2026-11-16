-- Existing merchants must not lose access when Google linking becomes
-- mandatory for newly activated sellers. Snapshot current merchant accounts
-- into an explicit exemption; new accounts default to false.
ALTER TABLE "User"
  ADD COLUMN "sellerGoogleExempt" BOOLEAN NOT NULL DEFAULT false;

UPDATE "User" AS u
SET "sellerGoogleExempt" = true
WHERE
  EXISTS (SELECT 1 FROM "BusinessProfile" p WHERE p."userId" = u."id")
  OR EXISTS (SELECT 1 FROM "Listing" l WHERE l."userId" = u."id")
  OR EXISTS (SELECT 1 FROM "BusinessProduct" bp WHERE bp."userId" = u."id")
  OR EXISTS (SELECT 1 FROM "ProductCollection" pc WHERE pc."userId" = u."id")
  OR EXISTS (SELECT 1 FROM "ShowroomItem" si WHERE si."userId" = u."id")
  OR EXISTS (SELECT 1 FROM "Sale" s WHERE s."userId" = u."id");
