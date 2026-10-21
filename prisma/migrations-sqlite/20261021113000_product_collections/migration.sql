-- SQLite equivalent for local/test schema evolution.
CREATE TABLE "ProductCollection" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "title" TEXT NOT NULL CHECK (length("title") BETWEEN 1 AND 80),
  "description" TEXT CHECK ("description" IS NULL OR length("description") <= 500),
  "coverPhotoUrl" TEXT,
  "startsAt" DATETIME,
  "endsAt" DATETIME,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "sortOrder" INTEGER NOT NULL DEFAULT 0 CHECK ("sortOrder" >= 0),
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE "ProductCollectionItem" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "collectionId" TEXT NOT NULL,
  "listingId" TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0 CHECK ("sortOrder" >= 0),
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProductCollectionItem_collectionId_listingId_key" UNIQUE ("collectionId", "listingId"),
  FOREIGN KEY ("collectionId") REFERENCES "ProductCollection"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "ProductCollection_userId_isActive_sortOrder_idx" ON "ProductCollection"("userId", "isActive", "sortOrder");
CREATE INDEX "ProductCollection_userId_updatedAt_idx" ON "ProductCollection"("userId", "updatedAt");
CREATE INDEX "ProductCollectionItem_listingId_idx" ON "ProductCollectionItem"("listingId");
CREATE INDEX "ProductCollectionItem_collectionId_sortOrder_idx" ON "ProductCollectionItem"("collectionId", "sortOrder");
