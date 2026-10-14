# Priority 1: Identity and Abuse Resistance — Architecture Decision Record

**Status:** Proposed; read-only audit complete enough to define requirements, implementation choice not yet approved  
**Date:** 2026-10-14  
**Scope:** Registration, login, password reset, sessions, administrator authorization, shared rate limits, browser request integrity  
**Production changes:** None made during this audit

## 1. Objective and acceptance standard

Treat identity and abuse resistance as one security boundary, not six independent endpoints. The system must preserve account isolation and availability while making security guarantees explicit, testable, observable, and safe to operate on Cloudflare Workers + Supabase/Postgres.

A control is not complete because it exists in code. It must have a written threat and failure model; deterministic unit and integration tests, including concurrent requests where relevant; verified production configuration without disclosing secret values; observable failure behavior and operator instructions; a tested migration and rollback path; and post-deployment verification that does not modify real customer data.

## 2. Read-only findings

### Existing controls worth preserving
- Registration normalizes phone numbers, checks uniqueness, validates passwords, records terms version/acceptance, and applies an IP account-creation cap.
- Passwords use salted scrypt hashes; comparison uses timing-safe equality.
- Login uses generic invalid-credential responses and per-phone/per-IP limits.
- Password-reset requests are designed to avoid account enumeration; reset codes are hashed, expire after ten minutes, and are invalidated after five sequential incorrect attempts.
- A successful reset transaction updates the password and deletes all of that user's sessions. Logout deletes the current session.
- Bearer authentication is gated by an explicit environment flag in server code.
- Admin routes use a fail-closed ADMIN_PHONES allowlist. Moderation actions write AuditLog records.
- Account deletion requires the current password and database cascades remove the user's sessions. Data export omits password hashes, reset code hashes, and session token IDs.

### Confirmed gaps and risks
1. **Production rate limiter is process-local.** The deployed Worker settings were inspected without reading secrets. REDIS_URL is absent from the deployed Worker bindings. The limiter therefore selects in-memory counters. Per-isolate memory cannot guarantee one global budget across Worker isolates or restarts.
2. **Redis implementation is not atomic.** Even when configured, it performs prune, count, and insert as separate commands. Concurrent requests can race between count and insert and exceed the configured cap.
3. **Rate-limit outage semantics are misleading for security-sensitive routes.** Redis failures fall back to process-local memory. That may preserve service availability, but it does not preserve a global abuse-control guarantee.
4. **Reset-code attempts are not concurrency-safe.** The route reads attempts, computes attempts + 1, then updates separately. Concurrent submissions can overwrite increments. Successful code consumption can also race because validity is read before the transaction and the update does not condition on unused status, expiry, or expected version.
5. **Reset submission has no independent IP/phone budget.** The code has a request-to-send budget, but reset-password itself does not call the shared limiter. The five-attempt limit is useful but should not be the only layer.
6. **Signup has no verified-phone state or OTP lifecycle.** Registration creates a full account and session immediately. The User model has no phoneVerifiedAt or equivalent verification record.
7. **Admin privilege is coupled to phone-number possession.** Admin authorization matches the user's current phone against ADMIN_PHONES. Recycled numbers, account recreation, and admin handover need an explicit model. The secret binding exists, but its value was not read.
8. **Bearer token persists in browser localStorage.** The client stores the returned session token and attaches it as a Bearer token. Server-side bearer auth is intended to be off in production, but returning and storing a reusable credential unnecessarily increases exposure if the flag is ever enabled or deployment configuration drifts.
9. **Cookie policy needs CSRF review.** Every non-local host receives SameSite=None; Secure. httpOnly prevents script reads of the cookie but does not itself prevent CSRF. Production origins, embed requirements, and state-changing route behavior must be inventoried before choosing Lax or an explicit CSRF/Origin defense.
10. **Session lifecycle needs a unified policy.** Sessions last 30 days; reset revokes all, logout revokes the current one, and expired sessions are opportunistically deleted during session creation. Review revocation after admin privilege changes, phone changes/recycling, and security-sensitive actions.
11. **Tests do not yet establish the concurrency and deployment guarantees above.** The suite covers sequential login lockout, reset lifecycle, session revocation, ownership, and admin walls. Tests for concurrent reset attempts, concurrent shared rate-limit updates, production isolate behavior, CSRF, and privilege handover were not established by this read-only review.

## 3. Target design

### 3.1 Phone verification lifecycle
- Add explicit verification state and timestamps; do not treat an entered phone number as verified.
- Model OTP issue, expiry, consumption, attempts, resend cooldown, and delivery status with a single-use state transition.
- Generate codes cryptographically; store only a keyed hash or otherwise ensure a database-only leak cannot cheaply recover active low-entropy codes.
- Enforce per-phone, per-IP, and provider-budget limits before sending SMS; add resend cooldown and abuse telemetry.
- Prevent replay and concurrent double-consumption with conditional database updates/transactions.
- Keep public browsing and low-risk onboarding usable where appropriate, but gate sensitive actions according to a documented verified/unverified policy. OTP establishes current control of a number, not legal identity or business verification.
- Provider failure must not create a false verified state. Do not leak whether a phone is registered in responses.

### 3.2 Shared rate-limit service
The shared limiter must provide an atomic consume(key, limit, window) operation with a documented algorithm, expiry, and Retry-After. Keys should be derived from normalized identities and trusted client IPs without logging raw phone numbers or codes.

Candidate implementations to compare before choosing:
- Cloudflare Durable Objects with a binding compatible with the OpenNext/Worker runtime, using serialized per-key or bounded-shard operations and persistent state; or
- a supported external shared store accessed from Workers, with a truly atomic server-side script/transaction and verified connectivity.

Choose based on atomicity, Worker compatibility, cold-start behavior, hot-key contention, cost, retention, privacy, and failure recovery—not familiarity alone. Avoid creating unbounded resources from attacker-controlled keys; hash or shard keys safely.

Define route-specific outage behavior. Sensitive OTP issuance/verification and authentication lockout must not silently fall back to local counters while reporting the same protection. Return a controlled 503 or use a separately justified emergency control when the shared limiter is unavailable; document the availability trade-off. Do not lock ordinary browsing behind the auth limiter.

### 3.3 Password reset as an atomic state machine
Use explicit states equivalent to ACTIVE, CONSUMED, EXPIRED, and LOCKED, with a monotonically increasing attempt count. Every invalid attempt must be counted atomically, and the fifth failed attempt must make the code unusable even under concurrency. Successful consumption must be a conditional transition that can succeed only once while the code is unexpired and below its attempt ceiling. Password update, reset consumption, and session revocation must commit in one transaction. Add independent IP and phone budgets to submission, not only SMS issuance.

### 3.4 Sessions and browser request integrity
- Preserve server-side opaque sessions and enforce expiry on every authenticated request.
- Store a digest of session tokens rather than reusable raw bearer credentials where practical, with a migration plan that permits controlled invalidation/re-login rather than ambiguous dual formats.
- Keep production cookie authentication as the default. Do not issue or persist a browser Bearer token in production unless there is a documented, separately secured client requirement.
- Restrict bearer fallback to explicit non-production preview environments; add a deployment assertion so accidental production enablement fails visibly.
- For the first-party production app, prefer the narrowest viable cookie policy (likely SameSite=Lax) after confirming no required cross-site embedding. If cross-site use is genuinely required, keep SameSite=None; Secure only with strict Origin validation and an appropriate CSRF defense on state-changing cookie-authenticated routes.
- Define revocation triggers: logout current session; password reset revokes all; account deletion cascades; administrator access removal takes effect immediately; future phone change/verification reset invalidates relevant sessions or forces re-authentication.
- Consider session listing/revocation and last-used signals only when designed to avoid excessive database writes and privacy leakage.

### 3.5 Administrator identity and auditability
- Move from mutable phone matching toward explicit stable administrator user IDs and a small role/permission model. A phone may remain a contact/recovery channel, not the sole durable authority.
- Bootstrap must be fail-closed, documented, and recoverable if all admins lose access. Never grant admin because a public signup happens to reuse a configured phone.
- Role changes and sensitive admin actions should record actor ID, action, target, timestamp, outcome, and safe contextual metadata. Restrict audit access; define retention and alerting. Audit logs are operational evidence, not a tamper-proof ledger.
- Migrate existing admin access with a staged, tested overlap and rollback plan. Do not lock out the legitimate owner or mutate live roles until test identities prove positive and negative paths.

## 4. Implementation sequence (no production changes yet)

1. **Complete inventory:** enumerate all routes and actions that depend on sessions or admin status; establish actual production origin and trusted-IP behavior; inspect only environment binding names/types, never secret values.
2. **Architecture proof:** build an isolated prototype of the selected shared limiter and demonstrate atomic behavior under concurrent requests. Compare candidate implementations with measured latency, cost, and operational constraints.
3. **Tests first:** add deterministic tests for concurrent limiter consumption, reset attempt increments, one-time reset consumption, concurrent valid reset submissions, generic responses, provider failure, cookie/CSRF behavior, bearer flag guardrails, and admin identity handover.
4. **Schema and migration plan:** define phone verification and durable admin identity/role fields; plan backfill for existing accounts and admin bootstrap; test against disposable Postgres and rehearse rollback.
5. **Implement on a focused branch:** no live data mutation, no broad refactor, preserve existing login for unverified legacy users under a documented transition policy.
6. **Review and CI:** run lint, typecheck/build, full API suite, migration checks, concurrency tests, and security-focused regression tests. Obtain independent review of threat model and diff before merge.
7. **Staged rollout:** deploy compatible schema/code first; verify with an authorized disposable identity; monitor errors and provider/limiter behavior; enable enforcement gradually where possible.
8. **Production verification:** confirm positive and negative auth/admin paths, global limit enforcement across distinct requests, reset revocation, and CSRF defense. Use no real customer account or production data for test mutations.
9. **Operational runbook:** document rate-limit outage response, OTP provider outage, admin lockout recovery, session revocation, rollback, and evidence to collect during incidents.

## 5. Release gates

Do not mark Priority 1 complete until:
- Shared rate limiting is demonstrably atomic under concurrency and deployed configuration is verified.
- No security-sensitive auth/OTP path relies solely on per-isolate in-memory counters.
- Reset attempts and code consumption are race-safe.
- Phone verification state is explicit, abuse-limited, and replay-resistant.
- Admin authorization is stable across phone recycling and has a tested recovery path.
- Production does not unnecessarily store reusable Bearer credentials in localStorage.
- CSRF/Origin behavior is explicitly defended and tested for the actual deployment origins.
- All changes pass CI and a reviewed migration/rollback rehearsal.
- Live verification uses an authorized disposable identity and leaves customer data untouched.

## 6. Rate-limit backend evaluation (evidence gathered 2026-10-14)

The production requirement is an authoritative per-phone/per-IP budget for sensitive flows, not merely a fast approximate edge signal.

| Candidate | Strength | Limitation for Mudaala | Decision |
|---|---|---|---|
| Cloudflare Workers Rate Limiting binding | Native, low latency, route/key-specific, easy to add as a coarse edge layer. | Cloudflare documents it as per-location, permissive, and eventually consistent; it supports only 10- or 60-second periods. It is not an exact global 15-minute/hour sliding-window counter. | Useful as supplementary coarse protection; not the source of truth for OTP/reset lockouts. |
| Durable Objects | Stateful coordination with serialized per-object execution and persistent storage; supports exact conditional updates. Natural fit for per-key atomic budgets. | Requires adding a Worker binding/class, a safe integration path from OpenNext server code, bounded storage/expiry cleanup, and load tests. A single global object would be a bottleneck; object/key cardinality and abuse costs must be controlled. | Strong candidate for authoritative shared limiter, subject to a small prototype and deployed-runtime test. |
| External Redis | Familiar shared store; atomic Lua/script can implement the current sliding window. | No REDIS_URL is configured today; adds a paid/operated dependency, connection and timeout behavior, and a code change to make the current multi-command sequence atomic. | Viable fallback if DO integration or measured throughput/cost is worse. Do not simply add the URL to current code. |
| PostgreSQL atomic upsert | Existing managed database and one-statement atomic fixed-window counter avoid a new provider. | Adds writes to the database on each limited request and can couple abuse defense to database capacity/outages; fixed-window semantics need explicit analysis. | Benchmark as a low-operational-complexity alternative, not the default without load evidence. |

Cloudflare references:
- Workers Rate Limiting binding (locality and eventual-consistency limitations): https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/
- Durable Objects rules and coordination patterns: https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/

### Prototype requirements
Before choosing, implement a minimal disposable prototype with the same consume(key, limit, window) contract and test it with concurrent bursts, expiry, cold starts, storage cleanup, simulated dependency failure, and multiple distinct keys. Record p50/p95 latency and approximate cost. Do not send production authentication traffic through a prototype. The chosen implementation must expose provider health without logging raw phone numbers, OTPs, or tokens.

## 7. Open decisions
- Which shared limiter backend best meets Worker runtime, atomicity, cost, and operational requirements?
- What privileges should unverified accounts have during rollout, including legacy accounts?
- What is the authoritative admin bootstrap/recovery mechanism and who may approve changes?
- Does any supported production experience require cross-site iframe authentication?
- What session lifetime and revocation UX best balances account safety with intermittent connectivity and shared/low-cost devices?
