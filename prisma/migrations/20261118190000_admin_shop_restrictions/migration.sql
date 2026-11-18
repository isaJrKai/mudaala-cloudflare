-- Shop-level moderation is distinct from account suspension.
-- Buyers can keep using the account while the shop's public and merchant surfaces are restricted.
ALTER TABLE "User"
  ADD COLUMN "shopRestrictedAt" TIMESTAMP(3),
  ADD COLUMN "shopRestrictionReason" TEXT,
  ADD COLUMN "shopRestrictedBy" TEXT;
