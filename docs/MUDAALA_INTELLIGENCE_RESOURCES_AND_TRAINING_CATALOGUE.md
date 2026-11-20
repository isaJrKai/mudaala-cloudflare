# Mudaala Intelligence — Skills, Resources and Training Catalogue

**Status:** Initial curated research register; candidates are not yet approved dependencies.  
**Date:** 2026-11-20  
**Parent plan:** `docs/MUDAALA_INTELLIGENCE_INFRASTRUCTURE_MASTERPLAN.md`  
**Repository baseline:** `isaJrKai/mudaala-cloudflare`

## 1. Purpose

This catalogue answers four distinct questions:

1. What reusable skills and agent workflows can Hermes use?
2. What existing software, models and frameworks can implement the 40 Mudaala Intelligence capabilities?
3. What datasets, courses, technical references and benchmarks can train the engineering team and validate the system?
4. What isolated infrastructure is needed to prepare data, train, evaluate, version and serve models?

The goal is to reuse high-quality existing work, not to install every popular AI project. Every candidate must pass licence, security, compatibility, quality, cost and Mudaala relevance checks before adoption.

**Important:** A Hermes skill is usually procedural knowledge and tool-use instructions. It is not itself a trained ML model. A model is not automatically a Hermes skill. A dataset is not automatically suitable training data. Keep these resource types separate in the registry.

## 2. Resource register and review status

Use the following status values:

- **RESEARCH CANDIDATE** — promising resource identified; not yet inspected deeply.
- **TECHNICALLY REVIEWED** — code/docs, dependencies, licence and fit inspected.
- **BENCHMARKED** — evaluated on a Mudaala-relevant task against a baseline.
- **APPROVED** — owner-approved for a specified environment and purpose.
- **REJECTED** — not suitable; retain the reason to avoid repeating research.

No external candidate in this initial register is yet approved for production.

## 3. Hermes skill and agent ecosystem

### 3.1 Hermes native skill system

**Candidate:** NousResearch Hermes Agent skill system  
**Reference:** https://github.com/NousResearch/hermes-agent  
**Skills documentation:** https://hermesagent.nousresearch.com/docs/user-guide/features/skills/ (verify canonical documentation URL against the pinned release)

What it offers:
- On-demand skills loaded when relevant, rather than placing every procedure in the base prompt.
- A reusable skill directory and external skill directories.
- Agent-managed skill creation and maintenance.
- Skill bundles for workflows that consistently require several skills.
- A skill learning workflow that can turn reviewed documentation and successful procedures into reusable instructions.
- A write-approval mechanism for skill changes in supported versions.

Mudaala use:
- Treat Hermes as the skill runtime and orchestrator.
- Keep Mudaala-specific skills in a version-controlled repository, not only in an ephemeral Modal container home directory.
- Mount or sync reviewed skill bundles into Hermes at deployment.
- Enable approval for skill creation/edits/deletion; agent-created skills must not silently become trusted production procedures.
- Test each skill with positive, negative, permission-boundary and prompt-injection cases.
- Pin the exact Hermes release and verify feature names/configuration against that release before implementation.

### 3.2 Open Agent Skills standard

**Candidate:** Agent Skills open standard  
**Reference:** https://agentskills.io/

Purpose:
- A portable format for procedural skills that can be reused across compatible agent runtimes.
- Helps avoid locking every Mudaala procedure into one agent vendor's private format.

Adoption rule:
- Use the standard where it fits, but maintain a Mudaala skill manifest with runtime-specific tool permissions, dependencies, owner, tests and version.
- A Markdown skill file is untrusted instructions until reviewed. It must not grant capabilities by itself.

### 3.3 Skills to build or adapt first

These are proposed Mudaala-owned skills, not claims that ready-made packages already exist.

| Skill ID | Skill | Main job | Depends on |
|---|---|---|---|
| MSK-001 | Mudaala Product & Policy Orientation | Explain product boundaries, policies, user journeys and verified facts | Approved Mudaala docs |
| MSK-002 | Repository Investigator | Inspect source, trace routes/data flow, run tests and report evidence | GitHub/repo read tools |
| MSK-003 | Architecture Decision Writer | Compare options and record decisions, assumptions and trade-offs | Repository Investigator |
| MSK-004 | Commerce Event Analyst | Interpret allowed aggregate events without treating clicks as sales | Event dictionary |
| MSK-005 | Product Catalogue Analyst | Map product text/photos to categories and attributes with evidence | Product taxonomy |
| MSK-006 | Search Relevance Evaluator | Build query sets, judge retrieval results and calculate ranking metrics | Search benchmark |
| MSK-007 | Buyer Discovery Analyst | Analyse local relevance, diversity and cold-start outcomes | Discovery contracts |
| MSK-008 | Merchant Growth Analyst | Generate evidence-backed merchant recommendations | Merchant analytics |
| MSK-009 | Price Evidence Analyst | Compare prices only with matching currency, unit, condition and sample quality | Price-trend data |
| MSK-010 | Trust & Safety Triage | Summarise evidence and route uncertain cases to authorised humans | Safety policy |
| MSK-011 | Model/Dataset Auditor | Review provenance, licence, leakage, bias and evaluation quality | Resource registry |
| MSK-012 | Training Run Operator | Prepare jobs, track experiments and report reproducible outcomes | Training Lab |
| MSK-013 | Evaluation & Red-Team Operator | Run fixed benchmark, adversarial, privacy and regression tests | Evaluation Lab |
| MSK-014 | Incident & Provider Recovery | Diagnose worker, queue, provider and model failures | Runbooks/observability |
| MSK-015 | Release & Rollback Reviewer | Check evidence and prepare human approval for a model/skill release | Model registry |

Each skill specification must contain: objective, trigger conditions, required context, allowed tools, forbidden actions, typed inputs/outputs, step-by-step method, evidence requirements, error handling, security notes, examples, test cases, owner and version.

### 3.4 External skill discovery sources

- Hermes bundled skills and Skills Hub — inspect exact source, licence, code and dependencies before adoption.
- Agent Skills ecosystem — discover portable procedural skills, but treat third-party skills as untrusted.
- GitHub — search by narrow task and inspect repository activity, licence, open issues, dependencies and code before importing.
- Existing Mudaala docs, scripts, CI workflows and successful engineering procedures — often the most accurate source of Mudaala-specific skills.

Do not bulk-install a third-party skill collection. Build a small curated set, keep it in Git, run automated checks and require approval for changes.

## 4. Reusable ML and AI frameworks

### 4.1 Recommendation and ranking

**RecBole** — https://recbole.io/docs/  
PyTorch recommendation framework with a broad catalogue of recommendation algorithms, benchmark datasets and evaluation protocols. It is a strong research/benchmark candidate for MCI-03, MCI-04, MCI-06 and parts of MCI-17/18. It is not automatically the production serving layer. Test data mapping, cold-start behaviour, temporal leakage and local-commerce relevance.

**TensorFlow Recommenders (TFRS)** — https://www.tensorflow.org/recommenders  
Framework for retrieval and ranking models, user/item/context features, training, evaluation and deployment. Candidate for two-stage retrieval/ranking experiments. Compare with RecBole on the same Mudaala benchmark before choosing.

**TensorFlow Ranking** — https://www.tensorflow.org/ranking  
Candidate learning-to-rank toolkit for ranking lists. Consider only after enough reliable relevance labels and a stable candidate retrieval baseline exist.

**Google ScaNN** — https://github.com/google-research/google-research/tree/master/scann  
Approximate nearest-neighbour search candidate for vector retrieval. Benchmark against simpler database indexes and other ANN options at realistic catalogue sizes before introducing another service.

### 4.2 Data, model and embedding tooling

**Hugging Face Hub and Datasets**
- https://huggingface.co/docs/hub/
- https://huggingface.co/docs/datasets/

Candidate for discovering pretrained text/vision models and datasets, dataset loading/streaming, dataset cards and model provenance. Check each model/dataset's individual licence, usage restrictions, provenance and data quality. A Hub listing is not an endorsement.

**Sentence Transformers** — https://www.sbert.net/  
Candidate for text embeddings, semantic similarity and retrieval. Evaluate multilingual and local product terminology performance, including spelling variants and Luganda/English/other local-language code-switching where supported.

**Transformers** — https://huggingface.co/docs/transformers/  
Candidate model loading, inference and fine-tuning ecosystem. Use only for model families that pass deployment, licence, latency and hardware evaluation.

### 4.3 LLM fine-tuning and post-training

Candidate tools:
- **TRL:** https://huggingface.co/docs/trl/
- **Axolotl:** https://docs.axolotl.ai/
- **LLaMA-Factory:** https://llamafactory.readthedocs.io/
- **Unsloth:** https://docs.unsloth.ai/

These are not initial requirements for Hermes. They are candidates if evaluation later demonstrates a specialist language task where fine-tuning materially improves quality over prompt/skill design, retrieval, structured tools or a smaller task-specific model.

Do not fine-tune a large general model just to make it "know Mudaala". Product and policy facts should be retrieved from versioned knowledge sources. Fine-tuning is for repeatable behaviour/style/task adaptation where there is a high-quality dataset and a measurable evaluation.

### 4.4 Data processing and model serving

Candidates to evaluate only as needed:
- **Polars / pandas / DuckDB:** data preparation, analytics and local/offline evaluation.
- **PyTorch / scikit-learn / XGBoost / LightGBM:** conventional ML and tabular modelling.
- **FastAPI or typed Python service:** isolated inference APIs where Python ecosystem is needed.
- **ONNX Runtime:** portable inference for models that export cleanly.
- **Qdrant or pgvector:** vector retrieval only if measured relevance and operational needs justify it. First assess existing PostgreSQL capabilities and expected scale.

Avoid adopting a tool just because it is common. Every new service adds security, backup, monitoring, upgrade and cost obligations.

## 5. Training and evaluation infrastructure

### 5.1 Modal

**References:** https://modal.com/docs and https://modal.com/products/training

Modal is a strong candidate for:
- isolated Python containers;
- elastic CPU/GPU batch jobs;
- preprocessing and dataset preparation;
- bounded model training/fine-tuning experiments;
- evaluation jobs and batch inference;
- parallel simulation and load tests.

The Modal training materials describe workflows for data preprocessing, supervised fine-tuning, distributed GPU training and reinforcement-learning rollouts, with support for bringing common open-source training stacks.

Mudaala rule:
- Begin with Starter allowance for proof-of-concept and small experiments.
- Treat included credits and limits as changeable; verify the live plan before each paid workload.
- Do not assume Model API tokens are covered by compute credits.
- Do not assume a serverless Modal function is an always-on Hermes control plane.
- Put hard spend limits, concurrency limits, timeouts and owner approval around GPU jobs.
- Keep production secrets and direct production database credentials out of training containers.

### 5.2 Experiment tracking and model registry

**MLflow** — https://mlflow.org/docs/latest/  
Candidate for experiment tracking, model lineage, versioning, evaluation datasets and model registry. It can record which dataset, code, parameters and run produced a model and support promotion/rollback workflows. Evaluate hosting and database/storage requirements before adoption.

Potential alternative: keep the first benchmark harness simple (versioned JSONL/Parquet + scripts + GitHub Actions artifacts) until experiment volume justifies a dedicated MLflow server.

### 5.3 Dataset and artifact storage

- Keep small test fixtures and schemas in Git.
- Keep large datasets and model artefacts in versioned object storage with access controls.
- Keep data lineage, licence, retention and checksums in a dataset registry.
- Never commit private user data, secrets, large model weights or raw production event dumps to Git.
- Use separate development, staging and production credentials.
- Ensure deletion/consent changes can be propagated to derived data where required.

### 5.4 Training environment layout

| Environment | Data allowed | Purpose |
|---|---|---|
| Local developer | Synthetic/public fixtures | Development and unit tests |
| Research sandbox | Public/licensed datasets; untrusted code isolated | Resource/model investigation |
| Data preparation | Approved minimised datasets | Cleaning, labels, splits and validation |
| Training | Approved versioned datasets only | Model fitting/fine-tuning |
| Evaluation | Fixed holdout and adversarial suites | Quality, privacy and regression testing |
| Staging | Synthetic/approved test data | Contract and integration testing |
| Shadow | Strictly scoped production-derived features where approved | Compare candidate to current baseline without user impact |
| Production | Only serving artefacts and authorised request data | Inference |

## 6. Training, documentation and learning curriculum

These resources educate the engineering process and support model development; they do not replace Mudaala-specific data or domain evaluation.

### 6.1 Core ML foundations

**Google Machine Learning Crash Course**  
https://developers.google.com/machine-learning/crash-course/  
Practical introduction to ML concepts, interactive exercises and model evaluation. Use for a shared baseline across the engineering workstream.

**Hugging Face Course**  
https://huggingface.co/learn  
Practical learning for Transformers, datasets, tokenisers and model ecosystem. Select only chapters relevant to the chosen models and tasks.

### 6.2 Recommendation systems

**Google Recommendation Systems Course**  
https://developers.google.com/machine-learning/recommendation/  
Covers candidate generation, scoring, reranking, embeddings, collaborative filtering and matrix factorisation. Directly relevant to MCI-01–08 and MCI-17.

**TensorFlow Recommenders tutorials**  
https://www.tensorflow.org/recommenders  
Hands-on retrieval/ranking workflow and user/item/context modelling.

**RecBole tutorials and benchmark docs**  
https://recbole.io/docs/  
Useful for comparing established recommendation approaches with consistent evaluation metrics.

### 6.3 Training and model operations

- PyTorch tutorials: https://pytorch.org/tutorials/
- Hugging Face Transformers: https://huggingface.co/docs/transformers/
- Hugging Face Datasets: https://huggingface.co/docs/datasets/
- TRL documentation: https://huggingface.co/docs/trl/
- Modal training docs: https://modal.com/products/training
- MLflow tracking and registry: https://mlflow.org/docs/latest/

### 6.4 Product vision and retrieval learning

The Amazon Berkeley Objects (ABO) dataset is a possible public benchmark resource for product metadata and catalogue-image experiments:
- https://amazon-berkeley-objects.s3.amazonaws.com/index.html
- https://www.amazon.science/code-and-datasets/amazon-berkeley-objects-abo-dataset

The dataset contains product listings and a large image collection, and its current dataset page states CC BY 4.0. Preserve attribution and re-check the exact licence in downloaded artefacts. It is not representative of Ugandan shops, local photography, local categories or actual Mudaala inventory. Use it only for general pipeline and visual-retrieval experiments, never as a substitute for Mudaala-specific evaluation. The full image archive is large; begin with metadata and small images, not the entire archive.

## 7. Mudaala-specific training data strategy

The most valuable training resource over time will be carefully collected, consented and labelled Mudaala data, not the largest public dataset.

### 7.1 Data sources to assess

- Existing listing/shop catalogue fields and product images.
- Existing search and discovery interaction events.
- Saved searches and category interests, subject to purpose and consent.
- Merchant edits, photo additions and declared inventory changes.
- Shop/product impressions, views, saves and contact taps.
- Explicit buyer relevance feedback where designed and consented.
- Merchant feedback on whether a suggested action was useful.
- Human-reviewed moderation and support labels only with purpose, access and privacy review.

### 7.2 Labels and outcomes

Create explicit definitions:
- relevant / not relevant / uncertain;
- correct category / incorrect category / needs review;
- image match / plausible match / no match;
- price comparable / not comparable;
- recommendation useful / not useful / unknown;
- merchant action accepted / dismissed / completed / outcome unknown;
- safety policy violation / allowed / uncertain.

Do not turn weak proxies into ground truth:
- WhatsApp tap is not a sale.
- Shop view is not purchase intent certainty.
- Poster download is not proof of external sharing.
- Listing price is not confirmed transaction price.
- A seller's claim is not independent verification.

### 7.3 Dataset governance

Each dataset must have:
- owner and approved purpose;
- source and provenance;
- schema and version;
- licence/consent/legal basis;
- PII classification and minimisation method;
- retention/deletion policy;
- label definitions and annotator guidance;
- train/validation/test split method;
- leakage prevention and temporal split where relevant;
- quality report, known bias and representativeness limitations;
- access controls and audit logs.

Do not train on private WhatsApp messages, appeal records, support conversations or other sensitive content by default. Require a separate documented approval and user-facing privacy review before considering such data.

## 8. Mapping reusable resources to the 40 modules

This is a first-pass map of resource families, not a final model selection.

| Modules | Resource families to investigate |
|---|---|
| MCI-01–02 Query understanding / retrieval | Search libraries, multilingual text models, Sentence Transformers, retrieval benchmarks |
| MCI-03–04 Product ranking / personalisation | RecBole, TFRS, TensorFlow Ranking, first-party interaction events |
| MCI-05 Visual matching | Vision encoders, image embeddings, OCR, ABO benchmark, Mudaala product images |
| MCI-06 Similar items | Text/image embeddings, ANN retrieval, catalogue attributes |
| MCI-07 Local ranking | Geospatial SQL, deterministic eligibility and distance constraints, ranking evaluation |
| MCI-08 Diversity | Re-ranking algorithms, exposure and catalogue-coverage metrics |
| MCI-09–10 Identity / supplier evidence | Document extraction, entity resolution, evidence workflow; human verification remains mandatory |
| MCI-11–12 Listing/image safety | Policy taxonomy, moderation classifiers, reviewed labelled examples and human moderation |
| MCI-13–14 Fraud / reputation integrity | Tabular anomaly detection, graph features, rate/abuse rules, reviewed case labels |
| MCI-15 Transaction risk | Defer until supported transaction/payment domain and data exist |
| MCI-16 Case triage | Retrieval-grounded summarisation, structured classification and human review |
| MCI-17–19 Preferences / intent / budget fit | Consent-aware features, ranking models, declared budget signals; no sensitive inference |
| MCI-20–21 Buyer journey / support routing | Grounded retrieval, intent classification, approved knowledge base and escalation |
| MCI-22 Retention | Cohort analysis and calibrated churn signals with opt-in controls |
| MCI-23 Listing enrichment | Vision-language models, OCR, taxonomy, structured generation with seller approval |
| MCI-24 Inventory | Deterministic declared-stock state and reconciliation; no inferred stock truth |
| MCI-25 Demand forecast | Time-series libraries, hierarchical forecasting and aggregate category/area history |
| MCI-26 Pricing | Comparable-item retrieval, robust statistics and uncertainty intervals |
| MCI-27 Merchant analytics | Existing first-party analytics, SQL and explanatory templates |
| MCI-28 Restock | Demand forecasts plus merchant-declared supply constraints |
| MCI-29–31 Supplier discovery / authenticity / wholesale compare | Search/retrieval, entity resolution, document extraction, source provenance and human checks |
| MCI-32 Landed cost | Deterministic calculation engine with maintained official rates/fees; not an LLM estimate |
| MCI-33 Trade compliance | Current official source retrieval, rules and qualified human review |
| MCI-34 Shipment visibility | Carrier integrations and milestone history; forecast only after sufficient data |
| MCI-35–37 Advertising | Eligibility policy, constrained ranking and consent-safe audience aggregates |
| MCI-38 Merchant growth | Existing merchant-growth rules, event analytics and controlled experiments |
| MCI-39 Liquidity | Aggregate supply/demand statistics, privacy thresholds and time-series analysis |
| MCI-40 Network abuse | Deterministic rate limits, graph/anomaly signals, security telemetry and human review |

## 9. Initial adoption priorities

Recommended order for resource investigation:

1. **Hermes skill system + Agent Skills standard:** establish how reusable procedures are authored, stored, permissioned, tested and reviewed.
2. **Hugging Face Hub/Datasets + model cards:** establish a repeatable model and dataset discovery process.
3. **RecBole and TFRS:** run one controlled recommendation benchmark, not two production deployments.
4. **Google recommendation course:** align the team on retrieval, ranking, re-ranking and evaluation.
5. **Modal:** prove isolated CPU/GPU preprocessing and evaluation jobs within the initial spend limit.
6. **MLflow:** decide whether experiment volume justifies a dedicated tracking/registry service.
7. **ABO dataset:** run a small image/catalogue experiment with attribution and explicit domain limitations.
8. **Mudaala event and label foundation:** build a privacy-approved first-party evaluation dataset. This becomes the critical long-term asset.

## 10. Required deliverable: 40-module resource matrix

Before selecting implementation libraries, create a machine-readable register with one row per MCI module and fields:

- module_id, name, owner, product outcome;
- current Mudaala implementation and file paths;
- dependency modules and contracts;
- skill IDs used by Hermes;
- candidate repositories, frameworks and model IDs;
- candidate dataset IDs and licence;
- data availability and minimum sample requirements;
- Adopt/Adapt/Train/Build/Reject decision;
- benchmark task, baseline and metric;
- CPU/GPU/memory requirements;
- expected inference latency and cost;
- privacy/security risk and mitigation;
- integration estimate and maintenance burden;
- status, reviewer, evidence links and next action.

No module can move from RESEARCHED to BENCHMARKED without a reproducible experiment. No module can move to APPROVED without owner review.

## 11. First practical training programme

The initial training programme should not begin by fine-tuning a large model.

**Stage A — Teach the engineering team**
- Google ML Crash Course.
- Google Recommendation Systems Course.
- Hugging Face Datasets and model-card basics.
- Hermes skills and permissions.
- Modal job/container basics.

**Stage B — Teach Hermes Mudaala procedures**
- Load verified Mudaala product, policy, technical and operational knowledge.
- Install only reviewed, relevant skills.
- Create task-specific skill bundles.
- Test with a fixed suite of Mudaala questions and repository tasks.
- Require approval for skill/memory changes.

**Stage C — Build a small reproducible model experiment**
- Start with product search/recommendation or image classification, not all 40 modules.
- Use a public benchmark to validate the pipeline.
- Use synthetic Mudaala-like fixtures for integration tests.
- Add approved first-party data only after privacy and label quality review.
- Record code, dataset, model, metrics, hardware, latency and cost.

**Stage D — Establish release discipline**
- Fixed holdout set.
- Baseline comparison.
- Error analysis by category, language, locality and new/established shops.
- Privacy and prompt-injection tests.
- Shadow deployment.
- Human approval and rollback.

## 12. Open questions to resolve during resource audit

- Which Hermes release and deployment mode will be pinned?
- Which base model/provider offers the best quality, latency, data handling and total cost for the Hermes control plane?
- Which skills are already bundled in that release, and which external skills have acceptable licences?
- What languages and local spelling/terminology are actually represented in Mudaala catalogue data?
- Which product categories have enough labelled examples to train or evaluate classifiers?
- What first-party event signals have sufficient quality and consent for recommendation experiments?
- Does the existing Supabase/Postgres footprint support the first retrieval/index workload, or is a separate vector service justified?
- At what workload should MLflow be introduced instead of simple versioned experiment artefacts?
- Which GPU model and region meet measured quality and latency requirements from Uganda?
- What are the actual monthly spend caps approved by the owner?

---

## 13. References checked during initial research

- Hermes Agent skill system: https://github.com/NousResearch/hermes-agent
- Agent Skills standard: https://agentskills.io/
- Modal pricing and compute: https://modal.com/pricing
- Modal training: https://modal.com/products/training
- RecBole documentation: https://recbole.io/docs/
- TensorFlow Recommenders: https://www.tensorflow.org/recommenders
- TensorFlow Ranking: https://www.tensorflow.org/ranking
- Hugging Face Hub and Datasets: https://huggingface.co/docs/hub/ and https://huggingface.co/docs/datasets/
- Sentence Transformers: https://www.sbert.net/
- MLflow registry: https://mlflow.org/docs/latest/
- Google ML Crash Course: https://developers.google.com/machine-learning/crash-course/
- Google Recommendation Systems Course: https://developers.google.com/machine-learning/recommendation/
- Amazon Berkeley Objects: https://amazon-berkeley-objects.s3.amazonaws.com/index.html

**End of initial resource and training catalogue.**
