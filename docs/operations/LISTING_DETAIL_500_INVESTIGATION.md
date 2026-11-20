# Listing-detail HTTP 500 investigation

**Prepared:** 2026-10-30 02:24 Africa/Kampala (UTC+3)  
**Scope:** Read-only source and Cloudflare Workers Observability review. No production requests were generated, no customer records were accessed, and no runtime/configuration changes were made.

## Evidence reviewed

- Active Worker script: `mudaala-cloudflare`; version 176, version ID `634a722b-68a8-4325-b58d-cae8b8d5a3b9`.
- Worker observability is enabled; log sampling is configured at 1.0 (100%).
- 24-hour window queried: 2026-10-28 23:26 UTC through 2026-10-29 23:26 UTC.
- Aggregated request telemetry returned 4 HTTP 500 responses on version 176. Two event records explicitly identify public `/l/{id}` page requests. The remaining two were not safely attributable to a route from the returned aggregate.
- Seven error-level records were returned. They included repeated bundled Worker stack frames, one `Network connection lost.` message, and two route-associated request error records. The bundled stack frames do not identify an application source line.
- No `exceededCpu` outcome appeared in the queried 24-hour outcome aggregation. This is a bounded observation, not proof that CPU issues are permanently fixed.
- The previous report's 17 CPU-limit failures are outside this latest 24-hour window and should not be carried forward as current-window counts.

## Source-path findings

1. Public listing pages are served by `src/app/l/[id]/page.tsx`.
2. Both `generateMetadata()` and the page body use `withRequestDb()`, so their database work is request-scoped.
3. The shared `loadAdRow()` helper in `src/lib/ad-page.ts` calls `expireOverdueListings()` before reading the requested listing.
4. `expireOverdueListings()` in `src/lib/listings.ts` queries up to 500 overdue active listings. When any are found, it runs an `updateMany` and `notification.createMany` in the buyer's page-render request.
5. The listing page then reads recent `PriceSnapshot` rows in `marketContext()` and attempts a best-effort `viewCount` increment.
6. The API detail route `src/app/api/listings/[id]/route.ts` also runs expiry work, loads seller/listing data, resolves the session, and attempts best-effort view analytics writes.

## Assessment

**Root cause: UNKNOWN.** The Cloudflare error stack is bundled runtime code and the available event payload does not correlate the stack to a specific database operation or source line. The `Network connection lost` event makes a transient connection/Hyperdrive/adapter failure a plausible lead, but does not prove that it caused either public page 500.

**Risk hypothesis to test:** synchronous expiry work on a public page request increases the amount of database work on the critical buyer path. This is a source-level observation, not a confirmed cause of the observed failures. Do not remove or change expiry semantics without tests for stale listings, notifications, and idempotency.

## Next diagnostic steps

- Correlate each 500's Cloudflare request ID/trace with adjacent Worker logs and Hyperdrive/Postgres pooler logs, keeping IDs and any customer content out of shared reports.
- Capture safe structured error fields at the public page boundary: route template, operation stage (`expiry`, `listing-read`, `market-snapshot`, `render`), error class, Worker version, and duration. Never log listing titles, seller details, session tokens, SQL parameters, IPs, or full URLs.
- In a disposable PostgreSQL environment, separately exercise the listing page loader with: no overdue listings, 1 overdue listing, a large overdue batch, database disconnect, and notification-write failure.
- Measure query count, CPU time, wall time, and response status for each stage before proposing a refactor.
- Consider moving bulk expiry/notification work off the synchronous page-render path only after a design preserves truthful public availability and a tested recovery path. The scheduled sweep remains the normal bulk maintenance mechanism.
- Add a regression test proving a transient optional market-snapshot/view-count failure cannot turn an otherwise valid public listing page into HTTP 500, if the current contract intends those operations to be best-effort.

## Release decision

No production fix is approved by this investigation alone. Keep the listing-detail reliability gate open until a reproducible cause is isolated, a focused test fails before the fix and passes after it, exact-head CI is green, and the deployed route is verified.
