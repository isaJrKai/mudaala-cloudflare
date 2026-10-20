-- Additive shop-owned business records. Existing Listing.quantity is unchanged.
CREATE TABLE "BusinessProduct" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "listingId" TEXT,
  "name" TEXT NOT NULL,
  "sku" TEXT,
  "unit" TEXT NOT NULL DEFAULT 'piece',
  "currency" TEXT NOT NULL DEFAULT 'UGX',
  "sellingPrice" DECIMAL(14,2) NOT NULL,
  "costPrice" DECIMAL(14,2),
  "stockOnHand" DECIMAL(14,3) NOT NULL DEFAULT 0,
  "reorderLevel" DECIMAL(14,3) NOT NULL DEFAULT 0,
  "trackInventory" BOOLEAN NOT NULL DEFAULT true,
  "archived" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BusinessProduct_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Sale" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'COMPLETED',
  "idempotencyKey" TEXT,
  "channel" TEXT NOT NULL DEFAULT 'OTHER',
  "currency" TEXT NOT NULL DEFAULT 'UGX',
  "soldAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Sale_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SaleItem" (
  "id" TEXT NOT NULL,
  "saleId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "productName" TEXT NOT NULL,
  "unit" TEXT NOT NULL,
  "quantity" DECIMAL(14,3) NOT NULL,
  "unitPrice" DECIMAL(14,2) NOT NULL,
  "unitCost" DECIMAL(14,2),
  "lineTotal" DECIMAL(14,2) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SaleItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "StockMovement" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "saleId" TEXT,
  "type" TEXT NOT NULL,
  "quantityDelta" DECIMAL(14,3) NOT NULL,
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StockMovement_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BusinessProduct_listingId_key" ON "BusinessProduct"("listingId");
CREATE UNIQUE INDEX "BusinessProduct_userId_sku_key" ON "BusinessProduct"("userId", "sku");
CREATE INDEX "BusinessProduct_userId_archived_updatedAt_idx" ON "BusinessProduct"("userId", "archived", "updatedAt");
CREATE INDEX "BusinessProduct_userId_name_idx" ON "BusinessProduct"("userId", "name");
CREATE UNIQUE INDEX "Sale_userId_idempotencyKey_key" ON "Sale"("userId", "idempotencyKey");
CREATE INDEX "Sale_userId_soldAt_idx" ON "Sale"("userId", "soldAt");
CREATE INDEX "Sale_userId_status_soldAt_idx" ON "Sale"("userId", "status", "soldAt");
CREATE INDEX "SaleItem_saleId_idx" ON "SaleItem"("saleId");
CREATE INDEX "SaleItem_productId_createdAt_idx" ON "SaleItem"("productId", "createdAt");
CREATE INDEX "StockMovement_userId_createdAt_idx" ON "StockMovement"("userId", "createdAt");
CREATE INDEX "StockMovement_productId_createdAt_idx" ON "StockMovement"("productId", "createdAt");
CREATE INDEX "StockMovement_saleId_idx" ON "StockMovement"("saleId");

ALTER TABLE "BusinessProduct" ADD CONSTRAINT "BusinessProduct_sellingPrice_nonnegative" CHECK ("sellingPrice" >= 0);
ALTER TABLE "BusinessProduct" ADD CONSTRAINT "BusinessProduct_costPrice_nonnegative" CHECK ("costPrice" IS NULL OR "costPrice" >= 0);
ALTER TABLE "BusinessProduct" ADD CONSTRAINT "BusinessProduct_stockOnHand_nonnegative" CHECK ("stockOnHand" >= 0);
ALTER TABLE "BusinessProduct" ADD CONSTRAINT "BusinessProduct_reorderLevel_nonnegative" CHECK ("reorderLevel" >= 0);
ALTER TABLE "BusinessProduct" ADD CONSTRAINT "BusinessProduct_currency_UGX" CHECK ("currency" = 'UGX');
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_status_valid" CHECK ("status" IN ('COMPLETED', 'VOIDED'));
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_channel_valid" CHECK ("channel" IN ('MUDAALA', 'WHATSAPP', 'PHONE', 'IN_PERSON', 'OTHER'));
ALTER TABLE "SaleItem" ADD CONSTRAINT "SaleItem_quantity_positive" CHECK ("quantity" > 0);
ALTER TABLE "SaleItem" ADD CONSTRAINT "SaleItem_unitPrice_nonnegative" CHECK ("unitPrice" >= 0);
ALTER TABLE "SaleItem" ADD CONSTRAINT "SaleItem_unitCost_nonnegative" CHECK ("unitCost" IS NULL OR "unitCost" >= 0);
ALTER TABLE "SaleItem" ADD CONSTRAINT "SaleItem_lineTotal_nonnegative" CHECK ("lineTotal" >= 0);
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_type_valid" CHECK ("type" IN ('OPENING', 'RESTOCK', 'SALE', 'RETURN', 'ADJUSTMENT', 'DAMAGE', 'CORRECTION'));
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_quantityDelta_nonzero" CHECK ("quantityDelta" <> 0);

ALTER TABLE "BusinessProduct" ADD CONSTRAINT "BusinessProduct_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BusinessProduct" ADD CONSTRAINT "BusinessProduct_listingId_fkey"
  FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SaleItem" ADD CONSTRAINT "SaleItem_saleId_fkey"
  FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SaleItem" ADD CONSTRAINT "SaleItem_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "BusinessProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "BusinessProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_saleId_fkey"
  FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE SET NULL ON UPDATE CASCADE;
