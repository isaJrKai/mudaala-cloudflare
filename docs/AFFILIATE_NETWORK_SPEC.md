# Mudaala Affiliate Network — Product and Implementation Specification

**Status:** Product specification; not implemented or production-enabled  
**Owner:** Mudaala product  
**Launch market:** Uganda  
**Product boundary:** Affiliate selling only. Wholesale purchasing and inventory resale are separate product domains. Computer vision is also separate.

## 1. Product definition

The Mudaala Affiliate Network lets an individual, community member or specialist professional earn a commission by introducing a customer to a product offered by a Mudaala merchant.

The affiliate does not need to buy, own, store or deliver the product. The merchant remains the seller of record, retains ownership of stock, controls the retail price, confirms availability, fulfils the order, handles returns and pays the agreed commission.

Mudaala supplies the relationship and measurement infrastructure: offers, partner applications, trackable referrals, enquiry attribution, seller-confirmed conversion records, commission calculations, a ledger and payment-status evidence.

**Core promise:** earn by recommending real products from real Mudaala shops. No joining fee, inventory purchase or recruitment requirement.

## 2. Explicit boundaries

This feature is not:
- wholesale buying or buy-and-resell stock;
- dropshipping infrastructure or a fulfilment service;
- a multi-level marketing or recruitment scheme;
- a promise of income or guaranteed sales;
- a Mudaala wallet, escrow service or payment-processing product;
- proof that a click, call or WhatsApp tap became a sale.

Affiliate links, referral codes, QR codes and NFC links all identify the same single-level referral relationship. A customer remains the merchant's customer. The affiliate does not receive the customer's private contact details merely because they referred the customer.

## 3. Actors and responsibilities

### Merchant
- Must have an active Mudaala shop and an eligible active OFFER listing.
- Chooses whether an offer is open to applications or requires approval.
- Sets the commission type, amount, campaign dates, eligible quantity/limits and fulfilment/return terms.
- Confirms actual sales and records cancellations/returns.
- Pays affiliates directly during the pilot and records evidence of payment.
- Cannot retrospectively lower an accepted partner's commission.

### Affiliate
- Uses an existing Mudaala account; no separate identity or second shop is required.
- Reviews offer terms and applies or accepts an open offer.
- Shares personal referral links, codes and QR representations.
- Can view their clicks, attributed enquiries, seller-reported conversions and commission/payment states.
- Cannot edit prices, availability, merchant product content or customer orders.
- Does not receive buyer phone numbers, chat contents, addresses or other private customer data through the affiliate dashboard.

### Customer
- Can browse and contact a shop without becoming an affiliate.
- Sees clear disclosure that the person who shared an affiliate link may earn a commission.
- Purchases or enquires directly from the merchant using Mudaala's existing experience and the merchant's stated payment/fulfilment arrangements.

### Mudaala
- Stores accepted terms and referral attribution.
- Distinguishes visits and enquiries from seller-reported sales.
- Calculates commissions deterministically and preserves an audit trail.
- Provides payment-status and dispute records without holding money in the pilot.

## 4. Offer and partnership rules

An affiliate offer belongs to exactly one merchant and one active OFFER listing. REQUEST listings, expired/hidden/fulfilled listings, suspended users, seed fixtures and shops that are not active are ineligible.

Merchant offer fields:
- listing;
- commission type: `PERCENT` or `FIXED_PER_UNIT`;
- commission value in percentage points or listing currency;
- optional start/end date;
- attribution window (pilot default: 14 days, configurable within a bounded product range);
- application mode: open or merchant approval;
- campaign state: active, paused or ended;
- concise fulfilment, cancellation and return terms.

For the first pilot, support UGX listings only unless a campaign explicitly supports another already-supported listing currency. Do not silently convert currencies.

An affiliate must accept the actual offer terms before sharing. The accepted commission type/value, currency, attribution window, and relevant campaign conditions are snapshotted to the partnership/referral. A merchant's later offer edit must not retroactively change accepted terms. Changes to an existing partnership require explicit re-acceptance or a new partnership version.

A paused or ended offer accepts no new attributions. Already-recorded referrals and conversions retain the terms accepted at the time. A merchant cannot erase an accrued conversion by pausing an offer.

## 5. Referral and attribution rules

Each approved affiliate/offer partnership receives an unguessable, non-sequential referral code. The public referral destination redirects to the canonical listing and establishes a first-party, HTTP-only, secure-in-production attribution cookie. The cookie contains only the opaque referral code and expiry; it does not contain a buyer identity.

Pilot attribution policy:
1. Referral window defaults to 14 days from the most recent eligible referral visit.
2. A subsequent eligible affiliate referral replaces the previous affiliate attribution for the same product.
3. A direct visit does not erase a still-valid attribution.
4. A referral code explicitly presented by a customer at the time of sale overrides passive browser attribution, provided the code belongs to the merchant and the specific eligible listing.
5. Attribution is product/listing-specific, not a blanket claim on every item a customer later buys from the shop.
6. Self-referrals are ineligible where buyer identity is known. Obvious fraud, duplicate orders and fabricated conversions can be rejected with an auditable reason.
7. A link click, listing view, call click, WhatsApp click or enquiry is not a payable conversion.
8. An enquiry may preserve its referral reference to make later seller follow-up and sale recording easier. The affiliate sees aggregate/state information only, not private messages.
9. The merchant records a conversion when a genuine sale has occurred. Where no online checkout exists, an in-person, phone or WhatsApp sale can be reported with a short referral code or the originating Mudaala enquiry.
10. One eligible order line can create at most one commission. Repeated API submissions must be idempotent.

The interface must label the evidence correctly: **clicks**, **enquiries**, **seller-reported sales**, **commission pending**, **commission cleared** and **paid**. Never label a click or enquiry as a sale.

## 6. Commission calculation

Commission applies to the eligible product subtotal only. Delivery charges, taxes or other separately stated charges are excluded unless a future campaign explicitly defines otherwise and legal/accounting review approves it.

For percentage commission:

`commission = round(eligible_product_subtotal × percentage / 100, 2)`

For fixed commission:

`commission = fixed_amount_per_unit × eligible_quantity`

Store the calculated commission as an immutable currency amount when a conversion is recorded. Do not recalculate historical earnings when the listing price, campaign rate or merchant's profile later changes.

Validation:
- percentage is bounded (initial product limit: 0–50%);
- fixed value is positive and in the listing currency;
- commission may not exceed the eligible subtotal;
- no negative sale amount or zero/negative quantity;
- use database Decimal for money, not floating-point arithmetic;
- the merchant sees an estimated margin check/warning where cost data exists, but Mudaala does not invent missing cost data.

## 7. Conversion and settlement lifecycle

A seller-reported conversion follows:

`PENDING → CLEARED → PAID`

Possible exception states are `DISPUTED` and `REVERSED`.

- **PENDING:** merchant reports a completed sale, but the agreed customer-delivery/return window has not passed or needs review.
- **CLEARED:** merchant confirms the transaction is final under the disclosed offer/return terms; commission is due.
- **PAID:** merchant records a direct payment to the affiliate, including payment channel and transaction reference. This records the merchant's assertion and evidence; it does not mean Mudaala moved or verified funds.
- **DISPUTED:** either party raises a specific dispute; preserve original records and capture reason/evidence.
- **REVERSED:** a documented cancellation, return, refund, fraud finding or duplicate causes the conversion/commission to be reversed. Never delete the original record.

The first release should use seller-to-affiliate direct payment (for example, mobile money) and a Mudaala commission ledger. Mudaala must not pool, hold, route or promise to safeguard funds in this release. Automated mobile-money disbursements, wallet balances, escrow and split payments are out of scope until an appropriately licensed payment partner and Ugandan legal review are in place.

Merchant payment deadlines and consequences for overdue commissions must be published in the programme terms. A merchant with overdue unresolved affiliate liabilities can be prevented from opening new offers.

## 8. Proposed data model

Names below are proposed; final Prisma naming should be aligned to the schema at implementation time.

### AffiliateOffer
- id, merchantId, listingId
- commissionType, commissionValue, currency
- status, applicationMode
- startsAt, endsAt, attributionWindowDays
- termsText/version, createdAt, updatedAt
- indexes by merchant/status/date and listing/status

### AffiliatePartnership
- id, offerId, affiliateId
- status: PENDING, APPROVED, REJECTED, PAUSED, REVOKED
- accepted commission type/value/currency and terms snapshot
- acceptedAt, revokedAt, createdAt, updatedAt
- unique offerId + affiliateId

### AffiliateReferral
- id, partnershipId, code (unique, random and unguessable)
- clickCount, lastClickedAt, createdAt
- one referral per approved partnership

### Enquiry attribution
- optional affiliateReferralId on Enquiry, set only after validating that the referral is active/eligible for the exact listing and merchant. Never expose it in the other party's enquiry response unless needed for the merchant's attribution workflow.

### AffiliateConversion
- id, referralId, partnershipId, offerId, merchantId, affiliateId
- listingId and listing title snapshot
- optional enquiryId and optional existing Sale id
- merchant order reference (unique per merchant where supplied)
- eligible product subtotal, quantity, currency
- commission amount and accepted commission terms snapshot
- status, seller-confirmedAt, clearedAt, paidAt
- payment channel/reference, dispute/reversal reason and actor timestamps
- unique idempotency key; indexes for merchant/affiliate/status/date

Keep conversion and payment history auditable. Prefer append-only status events or explicit transition metadata; do not rely on overwriting an untraceable amount/status.

## 9. MVP experiences

### Affiliate
A small "Earn by sharing" destination, reachable from the account/business context rather than an extra permanent navigation rail. It should offer:
- available offers and concise terms;
- applications and approved partnerships;
- product link/code/QR sharing;
- simple performance summary;
- referral and enquiry counts;
- commission ledger with clear status;
- payout and dispute history.

No leaderboards, gamified pressure, multi-level teams or complex creator storefront in the first release.

### Merchant
A compact "Affiliate offer" action from an existing product/listing workflow, plus a focused management view. The merchant can:
- activate/pause an offer;
- set commission and application mode;
- approve/reject partners;
- see clicks and attributed enquiries separately from sales;
- report/confirm a sale against a referral code or enquiry;
- clear commission after fulfilment/return conditions;
- record direct payment or raise a dispute.

Do not add a permanently expanded affiliate panel to the main dashboard. Use an entry point within existing product sharing/business tools and progressively disclose the management workflow.

### Customer
Existing public listing, shop, basket and enquiry flows remain primary. Affiliate referral landing shows the normal listing page plus a modest, clear disclosure. Customer purchase remains directly with the merchant. Guests can browse normally.

## 10. Initial API surface

Proposed endpoints, subject to current route conventions:
- `GET/POST /api/my/affiliate-offers`: merchant list/create.
- `PATCH /api/my/affiliate-offers/:id`: merchant edit/pause with ownership validation.
- `GET /api/affiliate/offers`: affiliate browse available offers.
- `POST /api/affiliate/offers/:id/apply`: apply/accept.
- `GET /api/affiliate/partnerships`: affiliate's accepted/pending partnerships and referral links.
- `GET /api/affiliate/summary`: affiliate's clicks, enquiries, conversions and ledger.
- `GET /r/:code`: public referral resolver, rate-limited, counts click, sets first-party attribution and redirects to canonical listing.
- extend existing enquiry creation to preserve eligible referral attribution from the validated cookie.
- `POST /api/my/affiliate-conversions`: merchant confirms a sale against their own offer/referral and exact listing.
- `PATCH /api/my/affiliate-conversions/:id`: merchant clears, reverses or records payment subject to legal transition rules; affiliate may raise dispute through a separate permission-checked transition.

Every endpoint must use the current `requireSeller` or `requireUser` boundary, parse with Zod, validate offer/listing/merchant ownership in the database, apply rate limits to public referral resolution and write operations, and return only the caller's authorised data. Never trust merchantId, affiliateId, commission value or calculated amount supplied by the browser.

## 11. Integration with current Mudaala

Existing platform facts verified during repository inspection:
- Listings are owned by User and use explicit OFFER/REQUEST and ACTIVE/FULFILLED/EXPIRED/ARCHIVED/HIDDEN states.
- Shop identity lives in BusinessProfile.
- Private WEB enquiries are durable and merchant/shoppers already have separate inbox visibility.
- Shop NFC/QR tags exist as a distinct shop-identity feature; affiliate QR codes must resolve to product-level affiliate links and must not reuse/overload the shop tag ownership model.
- A manual Sale/SaleItem and BusinessProduct stock ledger exists. It records merchant-entered transactions and stock movements; it does not claim payment verification.
- Listing-linked BusinessProduct is optional, so affiliate conversions must not assume every listing already has a BusinessProduct or silently deduct stock.

Integrate with current enquiry and sales flows without conflating their meanings. An enquiry is a lead; a seller-entered affiliate conversion is a sale report. Where the merchant also records an existing Sale, allow an optional link to that record to avoid double-counting business revenue. Do not automatically decrement stock for affiliate commission reporting; stock deductions remain governed by the existing sales/stock ledger and explicit inventory mapping.

## 12. Security, privacy and abuse controls

- Random high-entropy referral codes; never use sequential IDs.
- HTTP-only, Secure, SameSite=Lax first-party attribution cookie, bounded expiry; clear/replace on a new eligible referral.
- Do not store raw IP addresses or browser fingerprints for affiliate attribution. Use existing edge rate-limiting and short-lived abuse keys.
- Verify that the affiliate is not the merchant, the buyer is not the affiliate when known, the offer/listing are eligible, and referral belongs to the merchant/listing.
- Idempotency on conversion creation and payment transitions.
- Audit actor, before/after state, timestamp and reason for commission status changes.
- Limit public referral click counting to one count per short-lived visitor window where technically reliable; label counts as visits, not people.
- Never disclose customer contact details or private enquiry messages to the affiliate.
- Prevent merchants from changing accepted terms retroactively.
- Provide a clear customer affiliate disclosure and a way to report misleading promotion.
- Keep a moderation/suspension path for scams, spam and fabricated sales.

## 13. Pilot plan

Pilot with approximately 5–10 verified/active merchants and 20–30 affiliates in one university community and nearby retail cluster. Begin with fashion, footwear and accessories because the offers are easy to photograph and explain; do not hard-code the platform to those industries.

Pilot success is measured by:
- approved affiliates who actually share;
- referral visits → enquiries → seller-reported conversions;
- conversion amount and commission by campaign;
- time from conversion to cleared and paid;
- share of merchants who run a second campaign;
- cancellations, reversals, disputes and overdue commission;
- merchant-reported incremental customers (clearly labelled as self-reported).

Do not optimise around registrations, clicks or a claimed network size. The primary outcome is completed sales with commissions paid on time.

## 14. Release sequence and acceptance criteria

### Slice 1 — Offers and partnerships
- Merchant can create/pause an offer only for their own eligible active listing.
- Affiliate can browse, apply and accept terms.
- Merchant approval works where required.
- Accepted terms are immutable for that partnership.
- Ownership and cross-account access tests pass.

### Slice 2 — Referral link and enquiry attribution
- Approved affiliate gets an unguessable link and QR.
- Referral route resolves only an active/eligible code and redirects to the correct canonical listing.
- Link sets a bounded HTTP-only cookie.
- Listing disclosure is visible.
- A valid enquiry captures the correct referral; ordinary enquiries remain unchanged.
- Clicks and enquiries are shown as separate metrics.
- Expired, paused, revoked and mismatched referrals do not attribute.

### Slice 3 — Conversion and commission ledger
- Merchant records sale against a valid code or attributed enquiry.
- Server calculates the commission from accepted terms, eligible product subtotal and currency.
- Duplicate submissions are idempotent.
- Affiliate sees only their own conversion and commission records.
- Merchant can clear, dispute or reverse according to allowed transitions.
- Return/cancellation tests preserve an audit trail.

### Slice 4 — Direct payout evidence and pilot analytics
- Merchant records payment channel and transaction reference.
- Affiliate sees PAID status and can report a mismatch.
- Merchant and affiliate can export their own records.
- Late/unpaid balances are visible and new offer creation can be restricted by programme policy.
- Real pilot review validates seller behaviour and commission economics before any automatic payout work.

## 15. Explicit non-goals for the first release

- No Mudaala wallet, escrow, pooled funds, split payment or automatic payout.
- No multi-level commissions or recruitment bonuses.
- No stock ownership transfer, wholesale pricing, reseller purchasing or delivery orchestration.
- No required checkout or full order-management redesign.
- No affiliate access to private customer contact data.
- No commission on clicks, calls, WhatsApp taps or enquiries alone.
- No industry-specific visual AI or computer-vision dependency.
- No claims that Mudaala independently verifies a merchant-reported sale or mobile-money transfer.

## 16. Legal and operational release gate

Before public rollout, publish affiliate programme terms and customer disclosure. Obtain Uganda-specific legal/accounting review for agency, commission, tax, consumer protection, advertising disclosure, privacy and payment handling. Any future wallet, escrow or disbursement flow must be designed with an appropriately licensed payment provider and reviewed against Uganda's National Payment Systems framework. Product copy must not imply Mudaala guarantees income, sales, merchant fulfilment or affiliate payment.

---

**Product principle:** the affiliate network should feel like a simple way to share an eligible Mudaala product and see what happened. The complicated work—terms, attribution, ledger integrity, fraud checks and auditability—belongs behind that experience.
