# Mudaala Commerce Intelligence — database foundation audit

**Status:** Phase 0 / read-only schema review
**Branch:** `architecture/commerce-intelligence-foundation`
**Scope:** Static review of the current `prisma/schema.prisma` on `main`.
**Not performed:** No database connection, SQL inspection, production data read, migration, schema push, seed, or deployment.

This is an initial engineering inventory, not a claim that the live PostgreSQL schema has been independently verified. The Prisma schema is the reviewed source for these observations; before any migration, compare it with the actual database catalog and migration history.

## 1. Executive assessment

Mudaala already has useful foundations: PostgreSQL, Prisma relations, unique constraints, indexes, Decimal-based merchant inventory and sales records, idempotency on manually recorded sales, and a production shared rate-limit authority using Cloudflare Durable Objects.

The next step is not to add a large number of intelligence tables. It is to define stronger data contracts and invariants around the existing domains, then introduce new data in isolated, additive migrations.

### Priority findings

| Priority | Observation from current Prisma schema | Why it matters | Recommended treatment |
|---|---|---|---|
| P0 | Monetary values are mixed: Listing, ShowroomItem and PriceSnapshot use Float, while BusinessProduct and SaleItem use Decimal | Floating-point arithmetic can produce rounding errors and inconsistent comparisons/aggregates | Define currency and amount semantics; design a compatibility-safe Decimal migration only after auditing all readers/writers and existing values |
| P0 | Several domain states are free-form String fields (listing status/type, report status/reason, sale status/channel, stock movement type, availability) | Invalid or misspelled states can enter the database unless every caller validates perfectly | Inventory actual values and call sites; introduce shared domain schemas and, where safe, database CHECK constraints or Prisma enums in a separately reviewed migration |
| P0 | AuditLog stores actor/action/target/time but no explicit append-only enforcement, reason, correlation ID, policy version or before/after evidence | A normal application role may be able to update/delete rows; investigations need provenance | Define audit event contract, privileged role boundaries, append-only DB permissions/trigger strategy, retention and tamper-evidence; do not rewrite historical records |
| P1 | Listing.photos stores a JSON-encoded URL array in a String; shop and showroom media use URL fields | Media ownership, moderation state, provenance, lifecycle and reuse are hard to enforce consistently | Design a media asset model and migration mapping; preserve public URLs and existing image delivery while backfilling |
| P1 | Analytics are daily aggregates; CategoryInterest stores an explicit score, but there is no general event/outbox contract visible in the schema | Recommendation systems need trustworthy, deduplicated, purpose-limited signals | Design a minimal event envelope and transactional outbox; retain daily aggregates as projections and do not collect unnecessary raw behaviour |
| P1 | Session uses an opaque String ID and expiry, with an index on userId; token hash/rotation semantics are not represented in this schema | Session security depends on generation, storage, cookie handling, expiry and revocation in application code | Audit actual auth implementation before changing schema; prefer hashed token storage and explicit session lifecycle if current implementation does not already provide it |
| P1 | ShopFollow has a unique follower/shop pair but no database check preventing a user following themselves | Domain logic may prevent this, but database invariants should protect against alternate write paths | Add a reviewed CHECK constraint if self-follow is not a supported case |
| P1 | SaleItem.productId and StockMovement.productId are separate references; schema does not itself prove the referenced product belongs to Sale.userId / StockMovement.userId | Cross-shop consistency relies on application transaction logic | Audit every create/update transaction; add database-enforceable composite ownership constraints only if compatible with current data and Prisma design |
| P2 | Report and PolicyViolation have useful state and reversal fields, but policy version/evidence provenance are not represented | Policy changes and appeals need reproducible decisions | Add versioned policy references and evidence records as a new trust domain, with restricted access |
| P2 | User and BusinessProfile store contact details; events and future preference profiles will add behavioural data | Retention, consent, export and deletion must work across derived data | Establish data classification, purpose, retention and deletion lineage before event collection |

## 2. Existing model inventory

The schema already represents these domains:

- **Identity:** User, Session, PasswordReset.
- **Merchant identity:** BusinessProfile, shop code, public contact and self-reported payment destination details.
- **Commerce catalogue:** Listing, ShowroomItem, ProductCollection, ProductCollectionItem, BusinessProduct.
- **Merchant operations:** Sale, SaleItem, StockMovement.
- **Buyer relationships:** SavedSearch, ShopFollow, CategoryInterest.
- **Engagement aggregates:** ListingDailyAnalytics, ShopDailyAnalytics, PriceSnapshot.
- **Trust and moderation:** Report, PolicyViolation, AuditLog.
- **Platform operations:** Notification, AppSetting, Feedback.

These existing models remain authoritative. The intelligence programme should reference them rather than create parallel user, shop or listing tables.

## 3. Database design decisions to establish before schema expansion

### 3.1 Monetary representation

Adopt a documented money contract:
- Currency is a required ISO 4217 code (or an explicitly documented extension where appropriate).
- Amounts use fixed precision, never binary floating point for financial arithmetic.
- Currency minor-unit rules are explicit; UGX does not use the same fractional display convention as every other currency.
- Exchange rates are stored with source, timestamp, pair, precision and expiry.
- Quotes and landed-cost estimates retain the original supplier amount and currency plus a separately computed estimate; never overwrite the source quote.
- Existing Float data is profiled for scale, range, nulls, and rounding before conversion.
- API compatibility is preserved through an explicit serialization/rounding contract.

Do not change existing Float columns in this phase.

### 3.2 Domain states and constraints

Create a canonical state catalogue for each domain. Before adding enums or CHECK constraints:
1. Search every writer, reader, test, seed and scheduled job.
2. Query distinct existing values from a safe database snapshot.
3. Identify historical/legacy values and transition rules.
4. Add compatibility handling before enforcing constraints.
5. Test migration and rollback on a production-like copy.

A TypeScript/Zod schema alone is not a substitute for a database invariant where the invariant can safely be enforced in PostgreSQL.

### 3.3 Ownership and tenant isolation

For every shop-scoped record, document:
- authoritative owner relation;
- whether it is public, owner-private, moderator-private or system-only;
- all permitted actor roles and operations;
- deletion and retention behaviour;
- cross-tenant negative tests.

Review Sale/SaleItem and StockMovement/BusinessProduct ownership consistency. Application transactions must verify that all related products belong to the same shop as the sale or movement. A client-supplied ownerId must never establish authority.

### 3.4 Event and outbox foundation

Before collecting detailed behavioural signals, define:
- versioned event name and schema;
- server-generated actor and object references;
- event ID and idempotency strategy;
- occurredAt versus recordedAt;
- purpose and consent context where required;
- data classification and retention;
- transactional relationship to the domain mutation;
- consumer retry, dead-letter, replay and deletion semantics.

Use a transactional outbox when an event must reliably follow a PostgreSQL transaction. Do not claim exactly-once delivery; design idempotent at-least-once consumers. Start with high-value events (listing published/updated/hidden, search performed where justified, contact action, report submitted, WhatsApp draft confirmed) and avoid raw keystroke or unrelated browsing collection.

### 3.5 Audit and evidence

Separate:
- **Operational logs:** short-lived diagnostics, redacted and not a source of truth.
- **Domain events:** business facts with stable schemas.
- **Security audit:** privileged access and security-sensitive actions.
- **Trust evidence:** source-backed records with restricted access and retention.
- **Analytics projections:** derived aggregates, rebuildable from permitted events.

An audit trail needs a documented threat model. Append-only behaviour should be enforced through database permissions and controlled write paths, not only through a comment in application code. Evidence must be private by default; ordinary merchants and buyers must not see internal reports or risk signals.

### 3.6 Media integrity

A future media asset record should distinguish:
- internal asset ID and owning shop/user;
- storage object key (not a long-lived public credential);
- content type, byte size, checksum and dimensions;
- upload source (web, WhatsApp, supplier import);
- moderation status and policy version;
- processing state and derivative references;
- created/retained/deleted timestamps.

The existing image delivery URL contract must remain compatible during any future backfill. Never let a WhatsApp upload bypass the same moderation and storage path used by the web application.

## 4. Proposed data-domain boundaries

| Domain | Owns | Must not own |
|---|---|---|
| Identity & access | User identity, sessions, verified channel links, roles/permissions | Product ranking or trust verdicts |
| Commerce catalogue | Listings, product facts, shop ownership, catalogue lifecycle | Model-derived identity proof |
| Merchant operations | Stock, sales records and operational snapshots | Claim that Mudaala processed a payment unless it actually did |
| Trust & safety | Reports, evidence, policy versions, moderation cases and appeals | Unreviewable opaque global reputation score |
| Event platform | Outbox, event contracts, delivery state and replay metadata | Authoritative commerce state |
| Intelligence | Derived features, evaluations, recommendation outputs and provenance | Ownership, permissions, payment settlement or legal decisions |
| Trade (future) | Supplier evidence, quotes, corridor and shipment facts | Customs clearance or carrier confirmation without authorised source |
| Advertising (future) | Advertisers, campaigns, eligibility and sponsored placement | Ability to override trust/policy gates |

## 5. Safe migration policy

No migration is authorised by this audit. When implementation begins:

1. Capture and verify a restorable database backup.
2. Inspect actual PostgreSQL catalog, constraints, indexes, extensions and migration history.
3. Compare production schema with Prisma schema and resolve drift.
4. Take a read-only data profile and record row counts/nulls/distinct state values.
5. Write an additive migration with explicit preconditions and postconditions.
6. Test on a production-like copy with representative volume.
7. Test both forward migration and the documented rollback/containment strategy.
8. Deploy code that can read old and new representations during transition.
9. Backfill in bounded, resumable batches with checkpoints and reconciliation.
10. Enforce new constraints only after data is clean and all writers are compatible.
11. Verify application health, query plans, lock duration and error rates.
12. Keep a tested recovery path; do not run destructive changes as an emergency shortcut.

Never run `prisma db push`, `migrate reset`, ad hoc SQL, seed scripts or destructive migrations against production as part of this programme without a separately reviewed and explicitly approved change.

## 6. Phase 0 tasks and exit criteria

- [x] Read-only review of current Prisma schema.
- [x] Identify current model domains and highest-risk schema patterns.
- [x] Confirm production rate limiting uses Cloudflare Durable Objects; Redis adapter is legacy/test and not an authority.
- [ ] Inspect full application read/write paths for every P0/P1 finding.
- [ ] Inspect migration history and actual PostgreSQL catalog using a read-only credential.
- [ ] Establish data classification and retention schedule.
- [ ] Approve canonical event envelope and transactional outbox design.
- [ ] Produce migration plan with compatibility and rollback for the first additive schema change.
- [ ] Add schema validation and integration tests in CI without connecting to production.
- [ ] Obtain explicit approval before any database migration or production configuration change.

Phase 0 is complete only when schema, code paths and actual database state agree. This document alone is not that proof.
