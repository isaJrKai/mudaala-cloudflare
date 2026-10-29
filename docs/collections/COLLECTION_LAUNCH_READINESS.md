# Mudaala collections launch-readiness checklist

**Prepared:** 2026-10-30  
**Roadmap control:** [issue #163](https://github.com/isaJrKai/mudaala-cloudflare/issues/163)  
**Canonical release control:** [MASTER_CHECKLIST.md](../MASTER_CHECKLIST.md)

This document prepares the next collections verification slice. It does not implement new UI, create production collections, or change seller/customer data.

## 1. Existing implementation confirmed

- Seller collection management exists in `src/components/commerce/product-collections-manager.tsx`.
- `GET/POST /api/my/collections` requires an authenticated user; creation assigns `userId` from the authenticated session.
- Adding an item checks that the collection belongs to the signed-in seller and that the listing is that same seller's active, unexpired, non-seed OFFER.
- Public visibility uses `publicCollectionVisibilityWhere()`: active collections only, start time null or reached, end time null or still in the future.
- Public collection pages and APIs return only same-owner active, unexpired OFFER listings and expose share metadata/links.
- The live production collection count was previously verified as zero. Therefore, populated seller collection rendering and real WhatsApp/social previews remain unverified with production data.

These are source-level observations. The full owner/buyer journey still requires exact-head CI and live verification when genuine seller content exists.

## 2. Seller experience acceptance

- [ ] Seller can find collection management from the correct owner workspace without confusing it with buyer browsing.
- [ ] Empty state explains what a collection is and how it helps customers browse a shop's products.
- [ ] Create, edit, reorder, activate/deactivate, schedule, add/remove products and delete flows show clear success/error feedback.
- [ ] Collection title, description and cover image validate correctly on slow/mobile connections.
- [ ] Seller can only add their own active, unexpired OFFER listings; REQUEST, hidden, expired, seed, and other sellers' listings are rejected server-side.
- [ ] Date/time entry is understandable in Uganda local time and round-trips correctly to UTC; start/end validation is explicit.
- [ ] The seller can preview what customers will see before sharing.
- [ ] No seller action silently changes listing ownership, listing visibility, or another seller's collection.

## 3. Buyer/public experience acceptance

- [ ] Buyers can view public collections without signing in.
- [ ] Public collection view clearly identifies the shop and provides a route back to the shop.
- [ ] Only products belonging to the collection owner and currently eligible for public display are visible.
- [ ] Future, ended, deactivated, missing, and unauthorized collection IDs are not publicly exposed; unavailable direct pages return 404 and noindex metadata.
- [ ] Product cards link to canonical `/l/{id}` pages and show truthful current price/unit, real photos, and available status.
- [ ] Empty/zero-item collection behaviour is intentional and does not imply products are available.
- [ ] WhatsApp, copy, and social links use the canonical public URL; Open Graph/Twitter metadata uses a real collection/product photo or the neutral Mudaala fallback.
- [ ] Preview is checked on an actual phone and WhatsApp, not inferred solely from metadata or CI.

## 4. Security and ownership tests (must be server-side)

- [ ] Anonymous and buyer accounts cannot call seller create/edit/delete/reorder/item-management endpoints successfully.
- [ ] Seller A cannot read or mutate Seller B's private collection-management data.
- [ ] Seller A cannot attach Seller B's listing to Seller A's collection.
- [ ] Public API does not leak owner IDs, private profile fields, unpublished listing data, or internal moderation fields beyond the intentional public contract.
- [ ] Direct database access remains protected by RLS and the runtime role; no broad grants or policy weakening.
- [ ] Reordering and concurrent edits cannot move products across owners or duplicate collection membership.
- [ ] Start/end boundaries are tested at exact transition times, including timezone and daylight-saving-independent UTC comparisons.

## 5. Mobile, low-bandwidth and accessibility checks

- [ ] Test 320, 360, 375, 390, 414 and 640 CSS-pixel widths, plus common tablet/desktop breakpoints.
- [ ] Collection manager and public page have no page-level or component-level horizontal overflow.
- [ ] Images reserve layout space, load lazily where appropriate, and do not block text/contact details on slow connections.
- [ ] Controls have visible focus, accessible names, usable tap targets, and clear disabled/loading states.
- [ ] No important action relies on hover, animation, or high-bandwidth media.
- [ ] Test one physical Android phone on a constrained connection before claiming the mobile journey complete.

## 6. Sharing and discoverability verification

- [ ] Verify canonical URL, title, description, Open Graph image, Twitter card, robots/indexing behaviour for active and unavailable collections.
- [ ] Verify actual WhatsApp preview on mobile for a real seller-created collection.
- [ ] Verify copied URL opens in a logged-out browser and shows the correct seller/collection.
- [ ] Confirm no preview contains seed images, private data, or misleading price/availability claims.
- [ ] Confirm collection sharing does not imply Mudaala checkout or in-app payment.

## 7. Test data policy and production proof

- Use disposable CI fixtures and local/disposable PostgreSQL for populated collection tests.
- Do not create fake production sellers, listings, collections, likes, views, or testimonials to make the page look populated.
- When a genuine seller creates a collection naturally, obtain permission for the live verification and use only that seller's public content.
- Record the seller journey, collection URL, HTTP status, metadata checks, mobile/WhatsApp result, Worker version, commit, CI run, and timestamp without exposing personal/customer data.

## 8. Launch gate

Collections are ready for a public launch claim only when:

1. Ownership/privacy tests and all required CI checks pass on the exact commit.
2. Seller create/edit/reorder/add/remove/schedule flows are verified.
3. Buyer logged-out browsing and unavailable-state behaviour are verified.
4. Mobile and physical-device checks pass.
5. A genuine seller collection has been checked end-to-end, including actual WhatsApp preview.
6. Evidence is reconciled into both `docs/MASTER_CHECKLIST.md` and issue #163.

Until genuine production content exists, report populated collection verification as **UNKNOWN / waiting for real seller data**, not PASS. Keep promotions/bundles and unrelated storefront redesign outside this slice.
