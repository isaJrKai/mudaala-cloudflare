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
  CONSTRAINT "ShowroomItem_title_length_check" CHECK (char_length("title") BETWEEN 4 AND 120),
  CONSTRAINT "ShowroomItem_description_length_check" CHECK (char_length("description") BETWEEN 20 AND 1000),
  CONSTRAINT "ShowroomItem_price_nonnegative_check" CHECK ("price" IS NULL OR "price" >= 0),
  CONSTRAINT "ShowroomItem_availability_check" CHECK ("availability" IN ('IN_STOCK', 'AVAILABLE_ON_ORDER', 'SAMPLE_ONLY')),
  CONSTRAINT "ShowroomItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "ShowroomItem_userId_createdAt_idx" ON "ShowroomItem"("userId", "createdAt");
CREATE INDEX "ShowroomItem_userId_availability_idx" ON "ShowroomItem"("userId", "availability");

-- Match the restricted database access boundary used by all application tables.
ALTER TABLE public."ShowroomItem" ENABLE ROW LEVEL SECURITY;
CREATE POLICY deny_direct_api_clients ON public."ShowroomItem"
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public."ShowroomItem" TO mudaala_runtime;
CREATE POLICY mudaala_runtime_access ON public."ShowroomItem"
  FOR ALL TO mudaala_runtime USING (true) WITH CHECK (true);
