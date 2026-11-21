-- Commerce orders, expiring stock reservations, delivery options and
-- append-only order-linked stock movements. All changes are additive.
ALTER TABLE "BusinessProduct" ADD COLUMN "listingVariantId" TEXT;
ALTER TABLE "StockMovement" ADD COLUMN "orderId" TEXT;
ALTER TABLE "StockMovement" ADD COLUMN "idempotencyKey" TEXT;

CREATE UNIQUE INDEX "BusinessProduct_listingVariantId_key" ON "BusinessProduct"("listingVariantId");
CREATE UNIQUE INDEX "StockMovement_idempotencyKey_key" ON "StockMovement"("idempotencyKey");
CREATE INDEX "StockMovement_orderId_idx" ON "StockMovement"("orderId");

CREATE TABLE "CommerceOrder" (
  "id" TEXT NOT NULL,
  "orderNumber" TEXT NOT NULL,
  "buyerId" TEXT NOT NULL,
  "sellerId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING_SELLER',
  "paymentStatus" TEXT NOT NULL DEFAULT 'UNPAID',
  "paymentMethod" TEXT,
  "paymentReference" TEXT,
  "currency" TEXT NOT NULL DEFAULT 'UGX',
  "subtotal" DECIMAL(14,2) NOT NULL,
  "deliveryFee" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "total" DECIMAL(14,2) NOT NULL,
  "deliveryMethod" TEXT NOT NULL DEFAULT 'PICKUP',
  "deliveryAddress" JSONB,
  "deliveryEstimate" JSONB,
  "buyerNote" TEXT,
  "sellerNote" TEXT,
  "idempotencyKey" TEXT,
  "acceptedAt" TIMESTAMP(3),
  "paidAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "cancelledAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CommerceOrder_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CommerceOrderItem" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "listingId" TEXT NOT NULL,
  "variantId" TEXT,
  "businessProductId" TEXT,
  "productTitle" TEXT NOT NULL,
  "variantLabel" TEXT,
  "variantOptions" JSONB,
  "sku" TEXT,
  "photoUrl" TEXT,
  "unit" TEXT,
  "quantity" DECIMAL(14,3) NOT NULL,
  "unitPrice" DECIMAL(14,2) NOT NULL,
  "lineTotal" DECIMAL(14,2) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CommerceOrderItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "StockReservation" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "orderItemId" TEXT NOT NULL,
  "businessProductId" TEXT,
  "variantId" TEXT,
  "quantity" DECIMAL(14,3) NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'HELD',
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "committedAt" TIMESTAMP(3),
  "releasedAt" TIMESTAMP(3),
  "idempotencyKey" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "StockReservation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DeliveryOption" (
  "id" TEXT NOT NULL,
  "sellerId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "method" TEXT NOT NULL DEFAULT 'SELLER_DELIVERY',
  "district" TEXT,
  "area" TEXT,
  "fee" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "minDays" INTEGER NOT NULL DEFAULT 0,
  "maxDays" INTEGER NOT NULL DEFAULT 2,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DeliveryOption_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CommerceOrder_orderNumber_key" ON "CommerceOrder"("orderNumber");
CREATE UNIQUE INDEX "CommerceOrder_buyerId_idempotencyKey_key" ON "CommerceOrder"("buyerId","idempotencyKey");
CREATE INDEX "CommerceOrder_buyerId_status_createdAt_idx" ON "CommerceOrder"("buyerId","status","createdAt");
CREATE INDEX "CommerceOrder_sellerId_status_createdAt_idx" ON "CommerceOrder"("sellerId","status","createdAt");
CREATE INDEX "CommerceOrder_status_expiresAt_idx" ON "CommerceOrder"("status","expiresAt");
CREATE INDEX "CommerceOrderItem_orderId_idx" ON "CommerceOrderItem"("orderId");
CREATE INDEX "CommerceOrderItem_listingId_idx" ON "CommerceOrderItem"("listingId");
CREATE INDEX "CommerceOrderItem_variantId_idx" ON "CommerceOrderItem"("variantId");
CREATE INDEX "CommerceOrderItem_businessProductId_idx" ON "CommerceOrderItem"("businessProductId");
CREATE UNIQUE INDEX "StockReservation_idempotencyKey_key" ON "StockReservation"("idempotencyKey");
CREATE INDEX "StockReservation_orderId_status_idx" ON "StockReservation"("orderId","status");
CREATE INDEX "StockReservation_businessProductId_status_expiresAt_idx" ON "StockReservation"("businessProductId","status","expiresAt");
CREATE INDEX "StockReservation_variantId_status_expiresAt_idx" ON "StockReservation"("variantId","status","expiresAt");
CREATE INDEX "StockReservation_status_expiresAt_idx" ON "StockReservation"("status","expiresAt");
CREATE INDEX "DeliveryOption_sellerId_isActive_idx" ON "DeliveryOption"("sellerId","isActive");

ALTER TABLE "BusinessProduct" ADD CONSTRAINT "BusinessProduct_listingVariantId_fkey"
  FOREIGN KEY ("listingVariantId") REFERENCES "ListingVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "CommerceOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CommerceOrder" ADD CONSTRAINT "CommerceOrder_buyerId_fkey"
  FOREIGN KEY ("buyerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CommerceOrder" ADD CONSTRAINT "CommerceOrder_sellerId_fkey"
  FOREIGN KEY ("sellerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CommerceOrderItem" ADD CONSTRAINT "CommerceOrderItem_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "CommerceOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CommerceOrderItem" ADD CONSTRAINT "CommerceOrderItem_listingId_fkey"
  FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CommerceOrderItem" ADD CONSTRAINT "CommerceOrderItem_variantId_fkey"
  FOREIGN KEY ("variantId") REFERENCES "ListingVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CommerceOrderItem" ADD CONSTRAINT "CommerceOrderItem_businessProductId_fkey"
  FOREIGN KEY ("businessProductId") REFERENCES "BusinessProduct"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "StockReservation" ADD CONSTRAINT "StockReservation_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "CommerceOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StockReservation" ADD CONSTRAINT "StockReservation_businessProductId_fkey"
  FOREIGN KEY ("businessProductId") REFERENCES "BusinessProduct"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StockReservation" ADD CONSTRAINT "StockReservation_variantId_fkey"
  FOREIGN KEY ("variantId") REFERENCES "ListingVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DeliveryOption" ADD CONSTRAINT "DeliveryOption_sellerId_fkey"
  FOREIGN KEY ("sellerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Server-only data: mirror the existing business-record security model.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mudaala_runtime') THEN
    RAISE EXCEPTION 'mudaala_runtime role must exist before commerce RLS is applied';
  END IF;
END
$$;

-- The previous variants migration enabled RLS but did not add the trusted
-- Worker role's allow policy. Add it here so variant-backed checkout can read
-- and manage variants through the restricted runtime connection.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public."ListingVariant" TO mudaala_runtime;
CREATE POLICY mudaala_runtime_access ON public."ListingVariant" FOR ALL TO mudaala_runtime USING (true) WITH CHECK (true);

DO $
DECLARE table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['CommerceOrder','CommerceOrderItem','StockReservation','DeliveryOption'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('CREATE POLICY deny_direct_api_clients ON public.%I FOR ALL TO anon, authenticated USING (false) WITH CHECK (false)', table_name);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO mudaala_runtime', table_name);
    EXECUTE format('CREATE POLICY mudaala_runtime_access ON public.%I FOR ALL TO mudaala_runtime USING (true) WITH CHECK (true)', table_name);
  END LOOP;
END
$$;

ALTER TABLE "StockReservation" ADD CONSTRAINT "StockReservation_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "CommerceOrderItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
