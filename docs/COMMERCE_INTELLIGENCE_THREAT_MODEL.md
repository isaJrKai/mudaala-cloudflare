# Mudaala Commerce Intelligence — threat model

**Status:** Initial design baseline; not a penetration-test report.
**Applies to:** Buyer, merchant, supplier, WhatsApp, intelligence, moderation, advertising and future trade services.
**Security objective:** protect people, accounts, shop ownership, private evidence, product integrity, funds (if introduced later), platform availability and trust in Mudaala.

## 1. Assets to protect

| Asset | Impact if compromised | Minimum protection |
|---|---|---|
| Customer and merchant accounts | Account takeover, impersonation, privacy loss | Strong session security, MFA for privileged users, recovery controls, rate limits |
| Shop ownership and listing permissions | Attacker edits or publishes on another shop | Server-side ownership checks on every operation; tenant isolation tests |
| WhatsApp sender-to-merchant link | Unauthorised listings, data disclosure, account abuse | Single-use linking code, short TTL, atomic consumption, revoke/unlink, sender identity validation |
| Product images and private documents | Doxxing, fraud, harmful content exposure | Bounded uploads, byte validation, malware/content checks, metadata stripping, scoped access |
| Trust evidence and moderation cases | Defamation, unfair bans, evasion, privacy breach | Private evidence store, role-scoped access, append-only audit, appeal/reversal |
| Product catalogue and search ranking | Illegal goods, scams, manipulation | Policy gate before publication/ranking; provenance and abuse detection |
| Event and analytics data | Behavioural profiling, deanonymisation | Minimise fields, aggregate where possible, retention/deletion lineage, access control |
| Model prompts and outputs | Data leakage, prompt injection, unsafe actions | Data minimisation, schema validation, tool allowlists, no privileged tools in untrusted context |
| Secrets and service credentials | Full system compromise | Secret manager, least privilege, rotation, scanning, no client exposure |
| Platform availability | Outages, abuse, cost exhaustion | Shared rate limits, payload caps, quotas, queue backpressure, circuit breakers, tested recovery |
| Future payment/order records | Financial loss and legal exposure | Licensed partners, segregated roles, immutable state transitions, reconciliation, independent review |

## 2. Trust boundaries

1. Public browser / PWA to public API.
2. Authenticated customer to buyer-scoped API.
3. Authenticated merchant to shop-scoped API.
4. Meta WhatsApp Cloud API to webhook.
5. Webhook sender to linked Mudaala merchant identity.
6. Uploaded media to moderation and object storage.
7. Application service to PostgreSQL / Supabase / Hyperdrive.
8. Application to Cloudflare Durable Objects and any future Redis service.
9. Application to external AI/model providers.
10. Supplier evidence and third-party logistics/customs feeds to internal trust state.
11. Internal moderator/admin tools to private reports and enforcement actions.
12. Advertiser/campaign tooling to sponsored inventory.

Every boundary needs authentication, authorisation, validation, bounded resource use, logging that avoids secrets/PII and a defined failure mode.

## 3. Primary threat scenarios

### T1 — WhatsApp number impersonation or account takeover
**Attack:** A person sends a shop code or claims to own a shop in chat and attempts to publish listings.
**Controls:** authenticated in-app link initiation; cryptographically random one-time code; store only keyed hash; short expiry; strict attempt limit; atomic single-use consume; sender ID binding; owner notification; revoke/unlink; audit trail.
**Tests:** wrong sender, expired code, replay, brute force, concurrent consume, relink, revoked account, number change, cross-shop access.
**Failure rule:** no link, no merchant data and no publish capability.

### T2 — Forged or replayed Meta webhook
**Attack:** Attacker sends a forged callback, replays a valid message or floods oversized payloads.
**Controls:** HMAC over exact raw body; bounded streaming read and cancellation; shared Durable Object rate limit; strict payload parsing; message ID idempotency; short retention; secret rotation.
**Tests:** invalid signature, body tampering, missing/oversized Content-Length, stream overrun, malformed JSON, replay, burst, limiter outage.
**Failure rule:** reject invalid requests; do not downgrade shared rate limits to local memory.

### T3 — Cross-tenant IDOR / BOLA
**Attack:** User changes listing, shop, draft, document or analytics ID to access another tenant.
**Controls:** derive actor from authenticated session or verified webhook link; enforce ownership in domain service and DB policies; no client-supplied owner IDs; deny direct Data API access where appropriate.
**Tests:** two-merchant fixtures, read/update/delete/publish attempts across tenant boundary, RLS and service-role paths.
**Failure rule:** deny by default; no existence leakage beyond required public responses.

### T4 — Prompt injection through product text, images or supplier documents
**Attack:** Malicious seller embeds instructions in text, image OCR, metadata, PDF or supplier webpage to make the model reveal data or invoke tools.
**Controls:** treat all external content as data, never instructions; separate system policy from retrieved text; strip metadata; no unrestricted shell/network/database tools; tool allowlist; structured output; validate all proposed actions in deterministic domain services.
**Tests:** prompt-injection corpus, hidden OCR instructions, malicious URLs, malformed structured output, data-exfiltration attempts.
**Failure rule:** model can draft; only authorised domain service can act.

### T5 — Prohibited or dangerous goods bypass
**Attack:** Seller uses euphemisms, altered images, misspellings, category misclassification or WhatsApp uploads to bypass policy.
**Controls:** one shared policy gate on every publication path; text/category/image signals; aliases and local-language terms; jurisdiction-specific versioned rules; ambiguous review queue; re-check edits/reactivation; report/appeal flow.
**Tests:** multilingual aliases, image-only listings, misspellings, relisting, WhatsApp path, API path, supplier catalogue import.
**Failure rule:** known prohibited items blocked; uncertain regulated items held for review; no model-only approval.

### T6 — Fake trust, reviews or supplier credentials
**Attack:** Coordinated accounts fabricate reviews, business records, delivery proof or factory identity.
**Controls:** evidence provenance; source verification; reviewer/account graph signals; independent partner checks; confirmed-transaction evidence only; human approval for verified status; reversals and audit.
**Tests:** duplicate identities, reused docs, synthetic reviews, review rings, forged shipment events, stale evidence.
**Failure rule:** missing evidence stays unknown; never show verified badge from model confidence alone.

### T7 — Cache poisoning or stale authorisation
**Attack:** Stale cache serves private data or an old trust state; attacker manipulates cache keys.
**Controls:** cache only derived/non-authoritative data; tenant-aware keys; short TTL; explicit invalidation; no auth/session/trust verdict authority in cache; schema/versioned cache values.
**Tests:** cross-tenant key collision, stale revoked link, stale hidden listing, cache outage and poison payload.
**Failure rule:** fall back to authoritative database/policy; never trust cache for ownership or eligibility.

### T8 — Event poisoning and model feedback loops
**Attack:** Bots inflate views, clicks, likes, searches or conversion signals to manipulate ranking and ads.
**Controls:** server-observed events; rate/velocity checks; deduplication; bot filtering; confidence labels; robust aggregation; separate paid and organic signals; monitor feedback loops.
**Tests:** replay, burst, scripted click farm, one user multi-session, paid impression inflation.
**Failure rule:** untrusted events do not become purchase/delivery/identity evidence.

### T9 — Data leakage to AI providers or logs
**Attack:** Prompts, logs or traces expose phone numbers, addresses, private messages, documents or access tokens.
**Controls:** minimise and redact before provider calls; provider approval and retention review; no raw message body logging; secrets redaction; private evidence references; access controls and retention.
**Tests:** seeded canary secrets/PII in prompts and logs; provider timeout/error; telemetry inspection.
**Failure rule:** no raw private content in normal logs; provider failure falls back safely.

### T10 — Resource exhaustion and cascading failure
**Attack:** oversized uploads, high-cardinality events, webhook bursts, model loops, database connection spikes or cache outages exhaust CPU/memory/connections.
**Controls:** strict request/response sizes, timeouts, concurrency limits, bounded queues, backpressure, per-tenant quotas, circuit breakers, DB pool caps, cost budgets, graceful degradation.
**Tests:** burst/load tests, provider outage, queue backlog, DB saturation, large image and webhook bodies.
**Failure rule:** Browse and existing shop pages remain usable when non-critical intelligence is offline.

### T11 — Moderator/admin compromise or insider misuse
**Attack:** Privileged user accesses private evidence, changes trust state or exports user data.
**Controls:** MFA, least privilege, role separation, just-in-time access where possible, reason codes, immutable audit, dual approval for severe actions, alerting.
**Tests:** role matrix, privilege escalation, audit completeness, session revocation, export access.
**Failure rule:** sensitive evidence is inaccessible to ordinary merchants and buyers.

### T12 — Cross-border trade misrepresentation
**Attack:** Fake supplier, counterfeit goods, inaccurate landed cost, invalid customs claims or false delivery ETA.
**Controls:** source provenance and freshness; supplier verification levels; quote expiry; official tariff data/qualified clearing-agent validation; clearly labelled estimates; carrier-confirmed vs predicted milestones; explicit partner responsibilities.
**Tests:** stale quote, currency changes, missing HS code, excluded tax/freight, fake tracking, route disruption.
**Failure rule:** do not promise customs clearance, product compliance, delivery or buyer protection without verified evidence and accountable partners.

### T13 — Ad-driven trust manipulation
**Attack:** Advertiser pays to boost unsafe goods, impersonates a brand or targets vulnerable users.
**Controls:** policy/trust eligibility before ad auction; clear sponsored labels; advertiser identity checks; frequency caps; restricted targeting; campaign audit and complaints.
**Tests:** ineligible listing campaign, mislabeled ad, sensitive audience segment, repeated impressions.
**Failure rule:** payment never changes trust status or bypasses moderation.

### T14 — Data deletion and retention failure
**Attack:** Deleted account's personal data persists in derived profiles, event streams, caches, embeddings or backups without defined treatment.
**Controls:** data lineage; retention schedules; deletion/tombstone workflow; cache invalidation; derived-profile rebuild/deletion; backup expiry and legal hold process.
**Tests:** delete/export workflow across source, events, cache, search index and model feature store.
**Failure rule:** no new data store until its deletion/retention owner is defined.

## 4. Security control ownership

| Control area | Owning domain | Required reviewer |
|---|---|---|
| Login/session and account recovery | Identity | Security reviewer |
| Shop/listing ownership | Commerce domain | Security reviewer |
| Meta signature and sender link | WhatsApp adapter + Identity | Security reviewer |
| Prohibited goods and listing moderation | Trust & Safety | Policy owner + moderator |
| Trust evidence and verification badges | Trust domain | Human verification owner |
| Event collection and consent | Data governance | Privacy reviewer |
| Model routing and prompt isolation | Model gateway | Security + privacy reviewer |
| Redis/cache and queues | Platform infrastructure | Reliability reviewer |
| Ads eligibility and targeting | Advertising | Trust + privacy reviewer |
| Supplier, customs and shipping claims | Trade operations | Qualified partner / compliance reviewer |

## 5. Release gates

No capability moves from shadow mode to user-visible production until all applicable gates pass:

- [ ] Threat model updated for the exact feature and data flow.
- [ ] AuthN/AuthZ and tenant isolation tests pass.
- [ ] Abuse, replay, idempotency and rate-limit tests pass.
- [ ] Prohibited-goods policy coverage includes all entry paths.
- [ ] Privacy purpose, consent, minimisation, retention, export and deletion are documented.
- [ ] Secrets, logs, storage ACLs and provider retention are reviewed.
- [ ] Unit, integration, browser and negative-path tests pass.
- [ ] Load, timeout, queue-backlog and dependency-outage tests pass.
- [ ] Monitoring and alerting are operational without logging raw PII.
- [ ] Human review, appeal, incident response and rollback are ready.
- [ ] Model quality and subgroup error analysis meet documented thresholds.
- [ ] Founder explicitly approves the release.

## 6. Current known limitations

This is an initial threat model, not proof that controls are implemented. The repository's existing marketplace trust-and-safety plan already records that image moderation depends on production secret configuration and live verification, and that ambiguous-content review remains a gap. Do not claim all marketplace content is fully moderated until those gates are evidenced.

The WhatsApp security foundation is separate from a complete assistant. Merchant linking, media intake, draft approval and publishing remain unimplemented until their own code and tests are reviewed.

No penetration test, independent security audit, production restore drill or certification is claimed by this document.
