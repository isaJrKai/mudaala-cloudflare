-- Growth Coach foundation: lifecycle metadata, push subscriptions, and
-- explicit merchant-side activity events. Existing notifications remain valid.
ALTER TABLE "Notification"
  ADD COLUMN "category" TEXT NOT NULL DEFAULT 'GENERAL',
  ADD COLUMN "priority" TEXT NOT NULL DEFAULT 'NORMAL',
  ADD COLUMN "actionUrl" TEXT,
  ADD COLUMN "actionLabel" TEXT,
  ADD COLUMN "source" TEXT,
  ADD COLUMN "dedupeKey" TEXT,
  ADD COLUMN "scheduledFor" TIMESTAMP(3),
  ADD COLUMN "snoozedUntil" TIMESTAMP(3),
  ADD COLUMN "archivedAt" TIMESTAMP(3),
  ADD COLUMN "dismissedAt" TIMESTAMP(3),
  ADD COLUMN "completedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "Notification_userId_dedupeKey_key"
  ON "Notification"("userId", "dedupeKey");
CREATE INDEX "Notification_userId_category_archivedAt_createdAt_idx"
  ON "Notification"("userId", "category", "archivedAt", "createdAt");
CREATE INDEX "Notification_userId_scheduledFor_idx"
  ON "Notification"("userId", "scheduledFor");
CREATE INDEX "Notification_userId_snoozedUntil_idx"
  ON "Notification"("userId", "snoozedUntil");

CREATE TABLE "PushSubscription" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "endpoint" TEXT NOT NULL,
  "p256dh" TEXT NOT NULL,
  "auth" TEXT NOT NULL,
  "expirationTime" TIMESTAMP(3),
  "userAgent" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PushSubscription_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint");
CREATE INDEX "PushSubscription_userId_createdAt_idx" ON "PushSubscription"("userId", "createdAt");

CREATE TABLE "MerchantGrowthEvent" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "entityId" TEXT,
  "idempotencyKey" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MerchantGrowthEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "MerchantGrowthEvent_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "MerchantGrowthEvent_userId_idempotencyKey_key"
  ON "MerchantGrowthEvent"("userId", "idempotencyKey");
CREATE INDEX "MerchantGrowthEvent_userId_eventType_createdAt_idx"
  ON "MerchantGrowthEvent"("userId", "eventType", "createdAt");
CREATE INDEX "MerchantGrowthEvent_userId_createdAt_idx"
  ON "MerchantGrowthEvent"("userId", "createdAt");
