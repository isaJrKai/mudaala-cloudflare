-- Showroom Engine: presentation metadata layered on the existing collection
-- tables. Additive only - no existing table or column is altered, and no
-- product data is copied. A showroom is a ProductCollection of existing
-- Listings plus one row here for its public slug, copy, purpose, style
-- override, highlights and publish state.
CREATE TABLE "ShowroomPresentation" (
  "id" TEXT NOT NULL,
  "collectionId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "introduction" TEXT,
  "introSource" TEXT NOT NULL DEFAULT 'MERCHANT',
  "purpose" TEXT NOT NULL DEFAULT 'COLLECTION',
  "styleKey" TEXT,
  "highlights" TEXT NOT NULL DEFAULT '[]',
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "publishedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ShowroomPresentation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ShowroomPresentation_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "ProductCollection"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ShowroomPresentation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ShowroomPresentation_slug_check" CHECK ("slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND char_length("slug") BETWEEN 3 AND 80),
  CONSTRAINT "ShowroomPresentation_introduction_check" CHECK ("introduction" IS NULL OR char_length("introduction") <= 600),
  CONSTRAINT "ShowroomPresentation_introSource_check" CHECK ("introSource" IN ('MERCHANT', 'SUGGESTED')),
  CONSTRAINT "ShowroomPresentation_purpose_check" CHECK ("purpose" IN ('COLLECTION', 'FEATURED', 'NEW_ARRIVALS', 'BRAND', 'CATEGORY')),
  CONSTRAINT "ShowroomPresentation_styleKey_check" CHECK ("styleKey" IS NULL OR "styleKey" ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND char_length("styleKey") <= 40),
  CONSTRAINT "ShowroomPresentation_status_check" CHECK ("status" IN ('DRAFT', 'PUBLISHED')),
  CONSTRAINT "ShowroomPresentation_published_check" CHECK ("status" <> 'PUBLISHED' OR "publishedAt" IS NOT NULL)
);
CREATE UNIQUE INDEX "ShowroomPresentation_collectionId_key" ON "ShowroomPresentation"("collectionId");
CREATE UNIQUE INDEX "ShowroomPresentation_slug_key" ON "ShowroomPresentation"("slug");
CREATE INDEX "ShowroomPresentation_userId_status_idx" ON "ShowroomPresentation"("userId", "status");
CREATE INDEX "ShowroomPresentation_status_publishedAt_idx" ON "ShowroomPresentation"("status", "publishedAt");

-- Same restricted access boundary as every other application table.
ALTER TABLE public."ShowroomPresentation" ENABLE ROW LEVEL SECURITY;
CREATE POLICY deny_direct_api_clients ON public."ShowroomPresentation"
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
REVOKE ALL ON TABLE public."ShowroomPresentation" FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public."ShowroomPresentation" TO mudaala_runtime;
CREATE POLICY mudaala_runtime_access ON public."ShowroomPresentation"
  FOR ALL TO mudaala_runtime USING (true) WITH CHECK (true);
