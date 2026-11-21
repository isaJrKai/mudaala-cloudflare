# Mudaala commerce orders and inventory

## Goal

Turn the existing listing basket into a real order workflow without introducing a second inventory ledger or claiming that Mudaala processes mobile-money payments.

The existing `BusinessProduct` + `StockMovement` records remain the inventory source of truth. `ListingVariant` is the customer-facing option identity. A variant can be explicitly linked to one seller-owned `BusinessProduct` using `BusinessProduct.listingVariantId`; a non-variant listing can use its existing `BusinessProduct.listingId` link.

## Safety invariants

1. **No overselling:** checkout serializes on the relevant BusinessProduct rows, then compares on-hand stock against unexpired HELD reservations.
2. **Reservation is not deduction:** checkout creates a time-limited HELD reservation. Stock is deducted only when the merchant accepts the order.
3. **One deduction:** acceptance commits each reservation and writes one idempotent ORDER StockMovement in the same transaction.
4. **No double count:** the inventory balance decrement and append-only movement insert are atomic.
5. **Expired holds release:** the authenticated cron sweep expires unconfirmed orders and releases their HELD reservations. Expired holds are excluded from available-stock calculations even if a sweep is delayed.
6. **Order snapshots:** order items retain product, option, SKU, photo, unit, quantity and price snapshots.
7. **Paid sale records:** seller-confirmed payment creates one idempotent Sale with item snapshots; pending/unpaid orders do not inflate sales reporting. Linked stock movements attach to that Sale.
8. **Seller boundaries:** a multi-seller basket creates one order per seller. A seller can only read or transition their own orders; buyers can only read their own.
9. **Payment honesty:** direct-to-merchant payments are not verified by Mudaala. A seller records payment only after checking their own MTN MoMo/Airtel Money/cash receipt.
10. **Delivery honesty:** merchant delivery options carry an estimate, not a guaranteed arrival promise. The seller confirms fulfilment.

## Initial backend surface

- `POST /api/orders`: authenticated checkout; validates live listings, variants, prices, stock mappings and seller delivery options; creates one order per seller and HELD reservations.
- `GET /api/orders`: buyer/seller order history.
- `GET /api/orders/[id]`: participant-scoped order details.
- `PATCH /api/orders/[id]`: seller accept/reject, payment recording and fulfilment transitions.
- `GET|POST /api/my/delivery-options`: seller delivery option management.
- `PATCH|DELETE /api/my/delivery-options/[id]`: edit/deactivate delivery options.
- `POST /api/cron/sweep`: additionally expires unconfirmed commerce orders and releases their holds.

## Schema additions

- `CommerceOrder`, `CommerceOrderItem`: seller-scoped orders and immutable purchase snapshots.
- `StockReservation`: temporary inventory holds with explicit lifecycle and expiry.
- `DeliveryOption`: seller-defined pickup/delivery methods, area, fee and ETA range.
- `BusinessProduct.listingVariantId`: explicit bridge from a public variant to the existing stock ledger.
- `StockMovement.orderId` + `idempotencyKey`: order-linked, idempotent stock audit trail.
- `Sale.commerceOrderId` and nullable/listing-aware `SaleItem` links: seller-confirmed paid orders appear in existing sales reports without requiring every public listing to have a stock record.

The migration is additive and applies the same server-only RLS model as existing business records. It is not to be applied to production until review and validation pass.

## Remaining work before production

- Wire the buyer basket to store variant IDs and submit the current basket to checkout.
- Add checkout UI for address, per-seller delivery selection, price confirmation and order placement.
- Add seller order inbox/detail UI for accept/reject, payment confirmation and fulfilment transitions.
- Add seller inventory-link selection in the variant editor and ensure variant editing preserves IDs/mappings.
- Ensure sales analytics reflect paid/completed orders without counting pending or rejected orders.
- Add safe cancellation/return handling after stock has been committed.
- Add tests for simultaneous checkout, idempotency, reservation expiry, seller isolation, payment status and ledger reconciliation.
- Run Prisma format/validate/generate, full CI and production-like smoke tests before requesting migration approval.

## Current implementation status

This branch now includes the schema, checkout APIs, variant-aware buyer basket, buyer order history, seller order actions, delivery configuration and delivery selection. It remains an implementation-in-progress until the new disposable-PostgreSQL migration test, full CI, concurrency/expiry/security tests and real browser journeys pass. The production database has not been migrated and no deployment has been performed.
