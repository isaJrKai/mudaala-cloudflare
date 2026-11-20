# Mudaala Intelligence — 40-Module Resource Matrix

**Status:** Engineering research and selection matrix. It is not an approval to deploy dependencies, access production data, train models or incur provider spend.  
**Date:** 2026-11-20  
**Parent documents:**  
- `docs/MUDAALA_INTELLIGENCE_INFRASTRUCTURE_MASTERPLAN.md`
- `docs/MUDAALA_INTELLIGENCE_RESOURCES_AND_TRAINING_CATALOGUE.md`
- 40-module registry: `docs/COMMERCE_INTELLIGENCE_40_MODULES.md` on `architecture/commerce-intelligence-foundation`

## 1. Purpose and decision rules

This matrix translates the agreed 40 capability registry into an actionable resource plan. Each row identifies a sensible implementation pattern, Hermes skill support, candidate technologies, data/training inputs, evaluation, compute profile and recommended build/reuse decision.

**A resource candidate is not an approved dependency.** All named frameworks, models and data sources require version-specific licence, security, compatibility and quality checks. Model names are candidates to benchmark, not endorsements or promises of performance.

### Decision vocabulary

- **REUSE:** existing Mudaala code or platform capability already does part of the job.
- **ADOPT:** integrate an existing maintained tool/provider after due diligence.
- **ADAPT:** configure or wrap an existing model/framework for Mudaala's task.
- **BUILD:** implement Mudaala-specific rules, contracts, data pipelines or product workflows.
- **TRAIN:** fit or fine-tune a model only after labels, consent, baseline and measurable benefit exist.
- **DEFER:** do not build until the product domain/data exists.
- **REJECT:** record why a candidate is unsuitable.

### Evidence status

Every resource in this matrix starts as **RESEARCH CANDIDATE** unless a specific existing Mudaala file or platform binding is cited as existing. No external model/framework is marked benchmarked or production-approved by this document.

## 2. Global architecture and resource principles

1. Hermes is the always-available orchestration layer, not the synchronous execution engine for every capability. It schedules and coordinates work; bounded typed services perform latency-sensitive retrieval, ranking, rules and inference.
2. Modal is the initial research/training/batch execution candidate. It is not assumed to provide a continuously running Hermes control plane at zero cost. Always-on serving requires a separately costed, monitored deployment.
3. Mudaala's Supabase/PostgreSQL remains the authoritative source for commerce data. Intelligence stores only justified derived features, event projections, experiment records and model artefacts.
4. The first implementation should prefer existing Mudaala code, SQL, deterministic rules and small CPU services. Add GPU, vector databases, feature stores or model registries only when measured requirements justify them.
5. Every module has a typed input/output contract, owner, version, provenance, trace ID, access policy, latency/cost budget, fallback and kill switch.
6. No model may independently verify a merchant, suspend an account, decide an appeal, publish a risky listing, place an order, release money, or make a legal/customs determination.
7. Buyer preference data is private to the buyer and authorised intelligence functions. It must not become a merchant-visible competitor-intelligence feed.
8. Do not train on private WhatsApp conversations, appeals, support records, credentials or raw personal data by default. Require purpose, consent/legal review, minimisation and retention controls.
9. A WhatsApp contact tap, page view, poster download or asking price is not a confirmed sale or ground-truth conversion.
10. Build the evaluation harness and data dictionary before training. Preserve a deterministic baseline and run candidate models in offline/shadow mode before activation.

## 3. The 40-module matrix

| ID | Capability | Implementation pattern | Hermes skills | Candidate tools / models | Data & training inputs | Evaluation gates | Compute profile | Recommended decision |
|---|---|---|---|---|---|---|---|---|
| MCI-01 | Query understanding | Hybrid: rules + multilingual text model fallback | MSK-001, 005, 006 | fastText/lang-ID; Sentence Transformers; scikit-learn | Synthetic query set; consented anonymised search queries; curated Luganda/English/code-switch and typo labels | Intent/category/attribute exactness; query preservation; slice by language and spelling | CPU; optional small embedding/model inference | BUILD baseline; ADAPT model only after language benchmark |
| MCI-02 | Retrieval planner | Deterministic query planner | MSK-002, 006, 007 | PostgreSQL full-text/trigram; pgvector only if justified; ScaNN benchmark candidate | Public listings + synthetic catalogue; query-to-candidate relevance set | Recall@K, latency, query cost, private/draft leakage tests | CPU; existing Postgres first | BUILD; benchmark vector index before adding service |
| MCI-03 | Product relevance ranker | Learning-to-rank after deterministic baseline | MSK-006, 007 | LightGBM/XGBoost ranking; TensorFlow Ranking; RecBole research baseline | Human-judged query/listing relevance; approved impression/click data as weak signals only | NDCG@K, MRR, Recall@K, calibration, latency | CPU training initially; CPU serving | BUILD baseline; ADAPT ranker after labels |
| MCI-04 | Personalisation ranker | Consent-gated feature reranker | MSK-004, 007 | LightGBM; RecBole/TFRS research; simple recency/category affinity | Opt-in views, saves, searches and declared interests; synthetic cold-start fixtures | Lift vs non-personalised baseline; opt-out, deletion, cold-start and exposure audits | CPU batch + low-latency CPU serving | BUILD rules first; TRAIN only with sufficient consented data |
| MCI-05 | Visual product matcher | Image embeddings + nearest-neighbour retrieval | MSK-005, 006, 011 | OpenCLIP/SigLIP candidates; Sentence Transformers image/text; FAISS/pgvector/ScaNN benchmark | ABO public dataset for pipeline tests with attribution; Mudaala public catalogue images with approved purpose | Recall@K and human similarity judgement; robustness to local photos; image retention tests | GPU batch embedding; CPU/GPU inference | ADAPT pretrained vision encoder; do not train from scratch initially |
| MCI-06 | Similar-item discovery | Attribute rules + embedding retrieval | MSK-005, 007 | Sentence Transformers; OpenCLIP; RecBole similarity baselines | Catalogue attributes, public listing images/text; curated substitute/non-substitute pairs | Precision@K; attribute consistency; compatibility false-positive audit | CPU; optional GPU batch embeddings | BUILD attribute baseline; ADAPT embeddings |
| MCI-07 | Local availability ranker | Deterministic geo-distance and availability features | MSK-007 | PostGIS geography; geohash/H3 optional | Seller-declared area and availability; coarse locality test fixtures | Distance correctness; unknown-stock handling; location minimisation | CPU/Postgres | BUILD; no learned model needed initially |
| MCI-08 | Discovery diversity controller | Slate constraints / reranking | MSK-006, 007 | xQuAD/MMR-style reranking; custom deterministic constraints; TensorFlow Ranking only if needed | Exposure logs with aggregation; synthetic seller/catalogue slates | Relevance retained; seller exposure distribution; new-shop opportunity; repeat rate | CPU | BUILD deterministic controller; monitor fairness |
| MCI-09 | Business identity verifier | Evidence workflow + deterministic state machine | MSK-010, 011 | Document parsing/OCR only as assist; provider-neutral verification adapters | Merchant-submitted evidence with explicit purpose; synthetic fixtures | Evidence completeness; false verification rate; human sign-off audit | CPU; OCR batch optional | BUILD workflow; no LLM-issued verification |
| MCI-10 | Supplier due-diligence assessor | Evidence checklist + source verification workflow | MSK-010, 011 | OCR/document extraction as assist; web/source adapters | Public registry/partner evidence where lawful; supplier-provided docs; reviewed outcomes | Evidence provenance, missing-data handling, reviewer agreement | CPU; bounded document extraction | BUILD checklist; ADAPT extraction, human decision |
| MCI-11 | Listing policy classifier | Rules-first policy engine + classifier triage | MSK-001, 010, 013 | Versioned rules; scikit-learn/Transformers text classifier candidate | Synthetic policy fixtures; reviewed listing examples with labels | Per-policy precision/recall; ambiguity routing; policy-version regression | CPU inference; GPU training only if justified | BUILD policy engine; TRAIN classifier only as triage |
| MCI-12 | Image safety moderator | Provider moderation + secondary classifier + fail-closed publication gate | MSK-010, 013 | Approved moderation API; vision classifier candidates | Safe synthetic/test images; curated labelled review set | Unsafe miss rate; false blocks; provider outage and timeout tests | CPU orchestration; GPU optional | ADOPT provider candidate after legal/security review; BUILD gate |
| MCI-13 | Fraud/anomaly detector | Rules + anomaly scoring, human review | MSK-004, 010, 013 | Isolation Forest; XGBoost; graph features; scikit-learn | Synthetic attack patterns; minimised security/listing event features; confirmed reviewed cases | Precision at review capacity; false-positive rate; drift; appeal overturn rate | CPU batch/stream | BUILD rules; ADAPT anomaly model after confirmed labels |
| MCI-14 | Reputation integrity monitor | Graph/time-series heuristics + reviewer queue | MSK-004, 010, 013 | NetworkX; graph feature pipelines; LightGBM candidate | Synthetic coordinated-review networks; explicitly reviewed public review data | Reviewer precision; legitimate-network false positives; explanation quality | CPU batch | BUILD heuristics; no automatic reputation penalty |
| MCI-15 | Transaction risk assessor | Deferred capability; deterministic rules only when order/payment exists | MSK-001, 010, 011 | No model selected; payment-provider risk tools only if a payment domain is introduced | Verified order/payment/delivery events only; synthetic fixtures until then | Risk calibration and policy simulation; no payment action without approval | Not applicable until domain exists | DEFER; Mudaala is not assumed checkout-first |
| MCI-16 | Case triage assistant | Queue prioritisation + grounded summarisation | MSK-010, 013, 015 | LLM with retrieval and strict redaction; deterministic priority rules | Approved/redacted case records; synthetic cases; reviewer labels | Summary factuality, routing accuracy, privacy leakage, reviewer acceptance | CPU orchestration; external LLM API optional | BUILD queue; ADAPT LLM summariser; human retains decision |
| MCI-17 | Preference learner | Consent-aware profile aggregation | MSK-004, 007, 011 | Deterministic weighted counters; implicit-feedback RecBole later | Opt-in first-party events; declared interests; synthetic profiles | Preference usefulness; expiry/deletion/opt-out; sensitive inference tests | CPU batch | BUILD aggregate baseline; TRAIN only after volume and consent |
| MCI-18 | Shopping intent predictor | Calibrated probabilistic classifier; initially omit if no actionability | MSK-004, 007, 013 | Logistic regression/LightGBM; calibration tools | Explicit intent labels and approved recent interactions; synthetic examples | Brier score, calibration, precision/recall, actionability and bias review | CPU | DEFER model; BUILD only if product decision needs it |
| MCI-19 | Budget-fit estimator | Declared-budget filter and price band rules | MSK-009 | Deterministic price bands; quantile regression only if validated | User-declared budget and comparable listing prices; no income labels | Band accuracy; currency/unit correctness; correction UX; no income inference | CPU | BUILD deterministic; do not infer income/class |
| MCI-20 | Buyer journey assistant | Retrieval-grounded answer composer | MSK-001, 005, 007 | LLM API behind adapter; structured retrieval; templates | Public product/shop facts; synthetic buyer questions; approved FAQs | Groundedness, citation coverage, hallucination rate, latency, safe fallback | External API/CPU orchestration | ADAPT existing LLM; no fine-tune initially |
| MCI-21 | Customer support router | Deterministic routing + optional redacted classifier/draft | MSK-010, 014 | Rules; small text classifier; LLM draft only with approved data controls | Synthetic tickets; opt-in/redacted support labels | Routing accuracy, escalation recall, privacy leakage, response correctness | CPU | BUILD routing; defer generative replies until privacy review |
| MCI-22 | Retention/churn signal | Aggregate cohort rules; suppression-aware | MSK-004, 008 | SQL cohort analysis; survival analysis only if enough data | Aggregated usage cohorts; opt-in engagement and suppression records | Calibration, incremental helpfulness, opt-out and frequency-cap tests | CPU/Postgres | BUILD cohort analytics; no manipulative urgency |
| MCI-23 | Listing enrichment assistant | Editable draft generation with schema validation | MSK-001, 005 | LLM API; taxonomy dictionary; OCR/vision extraction assist | Merchant-supplied product facts/images; synthetic listing examples; reviewed edits | Fact preservation, unsupported-claim rate, edit acceptance, attribute accuracy | CPU orchestration; API inference | ADAPT LLM + rules; never invent price/stock/certification |
| MCI-24 | Inventory signal engine | Deterministic reconciliation of merchant-declared state | MSK-004, 008 | Event-sourced state transitions; SQL consistency checks | Merchant stock edits and confirmed sales only where available | State correctness; stale inventory rate; unknown-vs-zero distinction | CPU/Postgres | BUILD; no predictive model initially |
| MCI-25 | Demand forecaster | Statistical baseline then hierarchical forecasting | MSK-004, 008, 012 | StatsForecast; sktime; LightGBM; TimesFM candidate only after baseline | Aggregated time-series search/contact/sales with clear definitions; synthetic sparse series | MAE/MASE/WAPE, interval coverage, cold-start and sparse-data tests | CPU baseline; GPU/API only if benchmark wins | ADAPT statistical model; compare foundation model, do not assume superiority |
| MCI-26 | Pricing assistant | Comparable evidence engine + robust statistics | MSK-009 | SQL median/quantiles; LightGBM quantile regression only later | Public active listing prices matched by currency/unit/condition; merchant costs only if declared | Comparable coverage, sample size, interval coverage, stale-data and outlier tests | CPU/Postgres | BUILD explainable baseline; do not call asking prices transaction prices |
| MCI-27 | Merchant performance analyst | Metric definitions + deterministic insight rules; LLM wording optional | MSK-004, 008 | SQL aggregates; rules; LLM grounded narrative | Existing listing/shop analytics and event dictionary | Metric arithmetic, no click=sale claims, recommendation usefulness | CPU/Postgres | BUILD using existing analytics; reuse current growth code |
| MCI-28 | Restock/sourcing recommender | Threshold rules from confirmed stock/sales; supplier feed later | MSK-008, 009 | SQL rules; forecast module dependency; supplier API adapters | Confirmed stock changes, sales/orders if introduced, supplier quotes | Recommendation precision; stockout reduction only with reliable outcomes; no auto-order | CPU | DEFER advanced model; BUILD suggestion-only workflow |
| MCI-29 | Global supplier discovery | Source aggregation + deduplication + evidence capture | MSK-010, 011 | Search APIs; entity resolution; browser automation only in sandbox | Public supplier directories and official company records; licensed partner feeds | Source freshness, duplicate rate, provenance, scam review recall | CPU orchestration; external search cost | BUILD connector layer; sources individually reviewed |
| MCI-30 | Manufacturer authenticity assessor | Evidence graph + human verification | MSK-010, 011 | Entity resolution; OCR; official registry/site checks | Supplier documents, official registries, audit reports with permissions | False factory-direct claim rate; reviewer agreement; evidence age | CPU; document extraction optional | BUILD evidence workflow; never auto-certify |
| MCI-31 | Wholesale comparison engine | Typed quote normalisation and deterministic comparison | MSK-009, 011 | Pydantic schemas; currency/units libraries; FX source adapter | Supplier quotes with timestamp, MOQ, unit, currency, Incoterms and exclusions | Normalisation accuracy; stale quote detection; apples-to-apples coverage | CPU | BUILD; no ML required |
| MCI-32 | Landed-cost calculator | Rules-based calculator with versioned rates and uncertainty | MSK-011 | Decimal arithmetic; tariff/rate data adapters; scenario engine | Official tariff/tax schedules, freight quotes, insurance and declared shipment details | Reconciliation against expert cases; rate freshness; uncertainty bounds | CPU | BUILD calculator; qualified clearing agent validates |
| MCI-33 | Trade compliance checker | Rules and source retrieval with human/legal review | MSK-010, 011 | Official-source retrieval; HS code candidate classifier only as assist | Current official import/export rules, permit lists and expert-reviewed cases | Source currency, classification uncertainty, missed restriction tests | CPU/API retrieval | BUILD source-backed checklist; no legal guarantee |
| MCI-34 | Shipment visibility predictor | Carrier event integration; ETA model only with data | MSK-014 | Carrier APIs/webhooks; survival/quantile forecasting later | Carrier-confirmed milestones and route histories; synthetic tracking fixtures | Event provenance, ETA interval coverage, stale tracking handling | CPU; API integrations | DEFER until carrier integrations; never invent tracking |
| MCI-35 | Sponsored-campaign eligibility | Deterministic policy/trust gate | MSK-001, 010, 015 | Versioned eligibility rules | Shop/listing trust and moderation state; campaign records | Policy truth table; ineligible campaign rejection; audit trail | CPU | BUILD deterministic; no model decides eligibility |
| MCI-36 | Sponsored placement ranker | Separate paid auction/ranking with relevance floor | MSK-006, 015 | Deterministic auction; LightGBM relevance score only after labels | Campaign bids/budgets + permitted listing relevance features | Ad labelling, relevance floor, spend caps, organic-ranking isolation | CPU | BUILD transparent baseline; ads never rewrite organic trust |
| MCI-37 | Campaign audience matcher | Consent-gated cohort eligibility, not sensitive profiling | MSK-004, 011 | SQL cohort filters; privacy-preserving aggregation | Opt-in declared interests and coarse cohorts; synthetic audience fixtures | Consent/opt-out enforcement; minimum cohort size; sensitive attribute tests | CPU/Postgres | BUILD rules; no sensitive targeting |
| MCI-38 | Merchant growth coach | Explainable rule engine + grounded language layer | MSK-004, 008 | Existing `merchant-growth.ts`; SQL analytics; optional LLM wording | Existing engagement metrics; merchant action feedback; category benchmark only when valid | Suggestion usefulness, factual grounding, action completion; no false causality | CPU; optional API for wording | REUSE existing code; extend with evaluation before ML |
| MCI-39 | Marketplace liquidity monitor | Aggregate supply-demand indicators and threshold alerts | MSK-004, 007, 008 | SQL/Polars/DuckDB; statistical change detection | Aggregated listings, searches, views/contact signals with privacy thresholds | Gap signal precision; aggregation/privacy thresholds; geographic coverage | CPU batch | BUILD aggregate analytics; avoid personal profiling |
| MCI-40 | Network abuse monitor | Security rules + anomaly detection + incident workflow | MSK-002, 013, 014 | Cloudflare rate limiting/WAF logs; Isolation Forest/LightGBM only if justified | Synthetic abuse traffic; minimised security telemetry; confirmed incidents | Detection precision/recall, alert latency, false-positive impact, privacy review | Edge rules + CPU batch | REUSE existing Cloudflare controls; build observability and triage |

## 4. Shared skills to implement

These are Mudaala-owned procedural skills, not separate ML models. Keep them in Git, version them, test them and require human approval before Hermes can change trusted production skills.

| Skill | Applies to | Minimum acceptance |
|---|---|---|
| MSK-001 Product & Policy Orientation | All modules | Correctly states product boundaries, current policy and unknowns |
| MSK-002 Repository Investigator | MCI-02, 40 and platform work | Evidence-backed source tracing; no guessed implementation claims |
| MSK-003 Architecture Decision Writer | Cross-module | Records alternatives, trade-offs, owner and decision status |
| MSK-004 Commerce Event Analyst | MCI-04, 13, 14, 17, 18, 22, 24, 27, 35–40 | Uses event dictionary; never equates engagement with sales |
| MSK-005 Product Catalogue Analyst | MCI-01, 05, 06, 23 | Preserves source facts and uncertainty |
| MSK-006 Search Relevance Evaluator | MCI-01–06, 08, 36 | Reproducible query set, labels and ranking metrics |
| MSK-007 Buyer Discovery Analyst | MCI-03, 04, 06–08, 17–20, 39 | Enforces buyer privacy, locality and diversity |
| MSK-008 Merchant Growth Analyst | MCI-22, 25–28, 38, 39 | Suggestions are actionable and metric-grounded |
| MSK-009 Price Evidence Analyst | MCI-19, 26, 31, 32 | Checks currency, unit, condition, date and sample coverage |
| MSK-010 Trust & Safety Triage | MCI-09–16, 29, 30, 33, 35, 40 | Human decision boundary and evidence provenance |
| MSK-011 Model/Dataset Auditor | All data/model modules | Licence, consent, leakage, bias, retention and lineage checks |
| MSK-012 Training Run Operator | MCI-03–06, 13, 17, 18, 25, 38, 40 | Reproducible runs, pinned artefacts and budget limits |
| MSK-013 Evaluation & Red-Team Operator | All modules | Regression, adversarial, privacy and permission tests |
| MSK-014 Incident & Provider Recovery | MCI-16, 20, 21, 29, 34, 40 | Safe fallback, alerting, recovery and incident receipt |
| MSK-015 Release & Rollback Reviewer | All customer-facing modules | Shadow evidence, feature flag, approval and rollback plan |

## 5. Cross-cutting training curriculum

| Priority | Resource | Why it matters | Suggested application |
|---|---|---|---|
| P0 | Google Machine Learning Crash Course — https://developers.google.com/machine-learning/crash-course/ | Shared ML fundamentals and evaluation literacy | All engineering owners; focus on data leakage, classification, embeddings and metrics |
| P0 | Google Recommendation Systems Course — https://developers.google.com/machine-learning/recommendation/ | Candidate generation, ranking, embeddings and reranking | MCI-01–08, MCI-17 |
| P0 | PostgreSQL documentation — https://www.postgresql.org/docs/ | Query planning, indexes, transactions and data correctness | MCI-02, 07, 17, 24, 26, 27, 31, 35–39 |
| P1 | Hugging Face Course — https://huggingface.co/learn | Transformers, tokenisers, datasets and model evaluation | MCI-01, 05, 11, 12, 16, 20, 23 |
| P1 | Sentence Transformers docs — https://www.sbert.net/ | Embeddings and semantic retrieval | MCI-01, 05, 06 |
| P1 | PyTorch tutorials — https://pytorch.org/tutorials/ | Model training and reproducible experiments | Only modules that justify learned models |
| P1 | Modal docs/training — https://modal.com/docs and https://modal.com/products/training | Isolated CPU/GPU jobs and batch evaluation | Training Lab, evaluation and batch inference |
| P1 | MLflow docs — https://mlflow.org/docs/latest/ | Experiment lineage and model registry | Adopt only when experiment volume justifies operations |
| P2 | RecBole docs — https://recbole.io/docs/ | Recommendation algorithm benchmarks | MCI-03, 04, 06, 17 |
| P2 | TensorFlow Recommenders — https://www.tensorflow.org/recommenders | Retrieval/ranking implementation patterns | MCI-02–04 |
| P2 | LightGBM docs — https://lightgbm.readthedocs.io/ | Efficient tabular ranking and forecasting baselines | MCI-03, 13, 18, 25 |
| P2 | StatsForecast — https://nixtlaverse.nixtla.io/statsforecast/ | Statistical forecasting baselines | MCI-25 |
| P2 | Agent Skills standard — https://agentskills.io/ | Portable procedural skill packaging | Hermes skill governance |

## 6. Data and dataset acquisition plan

### 6.1 Public benchmark data

- **Amazon Berkeley Objects (ABO):** https://amazon-berkeley-objects.s3.amazonaws.com/index.html and https://www.amazon.science/code-and-datasets/amazon-berkeley-objects-abo-dataset. Use a small, attributed subset for product metadata/image-pipeline experiments only after verifying the licence and downloaded artefact terms. It is not a proxy for Ugandan merchant inventory or local product photography.
- **Synthetic catalogue fixtures:** create realistic Ugandan category, unit, currency, spelling, locality and availability cases. Keep fixtures non-personal and version-controlled.
- **Public supplier/official trade information:** collect only from sources whose access terms permit the intended use. Store source URL, access date, licence/terms and evidence excerpt; never scrape around access controls.

### 6.2 First-party Mudaala data

Before any production-derived training, create a reviewed event dictionary and a data access register. Start with minimised aggregates and explicit user-purpose controls. Candidate events include search, impression, listing view, save, contact tap, merchant edit and confirmed merchant-declared stock change. Treat each event as its own semantic type.

Required dataset manifest fields: dataset ID/version, owner, approved purpose, source, schema, licence/legal basis/consent, PII classification, minimisation, retention/deletion, label guide, split strategy, leakage checks, checksum, access group and approval record.

### 6.3 Data that is excluded by default

- Private WhatsApp messages and contact books.
- Appeals, enforcement notes and private support conversations.
- Passwords, tokens, secrets, payment credentials and identity documents not specifically approved for a narrow verification workflow.
- Raw buyer-level browsing histories for broad model training.
- Any sensitive-trait labels or inferred income/class, religion, health, ethnicity or political attributes.

## 7. Shared evaluation and release gates

Every module must pass the following before customer-facing activation:

1. **Contract:** typed schema, version compatibility, validation and deterministic fallback.
2. **Data:** provenance, purpose, minimisation, retention, deletion and leakage review.
3. **Security:** authentication, authorisation, tenant isolation, abuse and prompt-injection tests.
4. **Quality:** fixed benchmark, baseline comparison, slice analysis and documented failure modes.
5. **Operational:** p50/p95 latency, availability, timeout, concurrency, CPU/GPU/token/storage cost and provider outage tests.
6. **Safety:** false-positive/false-negative analysis and human escalation for consequential outcomes.
7. **Shadow:** compare candidate outputs without changing buyer/merchant experience.
8. **Approval:** owner sign-off, feature flag, monitoring, rollback and kill switch.

Recommended metric families:
- Retrieval/ranking: Recall@K, NDCG@K, MRR, diversity and exposure fairness.
- Classification: precision, recall, F1, calibration and per-class confusion.
- Forecasting: MAE, MASE/WAPE and prediction-interval coverage.
- Extraction/assistant: field accuracy, groundedness, unsupported-claim rate and human correction rate.
- Trust/safety: reviewer precision, false-positive impact, appeal overturn rate and evidence completeness.
- Platform: availability, latency, cost/request, queue age and fallback rate.

No universal numeric threshold should be invented before a baseline dataset exists. Each module owner must propose thresholds from a labelled benchmark and operational risk.

## 8. Implementation order

### Phase 0 — Reconcile and audit
- Reconcile this matrix against the canonical 40-module registry and current PR/branch state.
- Complete the deeper source audit of current discovery, analytics, moderation, account restriction, privacy and event code.
- Record which existing functions can be reused, replaced or retired.
- Pin Hermes release and validate its skill/tool permission model.

### Phase 1 — Foundations before models
- Define event dictionary, data classification, consent and retention.
- Define module API contracts, auth scopes, tenant isolation, trace IDs and kill switches.
- Build a synthetic test catalogue and fixed benchmark sets.
- Build the CPU-first evaluation harness and deterministic fallbacks.
- Implement the first Mudaala-owned Hermes skills in Git.

### Phase 2 — First practical modules
Recommended initial sequence:
1. MCI-27 Merchant performance analyst — reuse existing analytics.
2. MCI-38 Merchant growth coach — reuse existing deterministic growth logic.
3. MCI-02 Retrieval planner and MCI-03 Product relevance ranker — improve discovery without a Hermes request dependency.
4. MCI-06 Similar-item discovery and MCI-08 Diversity controller.
5. MCI-01 Query understanding and MCI-04 Personalisation only after consent/data readiness.

### Phase 3 — Research and training
- Run model/framework bake-offs in Modal on synthetic/public data.
- Evaluate embedding models for local terminology and product imagery.
- Compare RecBole/TFRS/LightGBM candidates against deterministic baselines.
- Introduce MLflow only if reproducibility needs exceed a simple versioned benchmark harness.
- Train only when the measured benefit exceeds operational and governance cost.

### Phase 4 — Deferred domains
Defer transaction risk until order/payment data exists; defer shipment prediction until carrier events exist; defer supplier authenticity/compliance automation until source and human-review processes exist; defer advanced demand forecasting until sufficient reliable time-series data exists.

## 9. Resource approval register

| Resource family | Initial status | Required before approval |
|---|---|---|
| Hermes Agent + native skills | RESEARCH CANDIDATE | Pin release; verify official docs, tool scopes, isolation, persistence, update policy and tests |
| Agent Skills format | RESEARCH CANDIDATE | Compatibility and security review |
| PostgreSQL-native retrieval | Existing platform capability; implementation review required | Benchmark query plan and data access policies |
| RecBole / TFRS / TensorFlow Ranking | RESEARCH CANDIDATE | Same benchmark, licence/dependency review and operational comparison |
| Sentence Transformers / OpenCLIP / SigLIP | RESEARCH CANDIDATE | Model-card/licence review and local relevance benchmark |
| LightGBM / XGBoost / scikit-learn | RESEARCH CANDIDATE | Benchmark, licence and serving footprint |
| Modal | RESEARCH CANDIDATE | Verify current plan limits, always-on architecture, region, secrets, network and spend controls |
| MLflow | RESEARCH CANDIDATE | Hosting, auth, metadata DB, artifact storage and maintenance cost review |
| ABO dataset | RESEARCH CANDIDATE | Verify downloaded asset licence/attribution and subset scope |
| Qdrant / pgvector / ScaNN | RESEARCH CANDIDATE | Prove PostgreSQL-native baseline is insufficient first |

## 10. Known gaps and honest limitations

- The matrix is a first engineering allocation, not a complete bill of materials or a measured cost estimate.
- Candidate versions, licences, model cards, API pricing and hosting regions must be checked at implementation time.
- Several modules depend on product domains or data that may not exist yet. Their presence in the registry does not justify implementing them now.
- Mudaala-specific labelled data is currently the largest likely quality gap. Public datasets cannot replace local product, language, locality and merchant behaviour evaluation.
- The 40-module registry was read from `architecture/commerce-intelligence-foundation`; this matrix is being committed to the separate intelligence master-plan branch. The two branches must be reconciled before merge so there is one canonical registry and no duplicated/conflicting documents.
- No external resource is approved for production by this document. No code, schema, production configuration or customer-facing behaviour is changed by this document.

## 11. Next engineering deliverable

Create a machine-readable resource register (CSV/JSON) from this matrix with stable IDs and fields for candidate version, source URL, licence, owner, evidence status, benchmark result, approval date and rejection reason. Then assign owners and verify the current repository state before any runtime implementation.
