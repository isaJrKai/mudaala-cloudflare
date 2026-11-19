# Mudaala Commerce Intelligence — 40-module registry

**Status:** Assignment register; all modules are proposed until implementation and evaluation evidence exists.
**Rule:** A module may be a deterministic service, statistical model, ML model, moderation control or AI-assisted workflow. It is not automatically a separate LLM.
**Shared contract:** Inputs are authorised, minimised, versioned data; outputs are typed recommendations/evidence with provenance, confidence where meaningful, model/policy version and trace ID. No module may directly mutate critical business state outside its owning domain service.

## A. Discovery and ranking (01–08)

| ID | Module | Responsibility | Primary inputs | Output | Guardrail / acceptance |
|---|---|---|---|---|---|
| MCI-01 | Query understanding | Parse intent, category, product attributes and local terms | Search text, locale | Typed query plan | Must preserve original query; test Ugandan terms, typos and multilingual queries |
| MCI-02 | Retrieval planner | Select keyword, filter and semantic retrieval paths | Query plan, catalogue index | Candidate set | No access to private/draft listings; bounded query cost |
| MCI-03 | Product relevance ranker | Rank eligible products for a query | Query, product features | Ranked candidates | Offline NDCG/Recall and online relevance; deterministic baseline retained |
| MCI-04 | Personalisation ranker | Adapt ranking to consented first-party interests | Views, searches, saves, declared interests | Personalised ordering | Opt-out works; cold-start fallback; no sensitive-trait inference |
| MCI-05 | Visual product matcher | Match user-provided image to catalogue items | User-submitted image, public catalogue images | Similar-item candidates | Image consent/retention controls; no face/biometric identification |
| MCI-06 | Similar-item discovery | Find alternatives and substitutes | Product attributes, category | Similar products | Explain similarity; never fabricate compatibility |
| MCI-07 | Local availability ranker | Prioritise realistically reachable nearby sellers | Seller area, product location, declared availability | Local ranking features | Location minimisation; unknown stock is not treated as available |
| MCI-08 | Discovery diversity controller | Reduce repetitive exposure and give new shops fair opportunity | Candidate scores, exposure history | Diversified slate | Measure exposure fairness; preserve relevance and policy gates |

## B. Trust, safety and compliance (09–16)

| ID | Module | Responsibility | Primary inputs | Output | Guardrail / acceptance |
|---|---|---|---|---|---|
| MCI-09 | Business identity verifier | Coordinate evidence checks for merchant identity | Registration evidence, verified contact, review result | Verification state + evidence refs | Never infer legal verification from a phone number or LLM |
| MCI-10 | Supplier due-diligence assessor | Assess supplier evidence and provenance | Business docs, address, references, partner checks | Evidence checklist/status | Missing evidence = unknown; human sign-off for verified badge |
| MCI-11 | Listing policy classifier | Detect likely prohibited/restricted listing categories | Text, category, image signals | Policy candidates | Deterministic versioned policy engine decides; ambiguous cases reviewed |
| MCI-12 | Image safety moderator | Detect unsafe or disallowed product imagery | Image bytes, moderation provider outputs | Allow/block/review recommendation | Server-side only; provider failure blocks publication; safe test fixtures |
| MCI-13 | Fraud/anomaly detector | Identify suspicious account/listing/transaction patterns | Rate, graph and event features | Risk signals | No automatic accusation/suspension; false-positive review and appeal |
| MCI-14 | Reputation integrity monitor | Detect review manipulation and coordinated abuse | Reviews, account graph, timing | Integrity flags | No penalising legitimate shared networks without evidence |
| MCI-15 | Transaction risk assessor | Evaluate future order/payment risk when order domain exists | Verified order/payment/delivery events | Risk tier + reasons | No payment release/hold decision without approved deterministic policy and human/partner controls |
| MCI-16 | Case triage assistant | Prioritise moderator queues and summarise evidence | Reports, policy version, evidence refs | Queue priority + summary | Human moderator decides; redact sensitive material; audit every action |

## C. Buyer and customer experience (17–22)

| ID | Module | Responsibility | Primary inputs | Output | Guardrail / acceptance |
|---|---|---|---|---|---|
| MCI-17 | Preference learner | Learn shopping interests from first-party signals | Consent, searches, views, saves, purchases | Preference vector/profile | Data minimisation, expiry, export/delete, opt-out |
| MCI-18 | Shopping intent predictor | Estimate near-term shopping intent | Recent first-party interactions | Intent categories | No sensitive inference; calibrated and evaluated |
| MCI-19 | Budget-fit estimator | Match products to declared or observed price preferences | Declared budget, price interactions | Price-fit band | Do not infer income/class; user can correct preferences |
| MCI-20 | Buyer journey assistant | Help compare, understand and navigate products | User question, public product facts | Grounded explanation | Cite catalogue facts; disclose uncertainty; no invented claims |
| MCI-21 | Customer support router | Route questions, complaints and disputes | Support message, order/report state | Queue and response draft | Human escalation; no exposure of another user's data |
| MCI-22 | Retention/churn signal | Identify useful opt-in re-engagement opportunities | First-party usage aggregates | Suppression-aware cohort | No manipulative urgency; opt-out and frequency caps |

## D. Merchant and supplier operations (23–28)

| ID | Module | Responsibility | Primary inputs | Output | Guardrail / acceptance |
|---|---|---|---|---|---|
| MCI-23 | Listing enrichment assistant | Draft titles, descriptions and attribute suggestions | Merchant-provided text/images | Editable draft | Never invent price, stock, origin, certification or claims |
| MCI-24 | Inventory signal engine | Reconcile declared stock and listing status where supported | Merchant stock updates, sales | Inventory status | No inferred stock treated as confirmed |
| MCI-25 | Demand forecaster | Forecast category/shop demand | Aggregated sales/search/seasonality | Forecast + interval | Baseline comparison; disclose uncertainty; no false precision |
| MCI-26 | Pricing assistant | Suggest price ranges using comparable evidence | Product attributes, public prices, merchant costs if provided | Suggested range | Merchant controls final price; explain data coverage |
| MCI-27 | Merchant performance analyst | Explain shop views, contact taps and listing engagement | Existing shop/listing analytics | Plain-language insights | Taps are not sales; preserve metric definitions |
| MCI-28 | Restock/sourcing recommender | Suggest replenishment opportunities | Confirmed stock/sales, supplier offers | Restock suggestions | No purchase/order without explicit merchant approval |

## E. International trade and fulfilment (29–34)

| ID | Module | Responsibility | Primary inputs | Output | Guardrail / acceptance |
|---|---|---|---|---|---|
| MCI-29 | Global supplier discovery | Discover manufacturers and wholesalers | Product query, geography, public/partner sources | Candidate suppliers | Source provenance and anti-scam checks |
| MCI-30 | Manufacturer authenticity assessor | Evaluate factory/trader claims | Company evidence, site checks, third-party audit | Evidence status | Never label factory-direct without verified proof |
| MCI-31 | Wholesale comparison engine | Compare MOQ, unit price and terms | Supplier quotes, currency, quantity | Comparable quote set | Normalise units/currency; quote date and exclusions visible |
| MCI-32 | Landed-cost calculator | Estimate total import cost | Quote, freight, insurance, tariff/tax rules | Itemised estimate + uncertainty | Official/current tariff sources or licensed agent; never call estimate a final customs assessment |
| MCI-33 | Trade compliance checker | Flag product/corridor restrictions and permits | HS classification candidate, origin/destination, current policy sources | Required checks and review state | Qualified human/clearing agent validates; no legal guarantee |
| MCI-34 | Shipment visibility predictor | Track milestones and estimate delivery windows | Carrier events, tracking feed, route history | Status + ETA range | No invented tracking; label carrier-confirmed vs predicted |

## F. Growth, advertising and network health (35–40)

| ID | Module | Responsibility | Primary inputs | Output | Guardrail / acceptance |
|---|---|---|---|---|---|
| MCI-35 | Sponsored-campaign eligibility | Decide whether listing/shop can enter ad inventory | Trust state, policy state, campaign state | Eligible/ineligible + reason | Safety and trust gates precede payment |
| MCI-36 | Sponsored placement ranker | Rank clearly labelled paid placements | Bid/budget, relevance, quality | Sponsored slate | Label ads; cap frequency; never alter organic trust |
| MCI-37 | Campaign audience matcher | Match campaigns to permitted interest cohorts | Consented first-party preferences, campaign | Eligible cohort | No sensitive targeting; privacy review and opt-out |
| MCI-38 | Merchant growth coach | Suggest practical actions to improve shop outcomes | Shop metrics, category benchmarks | Prioritised suggestions | No fabricated benchmark; distinguish correlation from causation |
| MCI-39 | Marketplace liquidity monitor | Detect category/area supply-demand gaps | Aggregated supply, demand, contact/order signals | Gap and opportunity signals | Aggregation thresholds; no personal profiling |
| MCI-40 | Network abuse monitor | Detect coordinated spam, scraping and platform attacks | Security events, rate patterns, graph features | Security alerts | Minimise identifiers; human review for account impact; incident runbook |

## Global acceptance gates (apply to all 40)

1. Schema and contract tests; backwards compatibility and versioning.
2. Data provenance, lawful purpose, retention and deletion behaviour documented.
3. Authentication, authorisation, tenant isolation and abuse tests.
4. Offline evaluation against a baseline with false-positive/false-negative analysis.
5. Latency, availability, token/compute cost and failure budgets.
6. Deterministic fallback and feature flag/kill switch.
7. Monitoring that avoids raw PII and secret leakage.
8. Human review and appeal for high-impact decisions.
9. Shadow-mode evidence before customer-visible activation.
10. Explicit release approval; documentation status alone never means production-ready.
