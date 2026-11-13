# Mudaala experimental storefront design

Status: exploratory prototype only. This document is not authorization to replace production UI.

## Approved visual reference

The approved reference is the Mudaala homepage concept image reviewed in the design conversation on 2026-11-13. Treat its composition as the target, not a loose mood board:

- Warm cream/off-white page surfaces.
- Forest/leaf green for primary actions and navigation; mango yellow for emphasis.
- Rounded, calm geometry with subtle borders and restrained shadows.
- Real photography as the primary visual language: product images, shop imagery, showroom/lifestyle photography and category photographs. Avoid icon-only category tiles and text-only discovery shelves.
- A wide editorial hero with lifestyle photography and a short headline.
- Visual category tiles, followed by a curated collection, featured shops, popular showrooms, and a mixed-category trending product shelf.
- Consistent top search/location/navigation structure and a clear seller entry point.
- The visual balance, spacing, proportions and hierarchy should closely follow the reference.

## Product principles

Mudaala is a multi-niche local commerce destination, not a vertical marketplace. Test every concept with at least:
- Clothing and apparel
- Electronics and phones
- Groceries and fresh produce
- Home and furniture
- Flowers and gifts
- Hardware and tools
- Beauty and health

Do not make one niche the default visual template. Presentation can adapt to the product type, while the overall design system remains coherent. Fresh tomatoes should look thoughtfully presented as groceries; they should not be styled to imitate luxury fashion.

## Navigation and information architecture

Preserve the application's real destinations and their separate jobs:
- Home: curated entrance to the marketplace.
- Browse: practical product search, filters and category-led shopping.
- Explore: open-ended discovery across products, sellers and local activity.
- Shops: business directory and merchant identity.
- Showrooms: visual, spatial and collection-led seller presentation.

The homepage reference is a composition example, not a reason to collapse all destinations into one screen or remove existing tabs.

## Safety rules for the experiment

1. Work only on `experiment/premium-multicategory-storefront`.
2. Do not merge this branch or deploy it to `mudaala.store` without explicit approval.
3. Do not alter production data, Supabase schema, Hyperdrive, storage, auth, payment, API contracts or merchant workflows for a visual experiment.
4. Keep production and its current recovery point intact.
5. Use clearly labelled illustrative content only in the concept preview; never imply sample merchants, prices or products are live inventory.
6. Build the design incrementally and review Home first, then Browse, Explore, Shops and Showrooms.
7. Preserve accessibility, responsive behaviour, existing navigation and working interactions.
8. Before enabling a Cloudflare Worker Preview, verify preview-specific bindings/secrets and database isolation. Do not let an experimental preview point at production write paths.

## Review criteria

- The page feels like a professionally curated shopping destination, not an admin dashboard or generic card catalogue.
- Photography does most of the visual communication.
- Shops, showrooms, products and categories each have a recognisable place.
- The composition accommodates all supported niches.
- The design is coherent on desktop and mobile.
- Existing production remains unchanged until the user approves a specific incremental release.
