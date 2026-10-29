# Mudaala AI Search Evaluation Protocol

Status: protocol draft; no benchmark results are claimed.

This document defines how to decide whether ranking changes improve product discovery without harming small shops, adding avoidable Browse cost, or exposing private buyer signals.

## Scope

Evaluate the ranking changes proposed in the supplied ranking patch set against the current production ordering. This is an offline/replay evaluation first. Do not enable personalised ranking or collect new buyer behaviour as part of this benchmark.

## Dataset rules

- Use real, lawfully accessible listing records only in a controlled, access-restricted test fixture; do not copy production personal data.
- Prefer seller/listing identifiers replaced with stable pseudonymous fixture IDs.
- Include only fields needed to judge relevance: query, listing title, description, category, offer/request type, price band when present, listing age, shop-size band, and expected relevant result IDs.
- Do not include buyer names, phone numbers, email addresses, exact location, photos, inferred demographics, or private shop analytics.
- Never fabricate listings or label synthetic records as real-world evidence.
- Keep a separate record of who reviewed each query and when; reviewers should be familiar with Ugandan marketplace language and spelling.

## Query set

Build a human-reviewed set covering:
1. Common product searches across the major Mudaala categories.
2. Local wording, abbreviations, spelling variants, and compound queries.
3. Unicode-styled text and punctuation variants.
4. Searches where the description is more informative than the title.
5. Ambiguous terms that should not return unrelated categories.
6. Offer-versus-request intent where that distinction matters.
7. No-result and low-inventory searches.

Each query must have a short intent note and a graded relevance judgement for candidate listings. Keep ambiguous queries explicitly marked rather than forcing a single answer.

## Baselines and metrics

Compare current main ordering with the candidate ranking using the same candidate set and query set.

Record:
- Precision@5 and nDCG@5 from human relevance grades.
- Zero-result rate and whether a useful near-match exists.
- Duplicate-result rate and category/offer-request false-positive rate.
- Distinct shops represented in the first five results.
- Exposure share for small/new shops versus their eligible candidate share.
- Median and p95 search latency, database query count, and Worker CPU where the runtime exposes it.
- Feed and search cache headers for anonymous and authenticated requests.

Do not combine these into one opaque score. Report each metric and explain trade-offs.

## Fairness checks

- Segment exposure by shop-size band and listing-age band; do not use seller wealth, identity, or inferred sensitive traits.
- Verify that a new shop with a relevant result can appear in the first five results.
- Verify that refreshing an old listing does not make it appear newly published.
- Ensure exploration does not displace clearly more relevant results without a measured, documented reason.
- Inspect per-shop exposure concentration and identify repeated dominance by a small number of shops.
- Preserve offer/request intent and public visibility/eligibility rules.

## Privacy and safety gates

Before any personalised signal is used:
- prove account isolation and shared-device safety;
- prove opt-out and reset behavior;
- decay stale preferences on read as well as on write;
- reject malformed and oversized request-header payloads;
- use private, no-store responses wherever buyer-specific state affects output;
- verify no buyer taste signal appears in URLs, logs, analytics, or shared caches;
- prove the runtime kill switch restores the current baseline immediately.

No sensitive traits may be inferred. No new paid service or infrastructure may be introduced without explicit approval.

## Decision rule

A candidate is not eligible for rollout merely because unit tests pass. It must:
1. pass the repository's required CI and exact-head Worker build;
2. show no material regression in relevance or false positives;
3. pass privacy, authorization, kill-switch, and rollback tests;
4. meet an agreed Browse latency/CPU/database budget;
5. show no unexplained worsening of shop exposure concentration;
6. be reviewed against the canonical `docs/MASTER_CHECKLIST.md` release gates.

Feature flags remain off by default until every applicable gate is evidenced. A draft protocol, benchmark fixture, or passing offline test is not proof of production improvement.

## Results log

| Run | Commit | Dataset version | Baseline | Candidate | Outcome |
|---|---|---|---|---|---|
| Not run | — | — | — | — | No measured results yet |
