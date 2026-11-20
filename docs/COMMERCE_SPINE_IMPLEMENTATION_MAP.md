# Mudaala Commerce Spine — Implementation Map (2026-11-20)

Branch under investigation: `feat/intelligence-e2e-refinement-2026-11-20` (`9cdd520f`) —
the tip of the chain `main (`cdfb6f6d`) → fix/intelligence-increment1-remediation
(`edb903bf`) → PR #343 (`8cde0739`, open, CI green) → PR #344 (`9cdd520f`, open draft,
CI green). All PR-branch work is preserved by basing the Commerce Spine branch on this tip.

## 1. What already works (verified against source)

**Merchant operating core**
- Onboarding: account registration with terms versioning (`src/app/api/auth/register/route.ts`),
  seller gate with grandfathering (`src/lib/api.ts:95-108`), first-run shop-setup dialog
  (`src/components/commerce/shop-setup-dialog.tsx`), full business-profile editor with
  weekly-hours, MoMo identity and live name-clash check (`src/components/commerce/account-view.tsx`).
- Identity: MU-CODE `MD-XXXX` minted once, unique column (`src/lib/shop.ts:94-105`,
  `prisma/schema.prisma:145`), buyer till-number lookup (`/api/shops/lookup`, `/s/[code]`),
  owner-only QR poster with printable SVG (`src/components/commerce/shop-view.tsx:35-109`).
- Catalogue: publish/edit/delete listings through a shared, rate-limited publisher
  (`src/lib/listing-publisher.ts`), optimistic concurrency on edit
  (`src/app/api/listings/[id]/route.ts:92-287`), prohibited-item re-check, taxonomy
  attributes, discount rules, lifecycle actions (refresh/fulfil/repost/archive).
- Uploads: magic-byte sniffing, EXIF/GPS stripping, quarantine + moderation + promotion,
  fail-closed in production (`src/app/api/upload/local/route.ts`, `src/lib/storage.ts`).
- Records: BusinessProduct/Sale/SaleItem/StockMovement with guarded stock transactions,
  idempotent sales, append-only void corrections (`src/app/api/my/**`),
  business analytics + CSV export with formula-injection guard.
- Enquiries: deduped OPEN threads per listing+shopper inside a Serializable transaction
  (`src/app/api/enquiries/route.ts:121-175`), threaded replies with honest Telegram
  delivery status, indexed dual inboxes, polling UI.

**Customer experience**
- SSR ad page `/l/[id]` with Product+Offer JSON-LD, OG/Twitter metadata, price market-check
  median (sampleSize ≥ 5), seller identity with shop code, related listings, honest 404 with
  similar live ads (`src/app/l/[id]/page.tsx`, `src/lib/ad-page.ts`).
- Shop page `/s/[code]` with collections, catalogue grouped by taxonomy and client filters;
  public collections with visibility rules; standalone showrooms with 20 art-direction
  templates and zod-validated seller content (`src/lib/showroom/templates.ts`).
- Search: natural-language price intent, synonym expansion, AND word matching, unicode
  fallback, 5 sorts including nearest with ~100 m-blurred locations, expiry + visibility
  enforced on every read (`src/lib/listings.ts:158-623`, `src/lib/search.ts`).
- Basket: per-shop localStorage basket with caps, re-validation of every line against the
  public API before handoff, honest WhatsApp order message (`src/lib/basket.ts`).
- Privacy-safe daily analytics aggregates; seed data excluded from every public surface.

**Platform**
- Custom auth: opaque session tokens, scrypt hashing, hardened Google OIDC (PKCE, JWKS
  cache, verified email, single-use state, fresh-PASSWORD-session linking), anti-enumeration
  SMS password reset with CAS consumption and session revocation.
- Authorization: `requireUser`/`requireSeller`/`requireAdmin` + owner-scoped Prisma wheres
  in every mutation route; CSRF middleware (Origin + Fetch-Metadata); centralized client-IP
  trust; three-tier rate limiting with fail-closed production authority (SQLite DO).
- Intelligence: flags default OFF, 800 ms-timeout circuit-breaker gateway client that never
  throws, pseudonymized merchant IDs with a dedicated key, discovery plan validator that
  refuses visibility-relaxing plans, local fallbacks on every failure path. Hermes stays a
  standalone Python plane (zero imports from `src/`).

## 2. What partially works

| Area | State | Missing piece |
|---|---|---|
| Enquiry lifecycle | Threads open forever | No endpoint/UI writes `Enquiry.status` (RESOLVED/CANCELLED); column + indexes exist (`schema.prisma:815`) |
| Buyer phone reveal | `ShowNumber` + rate-limited `/api/listings/[id]/contact` complete | Wired into ZERO pages; CALL_CLICK/WHATSAPP_CLICK analytics can therefore never fire; merchant dashboards show permanent zeros |
| Showroom discovery | OG metadata SSR'd | Page body is client-fetch only (crawlers index an empty page); contact buttons anchor to `#collection` |
| Shop catalogue | `/s/[code]` renders 200 listings | Silent truncation beyond 200, no notice or pagination |
| Discovery ranking | Locality boosts + reasons implemented and tested | Public browse passes no county/area/query context (`src/lib/listings.ts:263-268`) |
| View analytics | API detail route records daily VIEW | SSR ad page increments only all-time `viewCount` (`l/[id]/page.tsx:176`) — daily aggregates undercount |
| Catalogue↔listing link | `BusinessProduct.listingId @unique` exists | No writer anywhere; stock world and public listings are disconnected |
| QR identity | Poster QR encodes `/#/shop/{userId}` | Documented canonical surface is `/s/{shopCode}` (`schema.prisma:143-145`) |

## 3. What is missing entirely

- Product variants/options (flat `attributes Json` only; one price per listing).
- Order model, checkout, payment processing (deliberate; `Sale` is merchant bookkeeping —
  "Mudaala never touches the money", `schema.prisma:528-530`).
- Enquiry resolve/close flows (see above). Guest web enquiries (sign-in required).
- Showroom/shop LocalBusiness JSON-LD; showroom visit analytics.
- Email identity layer (no `User.email`), email sending provider.
- Error-tracking SDK (Cloudflare observability + console discipline only).

## 4. Duplicated or inconsistent

1. Two upload pipelines: used `/api/upload/local` vs orphaned presign `/api/upload` +
   `/api/upload/complete` (no client caller; drifted error copy).
2. `serializeProduct` duplicated in `api/my/business-products/route.ts` and `[id]/route.ts`.
3. PATCH status-only branch returns the raw Prisma row (`photos` stays a JSON *string*),
   bypassing `Serialized<L>` (`api/listings/[id]/route.ts:148`).
4. Photo parsing triplicated with different caps (8 / 4 / 4): `ad-page.ts:12`,
   `listings.ts:103`, `api/showrooms/public/[slug]/route.ts:7`.
5. Price formatting triplicated across showroom/shop/`format.ts`.
6. Cron-secret check copy-pasted 3× (`cron/sweep`, `cron/growth-coach`, `telegram/webhook`).
7. Two showroom systems (legacy `ShowroomItem` + inline `ShopShowroom` component vs
   standalone `ShopShowroom` model + `StandaloneShowroom` — three colliding names).
8. Two reset flows (SMS solid; email variant broken — §6).
9. Two enquiry identity channels (WEB `shopperId` vs TELEGRAM hash) kept in parallel.

## 5. What needs repair before new implementation (Phase A)

Ranked:

1. **CRITICAL — broken build on main: email password reset.** Commits `5a19889`+`cdfb6f6`
   add `src/app/api/auth/email-reset/{request,verify}/route.ts` importing `@/lib/email-auth`
   (file does not exist), querying `db.emailAuthChallenge` + `User.emailVerifiedAt` (no such
   model/field), and a defective regex `/^\\d{6}$/` that can never match a real code.
   `next.config.ts` has `ignoreBuildErrors=false` → `next build` fails; deploy-branch builds
   break. The code is referenced by nothing else. Repair: revert both commits (completing the
   feature would require inventing an email-identity layer + provider — out of scope).
2. **HIGH — `Session.expiresAt` unindexed** while `createSession` runs
   `deleteMany({ expiresAt: { lt: now } })` on every login (`src/lib/auth.ts:48`,
   `schema.prisma:109-118`). Add `@@index([expiresAt])`.
3. **HIGH — unbounded discovery browse scan** `db.listing.findMany({ where })` with no
   `take` + analytics `in` over every candidate id (`src/lib/listings.ts:219-243`), against
   its own comment "Do not scan hundreds of listings". Bound the candidate window.
4. **HIGH — unbounded saved-search fan-out** on publish: `findMany({ userId: { not } })` over
   the whole SavedSearch table + one `count` per match (`src/lib/listings.ts:647-677`).
5. **MEDIUM — unauthenticated full-table shop-name check** per keystroke
   (`src/app/api/shops/check-name/route.ts:23-26`). Push filters into SQL + rate-limit.
6. **MEDIUM — shop-code allocation race**: check-then-insert without P2002 handling
   (`src/lib/shop.ts:94-105`, callers `api/profile/route.ts:42-48`,
   `api/profile/location/route.ts:22-33`) → 500 on concurrent first-save.
7. **MEDIUM — PATCH response-shape bug** (`api/listings/[id]/route.ts:148`).
8. **LOW — `.env.example` omits `DIRECT_URL`** required by `prisma/schema.prisma:16-17`;
   admin docs still name `ADMIN_PHONES` as required production config.

## 6. What must be preserved

- The enquiry-centric contact model and its dedupe/visibility rules; the honest-no-leak
  phone policy (digits never in SSR HTML; reveal is client-side through a rate-limited API).
- The Listing/Sale separation (ads vs merchant bookkeeping) and the "Mudaala never touches
  the money" payment posture — orders/checkout work must be foundations, not fakes.
- Visibility/expiry enforcement on every public read (`listing-visibility.ts`,
  `shop-visibility.ts`), seed-data exclusion everywhere.
- The intelligence opt-in posture (flags OFF, fail-open local fallbacks, pseudonymization,
  plan validation) and Hermes' clean separation from the Next app.
- The showroom template catalogue and its moderation-aware photo enforcement.
- Rate-limiting budget names and the fail-closed production authority.
- Increment-1 intelligence remediation + PR #343/#344 work (this branch is based on their tip).

## 7. Phase plan — COMPLETED 2026-11-20 (evidence: docs/COMMERCE_SPINE_REPORT.md)

All six phases implemented, tested and committed (A: 7e259c5, B: 4c8ad32, C: 39c6312, D: 38c90f1, E: cdc808c). Original plan below for reference.

- **A — Repairs:** the §5 list, in rank order; every fix carries a test or a reasoned
  no-test note. Rebuild verified green before anything else.
- **B — Unified model:** enquiry lifecycle API (+ state rules), BusinessProduct↔Listing
  linkage (writes + read model), canonical QR destination.
- **C — Merchant journey:** buyer contact reveal wired into both surfaces + CALL/WHATSAPP
  engagement events (fixes zeroed analytics), enquiry resolve/close UI, dedupe fix.
- **D — Storefront foundation:** showroom SSR body, real showroom contact actions,
  shop-page catalogue bound notice.
- **E — Customer journey:** locality-aware discovery ranking, SSR view-count consistency,
  shop/collection structured data.
- **F — Intelligence readiness:** validate flag-off behaviour + document the readiness
  contract (no new modules, no flag flips).
