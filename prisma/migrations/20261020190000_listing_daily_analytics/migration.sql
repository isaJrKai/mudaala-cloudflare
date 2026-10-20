-- Daily, privacy-preserving aggregates for listing views and meaningful interactions.
-- No IP addresses, phone numbers, account IDs of viewers, or raw event stream are stored.
CREATE TABLE "ListingDailyAnalytics" (
  "id" TEXT NOT NULL,
  "listingId" TEXT,
  "ownerId" TEXT NOT NULL,
  "listingTitle" TEXT NOT NULL,
  "day" TEXT NOT NULL,
  "views" INTEGER NOT NULL DEFAULT 0,
  "callClicks" INTEGER NOT NULL DEFAULT 0,
  "whatsappClicks" INTEGER NOT NULL DEFAULT 0,
  "shareClicks" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ListingDailyAnalytics_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ListingDailyAnalytics_day_format_check" CHECK ("day" ~ '^\d{4}-\d{2}-\d{2}$'),
  CONSTRAINT "ListingDailyAnalytics_counts_nonnegative_check" CHECK (
    "views" >= 0 AND "callClicks" >= 0 AND "whatsappClicks" >= 0 AND
    "shareClicks" >= 0
  )
);

CREATE UNIQUE INDEX "ListingDailyAnalytics_listingId_day_key"
  ON "ListingDailyAnalytics"("listingId", "day");
CREATE INDEX "ListingDailyAnalytics_ownerId_day_idx"
  ON "ListingDailyAnalytics"("ownerId", "day");
CREATE INDEX "ListingDailyAnalytics_ownerId_listingId_day_idx"
  ON "ListingDailyAnalytics"("ownerId", "listingId", "day");

ALTER TABLE "ListingDailyAnalytics" ADD CONSTRAINT "ListingDailyAnalytics_listingId_fkey"
  FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ListingDailyAnalytics" ADD CONSTRAINT "ListingDailyAnalytics_ownerId_fkey"
  FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Match the existing Supabase Data API boundary: browser roles cannot query this table directly.
ALTER TABLE public."ListingDailyAnalytics" ENABLE ROW LEVEL SECURITY;
CREATE POLICY deny_direct_api_clients ON public."ListingDailyAnalytics"
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public."ListingDailyAnalytics" TO mudaala_runtime;
CREATE POLICY mudaala_runtime_access ON public."ListingDailyAnalytics"
  FOR ALL TO mudaala_runtime USING (true) WITH CHECK (true);
