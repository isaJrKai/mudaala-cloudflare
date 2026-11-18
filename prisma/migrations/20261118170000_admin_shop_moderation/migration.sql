ALTER TABLE "BusinessProfile"
  ADD COLUMN "moderationStatus" TEXT NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN "moderatedAt" TIMESTAMP(3),
  ADD COLUMN "moderationReason" TEXT,
  ADD COLUMN "moderatedBy" TEXT;

CREATE INDEX "BusinessProfile_moderationStatus_idx" ON "BusinessProfile"("moderationStatus");
