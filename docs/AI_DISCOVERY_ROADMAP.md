# Mudaala AI and Product Discovery Roadmap

**Status:** Living product/engineering plan. Ideas are not implementation approval.
**Owner:** Mudaala project
**Last updated:** 2026-10-23
**Canonical project status:** `docs/MASTER_CHECKLIST.md`
**Product roadmap context:** GitHub issue [#163](https://github.com/isaJrKai/mudaala-cloudflare/issues/163)
**Product boundary:** Mudaala helps people discover nearby physical shops and contact them. It is not a checkout marketplace.

## 1. Product outcome

Help a buyer in Uganda find a relevant, available local product quickly, understand the offer, and contact the seller with confidence—while giving small and new shops a fair chance to be discovered.

The objective is useful discovery, not adding AI for its own sake. Keep the experience fast on low-cost phones and slow connections. Guests must be able to browse without creating an account. Calls, WhatsApp taps, views, and clicks are intent signals, not proof of purchases or sales.

## 2. Current state and evidence rules

Mudaala already has deterministic search, category ordering, and content-based related-product recommendations. These should not be described as a trained machine-learning model unless and until a model is actually trained and evaluated.

A proposed ranking/personalisation patch set was supplied in `mudaala-rank (2).zip` and contains three patches:
- pure ranking/personalisation/forecast module;
- search, feed, and admin feature-switch wiring;
- taste signal sent in a request header, with private/no-store handling for personalised responses.

**Status on 2026-10-23: proposed and not yet independently verified or merged.** Reports of passing tests are not equivalent to our own exact-commit CI, build, privacy, performance, and production evidence. First confirm the patches apply cleanly to current `main`; inspect the actual diff; run required validation and a production-safe review. Do not merge or deploy without the normal release gates and explicit approval.

The master checklist remains the source of truth for release gates and overall project status. This document is the living AI/discovery direction and must not replace or contradict it.

## 3. Principles and guardrails

1. **Useful before clever:** prefer the smallest deterministic improvement that demonstrably helps buyers.
2. **Fair discovery:** relevance matters, but popularity must not permanently bury new or small shops.
3. **No fake signals:** never fabricate listings, availability, reviews, trust badges, views, purchases, or seller performance.
4. **Privacy by design:** collect the minimum necessary signals; define purpose, consent, retention, reset, and deletion behavior before personalisation ships.
5. **Safe by default:** server-side authorization for every admin control; feature switches default off; emergency kill switch; rollback plan.
6. **Cheap and resilient:** avoid unnecessary model/API calls, heavy client bundles, and additional database reads on every browse/search request without evidence they are needed.
7. **Explainable outcomes:** be able to explain broad ranking factors to the team and, where useful, users. Do not claim that ranking is objective or perfectly accurate.
8. **Measure, then expand:** passing unit tests proves code properties, not that search results are better.
9. **Language and locality matter:** use terminology real Ugandan buyers and sellers use; validate local-language dictionaries with native speakers and real queries.
10. **No silent scope creep:** roadmap entries do not override P0 reliability, privacy, backup/restore, or security gates in `docs/MASTER_CHECKLIST.md`.

## 4. Workstreams

### A. Reliability and release safety — first gate

- [ ] Rebase/verify the supplied ranking patches against the current main commit; record exact base and resulting head SHAs.
- [ ] Review the full diff for authorization boundaries, user/account isolation, query safety, cache behavior, and accidental exposure of personalisation data.
- [ ] Run the repository's actual required CI, type checks, lint, tests, and production build. Record results and any environment-only limitation separately.
- [ ] Verify all-off behavior preserves current search/feed behavior and does not regress public browsing.
- [ ] Test global kill switch and each individual feature switch, including unauthorized admin access and attempts to enable unfinished features.
- [ ] Confirm personalisation cannot leak between accounts, users, or shared devices; test reset/opt-out and cache headers.
- [ ] Measure extra database calls, Worker CPU, response latency, and payload size with flags off and on.
- [ ] Define a reversible rollout, live smoke checks, monitoring signals, and rollback trigger before any production release.

**Exit condition:** exact-head checks are green, security/privacy behavior is tested, measurable performance impact is understood, and rollback is ready. Do not claim production readiness based on a patch author's summary.

### B. Search relevance and buyer intent

- [ ] Create a small, versioned evaluation set of real or carefully anonymised Ugandan-style searches and expected relevant products/shops.
- [ ] Include misspellings, alternate spellings, category terms, shop names, local product vocabulary, and vague queries.
- [ ] Record baseline results before changing ranking. Have a human judge relevance; compare top results and no-result cases after each change.
- [ ] Add typo recovery and safe fallback suggestions only when they improve measured relevance without surprising users.
- [ ] Distinguish product relevance from shop popularity and from user engagement.
- [ ] Test empty results, sparse inventory, duplicate products, unavailable/deactivated listings, and weak matches.
- [ ] Investigate Luganda and other locally used terms with native-speaker review; do not assume an automatically generated dictionary is correct.

**Measures:** top-5 relevance, successful query rate, zero-result rate, time to a relevant result, and contact actions per relevant result. Report sample sizes and avoid treating contact taps as sales.

### C. Fair and diverse ranking

- [ ] Define explicit ranking factors and sensible bounds so one popularity or engagement signal cannot dominate.
- [ ] Test new-shop/new-listing exposure and controlled exploration so small shops have a genuine chance to be seen.
- [ ] Add diversity checks to avoid a feed filled with near-identical products or a single shop.
- [ ] Defend against repeated views, bot-like activity, and seller self-engagement inflating ranking.
- [ ] Test category, location, price, recency, and relevance trade-offs on representative examples.
- [ ] Document why an item can appear higher or lower and provide a safe fallback to the existing order.

**Measures:** shop exposure distribution, share of impressions for new shops, number of distinct shops shown, duplicate/near-duplicate rate, and relevance. Fairness is not simply equal impressions; relevance and genuine inventory still matter.

### D. Personalisation and user control

- [ ] Treat buyer taste as optional and only introduce it after the privacy/retention design is approved.
- [ ] Define exactly which signals are used, how long they are kept, how they are separated by account/device, and how users can reset or opt out.
- [ ] Treat views as weak interest; repeated meaningful exploration may be stronger. Call/WhatsApp taps indicate intent, not confirmed outcomes.
- [ ] Provide a reset path and a non-personalised default. Anonymous browsing must remain useful.
- [ ] Test shared phones, logged-out browsing, account switching, logout, stale preferences, and cached responses.
- [ ] Avoid sensitive-trait inference. Do not infer protected or intimate attributes from product browsing.
- [ ] Do not use URL query parameters for private taste profiles. Ensure cache policy and request logging do not expose personalisation payloads.

**Exit condition:** the experience is useful without personalisation, user control is clear, and privacy tests pass.

### E. Product information quality

- [ ] Improve search matching using accurate titles, useful descriptions, categories, price, location, and shop identity.
- [ ] Make price units explicit where relevant (per bottle, cup, piece, slice, plate, pack, dozen, or batch).
- [ ] Help sellers correct missing or ambiguous details without inventing product facts.
- [ ] Treat product photos as useful evidence for discovery, not as proof of authenticity, stock, or seller verification.
- [ ] Establish moderation and content-quality rules for misleading claims, spam, duplicates, and unsafe content.

### F. Seller insights (later, with reliable data)

- [ ] Keep views, shop visits, Call taps, WhatsApp taps, recorded sales, and profit clearly distinct.
- [ ] Build seller guidance only from data the seller is allowed to see; explain uncertainty and minimum sample sizes.
- [ ] Do not infer age, gender, income, or other sensitive audience traits without a justified, lawful, consent-aware design and sufficient reliable data.
- [ ] Make forecasts conditional on sufficient historical data. Show uncertainty and never present guesses as guaranteed demand.
- [ ] Prefer actionable, modest advice (e.g. improve a missing price unit or product description) over generic AI-generated business claims.

### G. Future research — not committed implementation

These are candidates to evaluate, not promises or immediate tasks:
- local-language and synonym expansion;
- alternative products when an item is unavailable;
- aggregate demand trends for sellers, with privacy safeguards;
- explainable search suggestions and query refinement;
- seller coaching based on explicit catalogue quality and trustworthy business records;
- forecasting only when data volume and quality justify it;
- an AI-agent adapter only after tool permissions, owner consent, audit logs, limits, and rollback are established.

Do not introduce an LLM, embedding service, vector database, or paid inference dependency until a measured problem requires it and the cost/security trade-off is written down.

## 5. Evaluation plan

Start with a compact, repeatable benchmark. Keep it in version control and expand it as real queries are learned (remove or anonymise personal data).

For every ranking/search change, record:

- commit and feature-flag configuration;
- evaluation dataset version and number of queries;
- baseline and candidate top results;
- human relevance judgement method;
- top-5 relevance and zero-result changes;
- exposure distribution across shops;
- latency/CPU/database-query impact;
- privacy/security test results;
- known regressions and rollback instructions.

Never declare success from clicks alone: a click can be accidental, and contact does not prove a sale. Do not collect raw private query histories merely to make evaluation easier.

## 6. Priority order

1. **Safety and verification:** validate the proposed ranking patch set, existing release gates, privacy, feature switches, performance, and rollback.
2. **Baseline evaluation:** build a small human-reviewed search relevance set before tuning weights.
3. **Search quality:** fix demonstrated high-impact relevance and no-result failures.
4. **Fairness and diversity:** prevent popularity loops and ensure useful exposure for small/new shops.
5. **User-controlled personalisation:** only after consent, retention, reset, account isolation, and cache behavior are tested.
6. **Seller intelligence and advanced AI:** only when trustworthy data and measurable value justify them.

## 7. Decision log

| Date | Decision | Reason / evidence |
|---|---|---|
| 2026-10-23 | Keep AI/discovery work documented in this roadmap and preserve `docs/MASTER_CHECKLIST.md` as the canonical release board. | Prevent ideas from being lost across conversations while keeping release status evidence-based. |
| 2026-10-23 | Ranking ZIP patches are proposed work, not accepted or production-ready work. | Exact-commit application, independent CI/build, privacy, performance, and live verification are not yet established here. |
| 2026-10-23 | Prioritise measured discovery quality and small-shop fairness over adding a more complex model. | Product goal is useful nearby discovery and seller contact, not AI branding. |

## 8. How to keep this roadmap current

When a new idea or issue appears:
1. Add it to the relevant workstream with a clear problem statement.
2. Label it **idea**, **investigating**, **ready**, **in progress**, **blocked**, or **verified**.
3. Define how we will know it works before implementation.
4. Keep tasks small and separate from unrelated fixes.
5. Update status only when evidence exists; link PRs, CI runs, and production verification.
6. Record decisions that change scope or safety requirements.
7. Update `docs/MASTER_CHECKLIST.md` only for real project/release status changes, and keep both documents consistent.
