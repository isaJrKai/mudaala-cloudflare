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
- [x] Inspect the primary application read/write paths for the initial P0/P1 findings (see section 7); broader route/test coverage remains.
- [~] Inventory repository migration history (PostgreSQL and legacy SQLite histories); actual PostgreSQL catalog inspection remains pending safe read-only access.
- [ ] Establish data classification and retention schedule.
- [ ] Approve canonical event envelope and transactional outbox design.
- [ ] Produce migration plan with compatibility and rollback for the first additive schema change.
- [ ] Add schema validation and integration tests in CI without connecting to production.
- [ ] Obtain explicit approval before any database migration or production configuration change.

Phase 0 is complete only when schema, code paths and actual database state agree. This document alone is not that proof.


## 7. Application code-path audit — first pass

**Scope:** Read-only inspection of the branch's current application code and repository migration files. This pass did not connect to PostgreSQL, read production rows, execute SQL, or change runtime behaviour. File paths below are relative to the repository root.

### 7.1 Confirmed implementation facts

| Area | Code evidence | Finding / consequence |
|---|---|---|
| Session token storage | `src/lib/auth.ts` — `createSession`, `getSessionUser`; `prisma/schema.prisma` — `Session.id` | A 32-byte random bearer token is stored verbatim as the Session primary key and is also the lookup key. The token is high entropy, but a read-only database disclosure exposes immediately usable session credentials. **P0 security hardening:** store a cryptographic hash/digest of the token, return the raw token only once, and support safe rotation/revocation with a compatibility plan for existing sessions. Do not change this until cookie/Bearer compatibility, logout, account deletion, and deployment overlap are mapped and tested. |
| Session lifecycle | `src/lib/auth.ts`; `src/app/api/auth/login/route.ts`; `src/app/api/auth/logout/route.ts` | Sessions expire after 30 days; expired rows are deleted opportunistically on lookup and during session creation. Logout deletes only the current token. No explicit per-session rotation, last-used tracking or maximum concurrent-session policy is visible in these paths. Decide whether those controls are product requirements before expanding the schema. |
| CSRF boundary | `src/proxy.ts`; `src/lib/api.ts` | State-changing API requests with an Origin header are checked against the deployment origin / explicit trusted-host allowlist; cross-site Fetch Metadata is also considered. Requests without Origin and without cross-site Fetch Metadata are intentionally allowed for server-to-server/test clients. This is a meaningful browser CSRF control, but it is not authentication and does not replace per-route authorization. |
| Runtime database role | `prisma/migrations/20261017193000_restricted_runtime_role/migration.sql`; `prisma/migrations/20261020200000_business_records_rls/migration.sql` | The migration creates/validates a non-superuser, non-BYPASSRLS `mudaala_runtime` role and grants it table access. Its `mudaala_runtime_access` policies use `USING (true)` / `WITH CHECK (true)`; this is a restricted database role, **not per-user tenant isolation**. The migration explicitly delegates row ownership enforcement to application routes. Business-record tables additionally deny direct `anon` and `authenticated` Data API roles. |
| Business-product ownership | `src/app/api/my/business-products/route.ts`; `src/app/api/my/business-products/[id]/stock/route.ts` | Reads are scoped by authenticated `userId`; stock mutations re-check product ownership inside the transaction and use conditional updates to prevent negative stock. The stock movement row records the same authenticated user and product. |
| Sale ownership and atomicity | `src/app/api/my/sales/route.ts`; `src/app/api/my/sales/[id]/void/route.ts` | Sale creation loads only active products owned by the authenticated user, enforces one currency per sale, decrements tracked stock conditionally, writes SaleItem and StockMovement in one transaction, and supports an idempotency key. Voiding checks sale ownership and restores only stock with recorded SALE movements. This is stronger than the schema alone suggests. Remaining verification: concurrency/integration tests for duplicate idempotency requests, transaction retries, and void-vs-sale races. |
| Listing ownership and policy | `src/app/api/listings/route.ts`; `src/app/api/listings/[id]/route.ts`; `src/lib/constants.ts` | Listing creation derives owner from the session, normalizes contact numbers, validates country/region, and applies a deterministic text prohibited-item check. Edits are owner-scoped and use optimistic concurrency via `updatedAt`. The prohibited-item matcher is a finite keyword/rule list, not comprehensive legal classification or image-level goods recognition. It must not be described as complete prohibited-goods detection. |
| Image upload pipeline | `src/app/api/upload/route.ts`; `src/app/api/upload/complete/route.ts`; `src/lib/storage.ts`; `src/lib/image-moderation.ts` | Production upload uses short-lived signed URLs into a private quarantine bucket, validates owner-prefixed object keys, size, content type and file signatures, runs image moderation, then promotes to public storage. Moderation unavailable fails closed. This is a useful base for WhatsApp uploads, which must reuse the same pipeline. Current schema stores resulting URLs rather than a durable media-asset record with source, checksum, moderation version and lifecycle. |
| Daily engagement | `src/lib/listing-analytics.ts`; listing/shop engagement API routes | Listing/shop interactions are aggregated by Uganda calendar day. The implementation intentionally avoids persisting viewer IDs and IP addresses in analytics. These aggregates are suitable as coarse reporting signals but cannot support unique-user claims or detailed attribution. |
| Report intake and auto-hide | `src/lib/reports.ts`; `src/app/api/reports/route.ts` | A duplicate-open-report check and subsequent insert are separate operations, not one transaction. Without a matching database uniqueness invariant, concurrent duplicate requests may both insert. The three-distinct-reporter auto-hide is a community safety hold, not a confirmed violation; moderator confirmation is a separate path. **P1:** inspect existing data and add a concurrency-safe deduplication design (likely a partial unique index or equivalent keyed reporter identity) before relying on the one-open-report rule. Guest IP identity and retention also need privacy review. |
| Moderation decisions | `src/app/api/admin/reports/[id]/action/route.ts`; `src/lib/reports.ts` | Confirmed violations are created only through explicit moderator action; active duplicate cases are keyed to one target/owner; overturns reverse the active case; serializable transactions are used for confirmation/reversal. AuditLog entries record action/actor/target, but this code does not attach evidence references, policy version, reason narrative, or a correlation ID. Some manual hide/restore paths and report intake are separate from a unified case/evidence workflow. |
| Audit log writes | `src/lib/reports.ts`; `src/app/api/admin/reports/[id]/action/route.ts`; `src/app/api/account/route.ts` | AuditLog is written for selected moderation actions and actor IDs are nulled on account deletion. This first-pass search did not establish that every security-sensitive mutation is audited, nor that database permissions prevent UPDATE/DELETE. Treat the log as an application audit record, not yet tamper-evident evidence. |

### 7.2 Migration-history inventory

The branch contains a PostgreSQL history at `prisma/migrations/` with 18 timestamped migration directories (baseline plus subsequent incremental changes), and a separate `prisma/migrations-sqlite/` history used for SQLite. `prisma/migrations/migration_lock.toml` identifies the PostgreSQL provider. The two histories must not be mixed or treated as interchangeable.

Notable PostgreSQL migrations visible in the repository include:
- `20261002160000_postgres_baseline`
- `20261017193000_restricted_runtime_role`
- `20261020000000_business_records_foundation`
- `20261020190000_listing_daily_analytics`
- `20261020200000_business_records_rls`
- `20261021100000_policy_violations`
- `20261027080000_shop_showroom_items`

This confirms what is committed in Git only. It does **not** confirm which migrations have been applied to the live Supabase PostgreSQL database, whether the live schema has drifted, or whether role grants/policies match these files.

### 7.3 Revised priority register

| Priority | Finding | Next safe action |
|---|---|---|
| P0 | Raw session token stored in `Session.id` | Design hashed-token migration and dual-version rollout; add tests for login, cookie, optional Bearer mode, logout, expiry, account deletion and session revocation. No schema change in this pass. |
| P0 | Actual production database catalog and migration ledger are unverified | Obtain a least-privilege read-only credential or approved read-only query path; inspect `pg_catalog`, `pg_policies`, grants, indexes, constraints and `_prisma_migrations`. Do not expose or copy secrets into chat or source control. |
| P1 | Open-report deduplication is vulnerable to concurrent check-then-insert | Design and test a database-enforced uniqueness strategy compatible with guest and signed-in reporter keys and existing rows. |
| P1 | Runtime RLS policy is broad for the application role | Preserve the explicit distinction: DB role isolation blocks direct Data API access, while tenant ownership is enforced in server code. Evaluate request-scoped DB identity/RLS only as a separate architecture change, not by assuming current policies isolate tenants. |
| P1 | Audit log lacks a demonstrated append-only boundary and rich provenance | Define privileged audit writer, immutable evidence references, policy version, reason and correlation ID; prove role permissions before claiming tamper resistance. |
| P1 | Media URLs have no first-class asset/provenance record | Design an additive asset registry and backfill strategy; retain quarantine, moderation and public URL compatibility. |
| P1 | Float monetary fields remain in listing/showroom/price history | Trace every writer, reader, serializer, search filter, sort and analytics consumer before any precision migration. |
| P1 | Behavioural signals are currently intentionally coarse | Keep the current privacy-preserving aggregates; define consent, purpose, retention and deletion lineage before introducing richer event streams. |

### 7.4 Next audit slice

1. Trace every writer and reader of monetary fields and status/channel strings, including tests, seed scripts, cron jobs and exports.
2. Inspect report schema indexes and existing migration SQL to design a safe concurrency invariant.
3. Trace all AuditLog writes and all security-sensitive mutation endpoints; produce an audit coverage matrix.
4. Inspect media deletion/reconciliation jobs and identify orphaned quarantine/public object lifecycle.
5. Add regression tests on an isolated test database; never point test commands at production.
6. Only after the above, request read-only production catalog inspection. Any migration remains a separately reviewed and explicitly approved change.


### 7.5 Additional findings from the second code-search pass

| Priority | Area | Evidence | Finding / next action |
|---|---|---|---|
| P1 | Media moderation bypass | `src/lib/listings.ts` (`sanitizePhotos`); `src/app/api/shops/[id]/showroom/route.ts`; `src/app/api/upload/complete/route.ts` | The signed-upload path does validate and moderate quarantine objects, but listing photo sanitization also permits pasted HTTP(S) URLs, and the showroom API accepts arbitrary HTTP(S) `photoUrl` values. Those external-image paths do not pass through the quarantine/moderation pipeline shown in `upload/complete`. Decide whether external images should be disallowed, proxied into quarantine, or separately moderated before publication. Do not claim all marketplace images are moderated until this is resolved. |
| P1 | Audit log is not append-only in current application behaviour | `src/app/api/account/route.ts` updates `AuditLog.actorId` to null during account deletion; `scripts/remove-seed-data.ts` and `scripts/cleanup-test-data.ts` delete audit rows for fixture cleanup | A naive database rule forbidding all UPDATE/DELETE would break account anonymisation and cleanup workflows. Design a narrowly privileged anonymisation procedure or immutable actor pseudonym, and isolate test/fixture cleanup permissions. Audit immutability must preserve lawful privacy deletion/anonymisation requirements. |
| P1 | Report reporter identity retention | `prisma/schema.prisma` (`Report.reporterIp`); `src/lib/reports.ts`; `src/app/api/reports/route.ts` | Guest IP addresses are persisted in Report rows for deduplication, while no retention/expiry policy is visible in the reviewed schema or these paths. Define a retention period and a privacy-preserving dedupe representation (for example a keyed digest with rotation/expiry) before expanding trust analytics. |
| P2 | Price-snapshot sampling bound and clock basis | `src/lib/price-trends.ts`; `src/lib/listing-analytics.ts` | The snapshot sweep reads at most 5,000 active OFFER listings without pagination, computes in application memory, and uses UTC date keys; engagement aggregates use the Africa/Kampala calendar. At larger catalogue sizes, snapshot sample sets may be incomplete, and day boundaries differ. Define deterministic bounded pagination/batch semantics and explicitly choose the market-day timezone before using these figures for intelligence or advertising. |
| P2 | Audit-log coverage is partial | `src/lib/reports.ts`; `src/app/api/admin/reports/[id]/action/route.ts`; GitHub code search for `db.auditLog` | Audit writes are concentrated in moderation workflows; account deletion anonymises actor references, and fixture scripts remove rows. There is not yet evidence of a shared audit wrapper covering all security-sensitive mutations (account/security settings, ownership changes, catalogue publication, product/stock/sale changes, integration linking). Build an action coverage matrix before treating AuditLog as a platform-wide security audit trail. |

### 7.6 What this means for the 40-capability programme

The first capabilities should not be model inference. The current codebase points to these foundational dependencies:

1. **Identity Intelligence / Account Security:** session token hashing and lifecycle policy; safe migration preserving current login/logout behaviour.
2. **Merchant Verification:** keep `BusinessProfile.verified` false until there is an evidence-backed process; current profile completeness and phone-confirmed display are not platform verification.
3. **Prohibited Goods / Content Moderation:** one policy gateway for listings, showroom items, web uploads and future WhatsApp submissions; external image URLs must not bypass review.
4. **Trust, Reports and Reputation:** concurrency-safe report intake, retained evidence, explicit moderator decisions, appeal/reversal and privacy-aware reporter identity.
5. **Event / Platform Orchestration:** versioned event contracts and transactional outbox only after the data-purpose and retention rules are approved.
6. **Commerce and Pricing Intelligence:** preserve Decimal-based merchant records; make listing/showroom price precision and snapshot sampling trustworthy before generating predictions.

No capability should read raw private account or behavioural data merely because it exists in PostgreSQL. Each consumer needs a purpose, minimal field contract, permission boundary, retention rule and test.
