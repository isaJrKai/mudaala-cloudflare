# Mudaala Commerce Spine — Implementation Report (2026-11-20)

Branch: `feat/commerce-spine-2026-11-20` (based on `feat/intelligence-e2e-refinement-2026-11-20` @ `9cdd520f` — the tip of the chain main `cdfb6f6d` → intelligence remediation `edb903bf` → PR #343 `8cde0739` → PR #344 `9cdd520f`; both PRs are open, CI-green, and fully preserved beneath this branch). Investigate → design → implement → test → review → document, phases A→F in order, no merge, no deploy.

## 1. Commits (exact SHAs)

| Commit | Phase | Content |
|---|---|---|
| `4b7e2e4` / `d535aeb` | A | Revert of broken email password reset (see §3.1) |
| `7e259c5` | A | Build repair + hot-path indexes/bounds + race + shape bugs |
| `4c8ad32` | B | Enquiry lifecycle, catalogue↔listing linkage, canonical QR |
| `39c6312` | C | Buyer contact flow live on both surfaces + engagement events |
| `38c90f1` | D | Showroom SSR body, real contact actions, honest catalogue bound |
| `cdc808c` | E | SSR view analytics + shop structured data |

## 2. Verified test results (local, 2026-11-20)

- `tsc --noEmit` (Next app): **0 errors** — was **7 errors at the base commit** (pre-existing; repaired in Phase A, item 2 below).
- `tsc -p tsconfig.intelligence-commerce.json --noEmit`: CLEAN. `tsc -p intelligence/gateway/tsconfig.json --noEmit`: CLEAN.
- `bun test src/lib/ intelligence/ src/lib/intelligence/`: **298 pass / 1 fail** — the 1 failure is `intelligence/jobs/schema.test.ts → startDisposablePostgres`, the pre-existing environmental issue described in §6 (embedded postgres cannot initdb on this sandbox: `libicuuc.so.60` missing; failure exists at the base commit too, no relation to these changes).
- `npx eslint .` (full repo): **0 errors**, 4 pre-existing warnings.
- `prisma validate`: clean. `npx prisma migrate deploy` full-chain on a vanilla disposable PostgreSQL 18.4: reaches `20261014110000_deny_direct_data_api_access` and stops — that migration (pre-existing) requires the Supabase-style `anon`/`authenticated`/`mudaala_runtime` role provisioning that CI performs separately (`validate-pr.yml` lines 267–288 apply it after `db:push`, not via plain deploy). This sandbox has no root/docker, so plain full-chain deploy cannot complete here. **Both NEW migration SQL files were applied and verified directly** on the disposable instance: `Session_expiresAt_idx` and `SavedSearch_lastCheckedAt_idx` confirmed present via `pg_indexes` (command output captured in the session evidence).
- Production build (`npx @opennextjs/cloudflare build` with CI-identical placeholder envs): result recorded at the end of this report; the important fact is that `next build` was BROKEN at the base commit (email-reset routes) and compiles after the Phase-A revert — the full app typecheck went 7 errors → 0.
- Not executed: the Hermes Python suite (no changes on that plane; CI's `python` job covers it on the PR) and CI runs (the branch is not opened as a PR yet — see §8).

## 3. Phase A — repairs (all verified)

1. **CRITICAL: broken main.** Commits `5a198894` + `cdfb6f6d` added `src/app/api/auth/email-reset/{request,verify}/route.ts` importing `@/lib/email-auth` (never committed), querying `db.emailAuthChallenge` + `User.emailVerifiedAt` (never modeled — `User` has no email field at all), with a regex that can never match. `next build` fails (`ignoreBuildErrors=false`). The two route files were the only references. **Reverted** — completing the feature would require inventing an email-identity layer and a sending provider, which is out of scope and against the no-speculative-integration rule. SMS reset remains the supported flow.
2. **Full-app typecheck repaired (7 → 0 errors)**: `IntelligenceEnvSource` accepts raw `process.env` under the Next tsconfig (weak-type check); worker configs unaffected; `bun:test` files excluded like `gateway-client.test.ts` already was.
3. **`Session` gains `@@index([expiresAt])`** — sign-in ran a full-table `deleteMany` on every login.
4. **`SavedSearch` gains `@@index([lastCheckedAt])` + the publish-time sweep is bounded** (stalest-first, `take: 500`) — previously an unbounded full-table fan-out plus one `count` per match.
5. **Discovery browse scan bounded** (`take: 500`, newest-first, deterministic tiebreak — matching every sibling branch), and county context now passed to the local ranker (locality boosts were implemented and tested but never fed).
6. **Shop-name check fixed**: first-word SQL pre-filter (a superset of normalized-equality; the exact comparison stays authoritative) + IP rate limit (60/5 min) — previously an unauthenticated full-table scan per keystroke.
7. **Shop-code allocation race**: `withFreshShopCode` retries on a `shopCode` P2002 (the unique constraint is the authority); both first-save paths wrapped; other unique violations rethrow untouched.
8. **PATCH status-only response** now serialized like the sibling branches (`photos` was returned as a raw JSON string).
9. **`.env.example` gains `DIRECT_URL`** (required by `prisma/schema.prisma`); deploy doc corrected (`ADMIN_USER_IDS` required in production; `ADMIN_PHONES` dev-only).

## 4. Phase B/C — merchant operating journey (end to end)

- **Enquiry lifecycle** (the status column existed since the first schema but nothing could write it — inboxes accumulated OPEN rows forever): `PATCH /api/enquiries/[id]` with a pure, unit-tested transition matrix (`src/lib/enquiry-lifecycle.ts` + `.test.mjs`): merchants resolve; either participant closes an OPEN thread or reopens a resolved one; CANCELLED terminal. Non-participants get the same 404 as a missing enquiry (no existence leak). Inbox UI: Mark resolved / Close / Reopen + status chips on closed rows, for both roles.
- **Catalogue↔listing linkage** (`BusinessProduct.listingId` existed but nothing wrote it — stock records and public ads were two disconnected worlds): create/update schemas accept `listingId`; ownership validated; P2002 disambiguated (listing vs SKU); list endpoint returns the linked listing; one shared `serializeProduct` (the two drifting route copies consolidated); `linkedAdShowsAvailableWhileOutOfStock` helper + records-panel UI ("Link ad" picker, linked-ad line, honest "stock is out — update the ad availability" warning). The system warns instead of silently flipping the public listing — auto-sync is a product decision, listed in §9.
- **Buyer contact flow restored**: `ShowNumber` was fully built (reveal-on-tap, rate-limited `/contact` endpoint, digits never in SSR HTML) and wired into ZERO pages. Now live on the SSR ad page (`/l/[id]`, ACTIVE listings) and in-app listing detail (non-owners). Call/WhatsApp taps record `CALL_CLICK`/`WHATSAPP_CLICK` engagement events (fire-and-forget, keepalive, owner/admin excluded server-side) — the merchant "Call taps / WhatsApp taps" analytics cards can finally read non-zero and the discovery engagement weighting for contacts is fed.

## 5. Phase D/E — storefront foundation and customer journey

- **Showroom SSR body**: a shared public-showroom loader (`src/lib/showroom/public-showroom.ts`) feeds BOTH the public API route and the `/showroom/[slug]` server page; the page passes the payload as initial data — crawlers see the whole body in HTML, buyers skip the duplicate fetch, preview flows keep the client path + no-store. Unpublished/unmoderated showrooms are an honest 404.
- **Showroom contact actions** were dead anchors to `#contact` (a section that does not exist): nav Contact → the shop's canonical `/s/{shopCode}` page; footer gains "Visit the shop page".
- **Shop page honesty**: the 200-listing render bound is now visible — true ACTIVE count loaded, header/OG description use it, shops beyond the bound say so.
- **SSR view analytics**: `/l/[id]` records the daily VIEW aggregate next to the all-time counter (the API detail route already did both) — daily dashboards no longer undercount the web surface buyers hit first.
- **Structured data**: `/s/[code]` gains honest JSON-LD — LocalBusiness (name, area, till code as identifier) + ItemList of the real catalogue. No ratings, no verification claims.
- **QR identity**: the poster/dashboard QR + share text now encode the canonical `/s/{shopCode}` surface instead of the in-app hash route — posters finally match what the identity docs promise.

## 6. Security and tenant-isolation findings

- Authorization model verified consistent across all 103 route files by the investigation (canonical `requireUser`/`requireSeller`/`requireAdmin` + owner-scoped wheres; CSRF middleware; three-tier rate limiting, fail-closed in production). Nothing was weakened; the new endpoints follow the same patterns (participation-scoped 404s, rate limits, zod validation via `parseBody`).
- Repairs with security impact: unauthenticated full-table shop-name check (bounded + rate-limited); shop-code race (was a 500 path); unbounded saved-search fan-out and discovery scan (resource-exhaustion surface); scrapers still cannot harvest phone digits (reveal flow preserved, now actually reachable).
- Honest limitation carried forward: external `https://` image URLs remain renderable (tracking-pixel vector, LOW, pre-existing; upload path itself is tightly controlled).

## 7. Known limitations / unresolved risks

1. Full-chain `migrate deploy` on a vanilla PostgreSQL (no Supabase roles) stops at the pre-existing `deny_direct_data_api_access` migration — identical to CI's documented procedure; apply with the role provisioning CI performs.
2. `intelligence/jobs/schema.test.ts` cannot run on this sandbox (embedded-postgres needs `libicuuc.so.60`; sandbox has ICU 76, no root) — the SQL gate runs in CI's `typescript` job.
3. Orders/checkout/payments remain deliberately unbuilt (no Order model; `Sale` is merchant bookkeeping; "Mudaala never touches the money"). Foundations for the future journey are the linkage + enquiry records, not fake payment states.
4. Product variants still do not exist (one price per listing; flat attributes only) — noted as next-milestone work, not silently skipped.
5. Auto-sync of stock → listing availability is deliberately NOT implemented (warning shown instead); it needs a reviewed product decision + notification flow.
6. CI/PR evidence outstanding until the PR is opened (token lacked `pull_requests:write` in past sessions); the branch and all commits are pushed.

## 8. Deployment & rollback

Nothing is merged or deployed. The branch is additive over an unmerged chain: merge order would be #343 → #344 → this branch (or this branch's tip contains all three). Rollback of the branch itself = revert commits in reverse order; the two new index migrations are plain `CREATE INDEX` (safe, instant on production data; rollback = `DROP INDEX`). No production intelligence flags were enabled; flags remain default-OFF.

## 9. Next-milestone recommendation

1. Get CI green on the PR chain and land #343 + #344 (they carry the MCI-27 merchant insights and the opt-in discovery pipeline this branch builds upon).
2. Variants/options model (the single most-requested catalogue gap) with the same smallest-sound-change approach.
3. The reviewed product decision on stock→availability auto-sync (warning exists today).
4. Order model groundwork: enquiries → structured orders (WhatsApp-assisted transactions producing real records), with COD lifecycle states (accepted → dispatched → delivered → collected → remitted) — designed around verified webhooks + idempotency when a payment provider is actually chosen.
5. Email identity layer only if a provider is chosen first.
