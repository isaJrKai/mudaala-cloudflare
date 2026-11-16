# Phase 1 — Commerce attribution

**Status:** implementation in progress on `feat/phase-1-contact-attribution`; seller-reported listing attribution is the first implementation slice.
**Branch:** `feat/phase-1-commerce-attribution`
**Product outcome:** a trader can distinguish ordinary enquiries from sales they report as originating from a specific Mudaala listing.

## 1. The problem we are solving

Mudaala currently records listing views, call clicks and WhatsApp clicks as privacy-preserving daily aggregates. Those numbers describe engagement actions; they do not identify unique buyers and do not prove a trade.

Mudaala also records seller-entered sales, sale items, stock deductions and stock movements. A sale currently records its channel, but it has no explicit reference to the Mudaala listing that the seller says originated the sale.

Phase 1 connects these existing systems without replacing either one.

## 2. Domain language and evidence levels

These terms must remain distinct in database fields, API responses, analytics labels and user-facing copy:

| Term | Meaning | What it does not prove |
|---|---|---|
| Listing view | A public listing page was viewed and counted in the existing aggregate | A contact or buyer |
| Contact action | A call/WhatsApp action was initiated and counted in the existing aggregate | A conversation, unique person or sale |
| Seller-reported Mudaala sale | The authenticated seller recorded a sale and explicitly selected one of their Mudaala listings as its source | Independent confirmation by the buyer |
| Buyer-confirmed trade | A buyer separately confirms a specific seller-reported trade through a future consent-based flow | Payment settlement or independently verified fulfilment |
| Independently verified trade | Evidence has been reviewed under a separately defined verification policy | Must never be inferred from a click or seller assertion |

**The first Phase 1 slice implements only seller-reported listing attribution.** It must not label these records as verified, confirmed, completed-through-Mudaala in an independently proven sense, or unique customers.

## 3. Reuse existing domain models

- `ListingDailyAnalytics` remains the aggregate source for views, call clicks, WhatsApp clicks and shares. Do not add a raw viewer/event identity stream.
- `Sale` remains the seller's transaction record and source of truth for seller-entered revenue. The nullable `sourceListingId` and immutable `sourceListingTitle` identify the listing the seller explicitly attributes as the source.
- `SaleItem` remains the line-item and inventory accounting record.
- `BusinessProduct.listingId` remains the catalogue-to-public-listing relationship. It describes which listing represents a catalogue product; it does **not** prove that a particular sale came from that listing.
- `StockMovement` remains append-preserving inventory history.

Do not create a second sales ledger, a parallel engagement table, a generic CRM/lead system, or a new analytics store for this slice.

## 4. Proposed persisted attribution

Add nullable source fields to `Sale`:

- `sourceListingId String?`: the seller-selected listing that they say originated this sale.
- `sourceListingTitle String?`: immutable title snapshot captured when the attribution is recorded, so historical reporting remains intelligible if the listing is later renamed or removed.
- Optional relation from `Sale` to `Listing`, with deletion behavior that preserves the sale and title snapshot (the relation is cleared, not the financial record).

The relation is optional because existing sales and sales from other channels have no listing attribution. The FK uses `ON DELETE SET NULL`; the title snapshot remains. No historical sale is backfilled or guessed.

### Invariants

1. The sale's `userId` is always taken from the authenticated session; never accept an owner ID from the request body.
2. If `sourceListingId` is supplied, resolve the listing inside the same database transaction and require `listing.userId === authenticatedUser.id`.
3. Do not infer attribution from `BusinessProduct.listingId`, a call click, a WhatsApp click, timestamps, IP address, phone number or proximity.
4. A source listing may be inactive by the time the seller records the sale. Historical attribution must not require the listing to remain ACTIVE. It must still belong to that seller and must not be a seed fixture.
5. If a source listing is selected, the sale channel must be `MUDAALA`. Reject contradictory input rather than silently rewriting it.
6. If the listing is removed later, preserve `sourceListingTitle` and the sale; clear only the optional relation.
7. Voided sales do not count as attributed trades or attributed revenue. Existing void/reversal and stock invariants remain authoritative.
8. The same idempotency key must never create a second sale or decrement stock twice. The attribution fields are part of the original sale payload and must be handled consistently on retries.
9. Attribution is a seller assertion. The UI and API must preserve that evidence label.

The simple foreign key protects referential integrity; ownership is enforced in the transactional service/API. Do not pretend a simple FK alone enforces tenant ownership.

## 5. Seller workflow

When recording a sale:

1. Seller chooses the sale channel as they do today.
2. If the channel is Mudaala, offer an optional field: **“Which Mudaala listing brought this sale?”**
3. Show only the authenticated seller's own non-seed listings. Include inactive historical listings where appropriate, clearly showing their status.
4. Selecting a listing is an explicit seller assertion. Do not silently preselect a listing merely because a catalogue product is linked to it.
5. If no listing is selected, save the sale normally with no listing attribution.
6. Preserve the current sale confirmation, stock deduction, stock movement and idempotency behavior.

Do not ask for or store the buyer's phone number, name, WhatsApp identity, IP address or account identity as part of this flow.

## 6. Reporting contract

Add a distinct seller-reported attribution section to the existing business analytics response and UI. At minimum it should distinguish:

- seller-reported attributed sale count;
- seller-reported attributed revenue, grouped by currency (currently UGX);
- listing-level attributed sale count and attributed revenue;
- ordinary listing views and contact actions, shown separately.

All attributed-sale queries must be scoped to the authenticated seller, exclude `VOIDED` sales, respect the requested date window, and use the same sale timestamp semantics as existing sales analytics.

Do not calculate a conversion rate by dividing attributed sales by aggregate contact clicks and presenting it as a buyer conversion rate: the numerator is seller-reported sales and the denominator is anonymous actions, not unique matched people. If a ratio is ever shown, its definition and limitations must be explicit.

## 7. API and validation boundaries

- Extend the existing sale-create contract; do not introduce a second endpoint that writes sales.
- Validate the optional listing ID as a bounded string.
- Perform owner lookup and sale creation within the same transaction as sale items, stock deductions and stock movements.
- Return the source listing ID/title snapshot in the existing sale response.
- Keep GET results owner-scoped and do not expose another seller's listing details.
- Preserve the existing idempotency conflict/replay behavior; add tests for the attribution fields on both first-write and replay paths.
- Keep error messages useful without disclosing whether another seller owns a supplied listing ID.

## 8. Required test coverage

### Domain and schema
- Existing sale rows remain valid with null attribution.
- A sale can reference an owned listing.
- A listing from another seller is rejected.
- A seed listing is rejected.
- Inactive but seller-owned historical listings can be attributed.
- Listing deletion preserves the sale and title snapshot.
- Migration is additive and does not rewrite financial history.

### API and transaction
- Unauthenticated sale creation is rejected.
- Owner identity comes only from the session.
- Invalid/foreign listing IDs do not create a sale, sale items or stock movements and do not decrement stock.
- Successful attribution, sale items, stock decrement and stock movement commit atomically.
- Transaction failure rolls all of those writes back.
- Same idempotency key replay does not create another sale or decrement stock twice.
- A conflicting retry cannot silently change the original attribution.
- A voided attributed sale is excluded from attributed counts and revenue.

### Analytics and UI
- Seller A cannot see Seller B's attributed sales or listing titles.
- Date boundaries and Uganda timezone behavior match existing sales analytics.
- Views/clicks remain separate from seller-reported trades.
- Empty state, no-listing state and non-Mudaala sale channels remain usable.
- Mobile sale-entry flow remains practical.

## 9. Rollout and operational safety

1. Add an additive Prisma migration; inspect generated SQL before applying it.
2. Deploy code that treats null attribution as the legacy/default state.
3. Do not backfill or infer historical attribution.
4. Run CI and migration validation against a disposable PostgreSQL database.
5. Use a test seller and test listing for end-to-end verification; do not fabricate production sales or modify real seller records.
6. Deploy only after review and required checks. Verify the production API and seller workflow with a controlled test record and clean it up using the established test-data process.
7. Update the canonical `docs/MASTER_CHECKLIST.md` only when evidence exists. A merged PR or green build alone is not production proof.

## 10. Explicit non-goals for Phase 1

- Buyer phone collection or identity matching.
- Automated WhatsApp/SMS follow-up or outbound messaging.
- Buyer confirmation links or OTP.
- Payments, escrow, checkout or payment custody.
- A new CRM, raw contact-event table or buyer tracking.
- Trust scores, merchant ranking changes or public verification badges.
- Claiming that seller-reported attribution is independently verified.

A later contact-reference slice may add an opaque, non-personal WhatsApp attempt reference so a seller can match a sale to a real inbound message. The current daily aggregate cannot provide that join; a click is not an inbound message. Any such event record must avoid buyer identity, phone, IP and message content, and must separately define expiry, replay, abuse and retention rules. Buyer confirmation remains a separate future flow with explicit consent and its own token security. Neither is smuggled into the seller-reported attribution migration.

## 11. Definition of done

A seller can record a real sale against one of their own Mudaala listings; the record is transactionally consistent with sale items and inventory; retries are safe; seller analytics report the trade as **seller-reported** and keep it distinct from clicks; existing records and flows remain intact; automated tests cover ownership, rollback, idempotency, deletion and analytics; and production behavior is verified before the phase is called complete.
