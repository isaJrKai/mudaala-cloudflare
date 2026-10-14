-- Optional external website for a shop's public Mudaala profile.
-- Nullable and additive: existing shops and records remain unchanged.
ALTER TABLE "BusinessProfile" ADD COLUMN "websiteUrl" TEXT;
