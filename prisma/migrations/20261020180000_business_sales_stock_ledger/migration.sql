-- Additive business record foundation. Existing listing quantities and rows are untouched.
CREATE TABLE "BusinessSale" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "listingId" TEXT,
    "productTitle" TEXT NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "unit" TEXT,
    "unitPrice" DECIMAL(14,2) NOT NULL,
    "unitCost" DECIMAL(14,2),
    "currency" TEXT NOT NULL DEFAULT 'UGX',
    "channel" TEXT NOT NULL DEFAULT 'IN_PERSON',
    "note" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'COMPLETED',
    "voidedAt" TIMESTAMP(3),
    "voidReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "BusinessSale_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "StockMovement" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "listingId" TEXT,
    "saleId" TEXT,
    "productTitle" TEXT NOT NULL,
    "quantityDelta" DECIMAL(14,3) NOT NULL,
    "unit" TEXT,
    "reason" TEXT NOT NULL,
    "note" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StockMovement_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "BusinessSale_userId_occurredAt_idx" ON "BusinessSale"("userId", "occurredAt");
CREATE INDEX "BusinessSale_userId_status_occurredAt_idx" ON "BusinessSale"("userId", "status", "occurredAt");
CREATE INDEX "BusinessSale_listingId_idx" ON "BusinessSale"("listingId");
CREATE UNIQUE INDEX "StockMovement_saleId_key" ON "StockMovement"("saleId");
CREATE INDEX "StockMovement_userId_occurredAt_idx" ON "StockMovement"("userId", "occurredAt");
CREATE INDEX "StockMovement_userId_listingId_occurredAt_idx" ON "StockMovement"("userId", "listingId", "occurredAt");

ALTER TABLE "BusinessSale" ADD CONSTRAINT "BusinessSale_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BusinessSale" ADD CONSTRAINT "BusinessSale_listingId_fkey"
  FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_listingId_fkey"
  FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_saleId_fkey"
  FOREIGN KEY ("saleId") REFERENCES "BusinessSale"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- New tables follow the existing Supabase Data API deny-by-default posture.
ALTER TABLE public."BusinessSale" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."StockMovement" ENABLE ROW LEVEL SECURITY;

CREATE POLICY deny_direct_api_clients ON public."BusinessSale"
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
CREATE POLICY deny_direct_api_clients ON public."StockMovement"
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

-- The Worker uses the restricted server-side role; ownership is enforced in API routes.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public."BusinessSale" TO mudaala_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public."StockMovement" TO mudaala_runtime;

CREATE POLICY mudaala_runtime_access ON public."BusinessSale"
  FOR ALL TO mudaala_runtime USING (true) WITH CHECK (true);
CREATE POLICY mudaala_runtime_access ON public."StockMovement"
  FOR ALL TO mudaala_runtime USING (true) WITH CHECK (true);
