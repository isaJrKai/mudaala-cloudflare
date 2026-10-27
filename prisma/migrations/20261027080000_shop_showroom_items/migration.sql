-- Separate showcase catalogue from active marketplace listings.
-- Showroom records never enter Browse/search or saved-search notifications.
CREATE TABLE "ShowroomItem" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "price" DOUBLE PRECISION,
  "currency" TEXT NOT NULL DEFAULT 'UGX',
  "availability" TEXT NOT NULL DEFAULT 'AVAILABLE_ON_ORDER',
  "photoUrl" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ShowroomItem_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ShowroomItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "ShowroomItem_userId_createdAt_idx" ON "ShowroomItem"("userId", "createdAt");
CREATE INDEX "ShowroomItem_userId_availability_idx" ON "ShowroomItem"("userId", "availability");
