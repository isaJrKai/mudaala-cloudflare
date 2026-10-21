-- Shop-owned collections. No customer profile data is stored here.
CREATE TABLE "ProductCollection" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "coverPhotoUrl" TEXT,
  "startsAt" TIMESTAMP(3),
  "endsAt" TIMESTAMP(3),
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProductCollection_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProductCollection_title_length_check" CHECK (char_length("title") BETWEEN 1 AND 80),
  CONSTRAINT "ProductCollection_description_length_check" CHECK ("description" IS NULL OR char_length("description") <= 500),
  CONSTRAINT "ProductCollection_sortOrder_nonnegative_check" CHECK ("sortOrder" >= 0)
);

CREATE TABLE "ProductCollectionItem" (
  "id" TEXT NOT NULL,
  "collectionId" TEXT NOT NULL,
  "listingId" TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProductCollectionItem_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProductCollectionItem_sortOrder_nonnegative_check" CHECK ("sortOrder" >= 0)
);

CREATE UNIQUE INDEX "ProductCollectionItem_collectionId_listingId_key"
  ON "ProductCollectionItem"("collectionId", "listingId");
CREATE INDEX "ProductCollection_userId_isActive_sortOrder_idx"
  ON "ProductCollection"("userId", "isActive", "sortOrder");
CREATE INDEX "ProductCollection_userId_updatedAt_idx"
  ON "ProductCollection"("userId", "updatedAt");
CREATE INDEX "ProductCollectionItem_listingId_idx"
  ON "ProductCollectionItem"("listingId");
CREATE INDEX "ProductCollectionItem_collectionId_sortOrder_idx"
  ON "ProductCollectionItem"("collectionId", "sortOrder");

ALTER TABLE "ProductCollection" ADD CONSTRAINT "ProductCollection_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductCollectionItem" ADD CONSTRAINT "ProductCollectionItem_collectionId_fkey"
  FOREIGN KEY ("collectionId") REFERENCES "ProductCollection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductCollectionItem" ADD CONSTRAINT "ProductCollectionItem_listingId_fkey"
  FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Match Mudaala's restricted database access boundary.
ALTER TABLE public."ProductCollection" ENABLE ROW LEVEL SECURITY;
CREATE POLICY deny_direct_api_clients ON public."ProductCollection"
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public."ProductCollection" TO mudaala_runtime;
CREATE POLICY mudaala_runtime_access ON public."ProductCollection"
  FOR ALL TO mudaala_runtime USING (true) WITH CHECK (true);

ALTER TABLE public."ProductCollectionItem" ENABLE ROW LEVEL SECURITY;
CREATE POLICY deny_direct_api_clients ON public."ProductCollectionItem"
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public."ProductCollectionItem" TO mudaala_runtime;
CREATE POLICY mudaala_runtime_access ON public."ProductCollectionItem"
  FOR ALL TO mudaala_runtime USING (true) WITH CHECK (true);
