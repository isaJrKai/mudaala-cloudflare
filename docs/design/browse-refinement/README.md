# Browse page refinement: handoff for ChatGPT

**Branch:** `design/browse-refinement`
**Visual reference:** `docs/design/browse-refinement/browse-refined.html` (open in a browser; static, tinted placeholders instead of photos)
**Target code:** `src/components/commerce/listings-browse.tsx` plus `listing-card.tsx`, `app-sidebar.tsx`, `home-view.tsx` as needed
**Stack:** Next.js 16, React 19, Tailwind 4, Prisma. Keep the existing palette (cream, forest green, marigold as the single action/deal color) and fonts.

## Goal
Make Browse feel organized like Jumia: more shop exposure, clearer offers and former prices, grouped sections. Match the reference HTML. Visual and layout work only; no new features beyond the data wiring below.

## Read first (rules that override this design)
- `docs/PRODUCT_ETHICS_AND_CONTENT_STANDARDS.md`: no fabricated badges, reviews, sales counts, scarcity or fake urgency. **No "Verified" badge anywhere** (`User.verified` stays false in V1). No countdown timers.
- Do not invent data. Empty sections must hide or show a real empty state, never fake cards.

## Changes, top to bottom
1. **Category chips** under the search bar (All + real categories from the existing category list). Filters button stays.
2. **Hero:** left "Shop of the day" spotlight (shop name, area, shop code, up to 3 of its real listings, Visit shop + Call). Right: two tiles, "Deals" (links to a discounted-only filter) and "Sell on Mudaala" (links to Post).
   - Pick the featured shop by a transparent rule (e.g. most recently refreshed active listings), rotating daily. No paid placement. Label stays "Shop of the day".
3. **Shops near you:** grid of shop cards (cover band, avatar, name, category, area, Visit shop), directly under the hero. Use real shop data; hide the section if there are none.
4. **Hot deals row:** listings where `compareAtPrice > price`. Show discount pill (`-30%` computed), new price bold, old price struck through. Hide the row if none.
5. **Category rows** (e.g. Phones & electronics): same card, grouped by category, "See all" link to the filtered browse.
6. **Listing card:** image with photo counter (replace the "+" button), discount pill only when a discount exists, title, price, unit, location and quantity on one line, shop row (avatar + name), then Call and WhatsApp. Remove the "OFFER" tag from OFFER cards. Pricing states:
   - `price == null`: "Get a quote" (replaces "Ask seller")
   - `priceNegotiable`: "Negotiable" badge
7. **Buyers are asking:** `type = REQUEST` listings in their own section with "Budget USh X" and an "I have this" action (opens WhatsApp/call to the buyer), next to a "Post a request" card.
8. **Shop clusters:** when one shop has 3+ near-identical listings in the feed (same title), collapse into one card with up to 4 thumbnails and "View all N". Dedupe rule must be deterministic and must not hide listings from search results or the shop page.
9. **Pagination:** replace "Page 1 / 2" with a "Load more listings" button.
10. **Sidebar:** keep nav, Alerts count badge, Post an ad, and the "Have a shop code?" box pinned at the bottom (shop codes like `MD-5676`).

## Acceptance
- Desktop (1280-1440) matches the reference; below 900px the sidebar hides and rows stack to one column (bottom nav already exists).
- Tap targets at least 44px, text contrast at least 4.5:1, real `<button>`/`<a>` elements.
- Existing tests, lint and `knip` still pass; no schema changes needed (`compareAtPrice`, `priceNegotiable`, `type`, `shopCode` already exist).
- Open a PR into `main` with before/after screenshots.
