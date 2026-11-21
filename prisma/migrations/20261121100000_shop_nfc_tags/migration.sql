CREATE TABLE "ShopTag" (
  "id" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "tagCode" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "lockedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ShopTag_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ShopTagDailyStat" (
  "id" TEXT NOT NULL,
  "tagId" TEXT NOT NULL,
  "day" TEXT NOT NULL,
  "taps" INTEGER NOT NULL DEFAULT 0,
  "qrScans" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "ShopTagDailyStat_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ShopTag_tagCode_key" ON "ShopTag"("tagCode");
CREATE INDEX "ShopTag_ownerId_status_idx" ON "ShopTag"("ownerId", "status");
CREATE UNIQUE INDEX "ShopTagDailyStat_tagId_day_key" ON "ShopTagDailyStat"("tagId", "day");

ALTER TABLE "ShopTag" ADD CONSTRAINT "ShopTag_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ShopTagDailyStat" ADD CONSTRAINT "ShopTagDailyStat_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "ShopTag"("id") ON DELETE CASCADE ON UPDATE CASCADE;
