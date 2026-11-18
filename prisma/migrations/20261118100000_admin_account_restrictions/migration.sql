ALTER TABLE "User"
  ADD COLUMN "suspendedAt" TIMESTAMP(3),
  ADD COLUMN "suspensionReason" TEXT,
  ADD COLUMN "suspendedBy" TEXT;

ALTER TABLE "AuditLog"
  ADD COLUMN "reason" TEXT,
  ADD COLUMN "metadata" JSONB;

CREATE INDEX "User_suspendedAt_idx" ON "User"("suspendedAt");
