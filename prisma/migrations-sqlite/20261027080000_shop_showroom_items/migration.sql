-- Separate showcase catalogue from active marketplace listings.
CREATE TABLE "ShowroomItem" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "title" TEXT NOT NULL CHECK (length("title") BETWEEN 4 AND 120),
  "description" TEXT NOT NULL CHECK (length("description") BETWEEN 20 AND 1000),
  "category" TEXT NOT NULL,
  "price" REAL CHECK ("price" IS NULL OR "price" >= 0),
  "currency" TEXT NOT NULL DEFAULT 'UGX',
  "availability" TEXT NOT NULL DEFAULT 'AVAILABLE_ON_ORDER'
    CHECK ("availability" IN ('IN_STOCK', 'AVAILABLE_ON_ORDER', 'SAMPLE_ONLY')),
  "photoUrl" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "ShowroomItem_userId_createdAt_idx" ON "ShowroomItem"("userId", "createdAt");
CREATE INDEX "ShowroomItem_userId_availability_idx" ON "ShowroomItem"("userId", "availability");
