-- Seller-owned standalone showroom content. Additive only; existing
-- ShowroomItem, ProductCollection and Listing data remain untouched.
CREATE TABLE "ShopShowroom" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "templateId" TEXT NOT NULL,
  "templateVersion" INTEGER NOT NULL DEFAULT 1,
  "title" TEXT NOT NULL,
  "headline" TEXT,
  "introduction" TEXT,
  "story" TEXT,
  "logoUrl" TEXT,
  "primaryColor" TEXT,
  "accentColor" TEXT,
  "coverPhotoUrl" TEXT,
  "photos" TEXT NOT NULL DEFAULT '[]',
  "content" TEXT NOT NULL DEFAULT '{}',
  "listingIds" TEXT NOT NULL DEFAULT '[]',
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "publishedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ShopShowroom_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ShopShowroom_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ShopShowroom_slug_check" CHECK ("slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND char_length("slug") BETWEEN 3 AND 80),
  CONSTRAINT "ShopShowroom_template_check" CHECK ("templateId" ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND "templateVersion" >= 1),
  CONSTRAINT "ShopShowroom_status_check" CHECK ("status" IN ('DRAFT', 'PUBLISHED')),
  CONSTRAINT "ShopShowroom_publish_check" CHECK ("status" <> 'PUBLISHED' OR "publishedAt" IS NOT NULL),
  CONSTRAINT "ShopShowroom_title_check" CHECK (char_length("title") BETWEEN 2 AND 100),
  CONSTRAINT "ShopShowroom_copy_check" CHECK (
    ("headline" IS NULL OR char_length("headline") <= 140) AND
    ("introduction" IS NULL OR char_length("introduction") <= 1000) AND
    ("story" IS NULL OR char_length("story") <= 5000)
  )
);
CREATE UNIQUE INDEX "ShopShowroom_slug_key" ON "ShopShowroom"("slug");
CREATE INDEX "ShopShowroom_userId_status_updatedAt_idx" ON "ShopShowroom"("userId", "status", "updatedAt");
CREATE INDEX "ShopShowroom_status_publishedAt_idx" ON "ShopShowroom"("status", "publishedAt");
ALTER TABLE public."ShopShowroom" ENABLE ROW LEVEL SECURITY;
CREATE POLICY deny_direct_api_clients ON public."ShopShowroom"
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
REVOKE ALL ON TABLE public."ShopShowroom" FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public."ShopShowroom" TO mudaala_runtime;
CREATE POLICY mudaala_runtime_access ON public."ShopShowroom"
  FOR ALL TO mudaala_runtime USING (true) WITH CHECK (true);
