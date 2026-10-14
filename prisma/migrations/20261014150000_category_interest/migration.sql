CREATE TABLE "CategoryInterest" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "score" INTEGER NOT NULL DEFAULT 0,
  "lastSelectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CategoryInterest_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CategoryInterest_userId_category_key" ON "CategoryInterest"("userId", "category");
CREATE INDEX "CategoryInterest_userId_score_idx" ON "CategoryInterest"("userId", "score");
ALTER TABLE "CategoryInterest" ADD CONSTRAINT "CategoryInterest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Category preferences are accessed through the authenticated application API.
-- Deny direct Supabase Data API access even if project default grants change.
ALTER TABLE "CategoryInterest" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "CategoryInterest" FROM PUBLIC;
REVOKE ALL ON TABLE "CategoryInterest" FROM anon, authenticated;
CREATE POLICY "category_interest_deny_direct_api_clients"
  ON "CategoryInterest"
  FOR ALL
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);
