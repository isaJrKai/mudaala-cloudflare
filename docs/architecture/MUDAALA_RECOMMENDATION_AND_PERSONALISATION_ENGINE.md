# Mudaala Recommendation and Personalisation Engine
## Functional and architectural design

**Status:** Working design — for discussion and validation, not implementation approval  
**Scope:** Buyer-facing product and shop discovery, merchant/product evaluation, personalisation, ranking, exploration, feedback and recommendation measurement  
**Companion documents:**
- `docs/product/MUDAALA_PRODUCT_CONSTITUTION.md`
- `docs/product/MUDAALA_PLATFORM_OPERATING_PRINCIPLES.md`
- `docs/vision/MUDAALA_COMMERCE_DISCOVERY_NETWORK.md`

---

## 1. Purpose

The recommendation engine should help each buyer discover products and shops that are useful to their needs, while giving eligible merchants a fair opportunity to earn visibility through relevant products, reliable information and demonstrated customer outcomes.

It should learn from two distinct sources of evidence:

1. **Buyer behaviour:** what a particular buyer is looking for, prefers, rejects, saves, compares or purchases.
2. **Merchant and product performance:** whether a shop and a specific listing are legitimate, relevant, accurate, responsive and capable of serving demand.

These are related inputs to a recommendation, but they are not the same score and must not be collapsed into one opaque measure.

The engine is not designed to maximise screen time, clicks, notification volume or the dominance of already popular shops. Its purpose is to improve useful discovery and successful commerce connections.

## 2. Product outcomes

The engine should help a buyer:

- Find an exact product or a clearly labelled suitable alternative.
- Discover shops that can realistically serve their location.
- Compare meaningful differences such as price, availability, distance, delivery and evidence of reliability.
- See recommendations that become more relevant as their preferences become clearer.
- Correct recommendations that are inaccurate, repetitive or unwanted.
- Make their own choice without hidden platform pressure.

It should help a merchant:

- Become discoverable when their products match genuine buyer needs.
- Earn greater opportunity through reliable product information and substantiated customer outcomes.
- Understand, at an appropriate level, why products are being recommended.
- Correct stale information and challenge material errors.
- Compete for discovery without needing to buy visibility or manufacture engagement.

## 3. The two learning loops

### 3.1 Buyer personalisation loop

The buyer loop learns what is relevant to an individual.

**Observe → Interpret → Recommend → Receive feedback → Improve**

Potential signals include:

- Search terms and explicit product requests.
- Product categories and attributes deliberately explored.
- Product detail views, with care not to overvalue accidental opens.
- Saves, comparisons and shop follows.
- Buyer-initiated enquiries and contact actions.
- Purchases or repeat purchases when adequately confirmed.
- Explicit preference controls such as “show me more”, “not interested” or “show me less”.
- Buyer-selected location, service area, budget and delivery preferences.

Signals should be interpreted according to intent, recency, repetition and reliability. Explicitly stated preferences and confirmed purchases are stronger evidence than a single view. An enquiry is not a purchase. A click to WhatsApp is not proof of a sale.

The buyer loop should update relevance, not merchant trust. A buyer's activity must not make a merchant more trustworthy.

### 3.2 Merchant and product evaluation loop

This loop learns whether a shop and its listings are suitable candidates for recommendation.

**Establish eligibility → Observe evidence → Evaluate in context → Allocate exposure → Measure outcomes → Reassess**

Potential evidence includes:

- Business identity and reachable contact information.
- Product authenticity, completeness and accuracy.
- Price clarity and availability freshness.
- Location and service coverage.
- Responsiveness to genuine enquiries.
- Fulfilment and customer outcomes where observable.
- Credibly supported completed sales and repeat business.
- Corrections, disputes, complaints and integrity events.

A merchant-level assessment must not automatically make every product recommendable. Each product must qualify independently.

### 3.3 How the loops meet

A recommendation is produced by matching a buyer's current need and preferences to eligible products and shops that can serve that need.

The buyer loop answers: **“What is likely to be useful to this person now?”**

The merchant/product loop answers: **“Which candidates are eligible and what evidence supports showing them?”**

The final decision combines these answers in context. Neither loop should be allowed to silently replace the other.

## 4. Recommendation pipeline

The logical pipeline should be understandable, observable and reversible.

1. **Understand the request:** identify the buyer's query, intent, product/category, attributes, budget, quantity, urgency and location where available.
2. **Generate candidates:** search Mudaala's existing product catalogue and shop records first.
3. **Apply hard eligibility rules:** exclude products or merchants that fail required integrity, listing, safety or serviceability checks.
4. **Establish contextual relevance:** compare candidate products against the actual request and buyer-stated preferences.
5. **Evaluate evidence:** consider listing freshness, price clarity, availability, merchant reliability and substantiated commercial history.
6. **Personalise:** adapt the ordering to the buyer's relevant preferences and prior meaningful interactions.
7. **Preserve useful choice:** provide a varied set of relevant options rather than repeatedly showing near-identical listings.
8. **Explain:** provide truthful reasons for meaningful recommendations.
9. **Observe outcomes:** measure useful discovery, buyer choice, qualified connections and confirmed outcomes where evidence exists.
10. **Reassess:** update the relevant signals when new evidence arrives or old information becomes stale.

The pipeline should be capable of returning useful results when personalisation data is sparse or unavailable. A new or anonymous buyer must still receive good basic discovery.

## 5. Eligibility comes before ranking

Ranking must not rescue an ineligible listing.

### Merchant-level eligibility

Potential requirements include:

- A coherent and reachable merchant identity.
- Required business/contact information for the relevant operating model.
- No unresolved disqualifying integrity issue.
- A valid relationship between the merchant and the shop being represented.

Requirements should accommodate legitimate informal and small businesses. Company registration or a public storefront must not be treated as universal prerequisites where they are not appropriate.

### Product-level eligibility

Potential requirements include:

- Genuine representation of the product.
- A useful image or an honest explanation where no image is available.
- A meaningful product name and sufficient description.
- A clear price, price range or explicit quotation status.
- Availability that is current or transparently marked unconfirmed.
- Understandable location, delivery or collection information where relevant.
- No misleading, prohibited or otherwise ineligible content.

A shop can remain active while an individual listing is corrected, unavailable or temporarily excluded.

## 6. Contextual ranking dimensions

The engine should not begin with one universal formula. It should evaluate dimensions according to the buyer's request and the type of discovery surface.

| Dimension | Question it helps answer |
|---|---|
| Intent match | Does this product actually meet the request? |
| Product suitability | Do its attributes, model, size, variant or condition fit? |
| Local serviceability | Can this merchant realistically serve the buyer? |
| Price clarity | Can the buyer understand the likely cost? |
| Availability freshness | How recently and reliably was availability confirmed? |
| Merchant standing | Is there sufficient evidence of legitimate and responsible operation? |
| Customer outcomes | Is there credible evidence of good responses and fulfilment? |
| Commercial evidence | Are completed sales or repeat purchases adequately supported? |
| Personal preference | Does this fit the buyer's expressed and inferred preferences? |
| Diversity | Does the result set offer useful alternatives rather than duplication? |

The context changes the importance of each dimension. For example:

- A buyer asking for the cheapest option needs price comparability.
- A buyer asking for an urgent item needs current availability and serviceability.
- A buyer asking for a particular model needs exact attribute matching.
- A buyer browsing a category may benefit from discovery and controlled exploration.

A strong merchant history must not compensate for an irrelevant product. A high-performing listing must not override a serious integrity failure.

## 7. Sales, commercial evidence and earned visibility

Sales matter because they can demonstrate real demand and successful commercial activity. As a merchant accumulates credible evidence of completed sales, repeat purchases and positive customer outcomes, Mudaala may have greater confidence in recommending eligible products from that shop.

However, the system must distinguish the evidence behind each claim:

- Merchant-reported sale.
- Sale supported by merchant records.
- Buyer-confirmed purchase.
- Transaction recorded by Mudaala.
- Repeat purchase supported by reliable evidence.
- Fulfilment or customer outcome confirmed by an appropriate source.

Views, impressions, follows, clicks, enquiries and external messaging handoffs are not completed sales.

**Commercial performance is evidence, not a purchase of ranking and not a complete trust score.**

Sales evidence may improve the merchant's commercial standing and contribute to exposure decisions when relevant. It must not automatically make every product rank higher, guarantee trust, or override relevance, price, availability, customer treatment or integrity.

The engine must account for differences in category, transaction value, sales frequency, business age, seasonality and business model. A low-volume specialist should not be judged by the same raw sales count as a high-frequency grocery shop.

## 8. Fair exposure and the new-merchant problem

A recommendation engine can create a self-reinforcing loop:

**More exposure → more interactions and sales → stronger historical signals → still more exposure.**

Without safeguards, this can make established shops permanently dominant and prevent new merchants from proving themselves.

The engine should therefore:

- Give eligible new merchants a fair opportunity to enter relevant discovery.
- Use controlled exploration among eligible, contextually relevant candidates.
- Avoid letting historic exposure or popularity dominate current relevance.
- Monitor concentration of impressions and useful connections across merchants.
- Evaluate merchants in context, including category and stage.
- Limit repetitive exposure where alternatives exist.
- Never use exploration to bypass eligibility or integrity requirements.

Exploration is not random promotion. It is a measured way to learn whether an eligible, relevant candidate can serve buyers when the system has limited evidence.

The system should distinguish lack of evidence from evidence of poor performance. A new shop with no sales history is not automatically an unreliable shop.

## 9. Personalisation behaviour and controls

Personalisation should become more useful as meaningful evidence accumulates.

The engine may learn preferences for:

- Product categories and specific attributes.
- Price ranges or budget constraints.
- Preferred locations and service areas.
- Brands, models, sizes or variants.
- Shops the buyer deliberately follows.
- Delivery, collection or other stated fulfilment preferences.

It should also learn from negative feedback and corrections.

Buyer controls should eventually include:

- “Not interested.”
- “Show me less like this.”
- “Show me more like this.”
- Remove or reset an inferred preference.
- Manage saved interests and followed shops.
- Control notification permissions separately from in-app recommendations.

Do not infer sensitive personal traits or use unrelated private information to shape commercial recommendations.

## 10. Different discovery surfaces may need different strategies

The same underlying evidence can support several surfaces, but each surface has a different purpose.

- **Search results:** prioritise the buyer's explicit query, exactness, eligibility and serviceability.
- **Category browsing:** balance category relevance, local supply, variety and discovery.
- **Recommended shops:** consider buyer preferences, shop relevance, service coverage and merchant evidence.
- **Related products:** prioritise product similarity and useful alternatives.
- **Personalised home feed:** combine current intent and longer-term preferences while avoiding repetitive content.
- **Restock or price alerts:** use saved buyer intent and explicit notification permission; do not treat these as ordinary feed ranking.

Do not force all surfaces into one undifferentiated feed or score.

## 11. Feedback, events and evidence quality

The engine depends on reliable event definitions. Each event should have a clear meaning, source and confidence level.

Potential event families:

- Search performed.
- Product impression.
- Product opened.
- Product saved or removed from saved list.
- Product compared.
- Shop followed or unfollowed.
- Buyer preference stated or corrected.
- Enquiry initiated.
- Merchant response recorded.
- Reservation requested or confirmed, if supported.
- Purchase reported or confirmed.
- Fulfilment outcome reported or confirmed.
- Product price or availability updated.
- Listing corrected or removed.
- Buyer recommendation feedback submitted.
- Complaint, investigation, appeal or resolution recorded.

For each event, define as appropriate:

- Actor and subject references.
- Event type and timestamp.
- Source channel.
- Whether the action was explicit or inferred.
- Evidence/provenance and confidence.
- Relevant product, shop and request references.
- Consent and privacy constraints.
- Correction, dispute or reversal status.

Do not create a new event store or duplicate merchant/product source of truth without first investigating the existing Mudaala schema and analytics. The design should reuse current identities and data foundations wherever practical.

## 12. Notifications are a separate decision

A recommendation appearing in a feed does not authorise a push notification, WhatsApp message, SMS or email.

Notifications need a separate test:

1. Is the information useful and timely?
2. Did the user request or permit this type of contact?
3. Is the channel permitted for this message?
4. Is the message non-duplicative and within frequency limits?
5. Can the user control or stop it?

Merchant notifications should follow intentional buyer actions directed to that merchant. Passive views, searches and private shortlists should not create merchant leads or alerts.

## 13. Explanations and transparency

The engine should be able to explain, in plain language, why a result is shown.

Examples, only when supported:

- “Matches the product you searched for.”
- “Available from a shop serving your area.”
- “Price was recently updated.”
- “You follow this shop.”
- “You have saved similar products.”
- “This merchant has buyer-confirmed purchases.”
- “This shop has a record of responding to enquiries.”

Do not expose confidential merchant records or private buyer activity. Do not use unsupported labels such as “AI approved”, “guaranteed”, or “100% trusted”.

The merchant should have a practical route to correct inaccurate source information and challenge material errors. Transparency does not require publishing exploitable ranking weights or fraud-detection rules.

## 14. Measurement and evaluation

The system should be evaluated against useful outcomes, not activity alone.

### Buyer outcomes

- Search-to-relevant-product discovery.
- Time to find a useful option.
- Exact-match and alternative-match usefulness.
- Product comparison and informed choice.
- Buyer-initiated qualified connections.
- Buyer feedback and satisfaction.
- Repeat discovery where it reflects genuine utility.

### Merchant and network outcomes

- Eligible merchant exposure distribution.
- Discovery opportunities for new and smaller merchants.
- Qualified enquiry rate.
- Merchant response and follow-through.
- Confirmed purchases and repeat purchases where evidence exists.
- Availability and price accuracy.
- Successful buyer–merchant connections.
- Merchant concentration and exposure inequality.

### Guardrail metrics

- Misleading or unavailable listings shown.
- Irrelevant recommendations and negative feedback.
- Duplicate or repetitive recommendations.
- Spam, complaints and notification opt-outs.
- Merchant response burden.
- Suspected manipulation or fabricated engagement.
- Privacy or consent incidents.
- Cost per useful discovery or connection.

Impressions, clicks, session duration and notification opens are diagnostic metrics. They are not the north star.

## 15. Experiments and change control

Every material ranking or personalisation change should have a documented hypothesis.

Before an experiment:

- State the user problem and intended outcome.
- Identify the affected buyer and merchant groups.
- Record the current baseline.
- Define success metrics and guardrails.
- Consider possible feedback loops and gaming.
- Decide how the experiment can be stopped or rolled back.

During and after an experiment:

- Compare against an appropriate baseline or control.
- Examine results by location, category, merchant size and tenure.
- Check whether exposure is becoming concentrated.
- Check whether clicks translate into useful connections and outcomes.
- Investigate adverse effects before expanding the change.
- Preserve an audit trail of material ranking changes.

Do not ship a ranking change solely because it increases clicks or time spent in the app.

## 16. Initial implementation philosophy

The first version should be deliberately simple.

A reasonable progression is:

**Stage A — Reliable discovery**
- Use the existing catalogue and merchant records.
- Apply eligibility rules.
- Improve query, category and local relevance.
- Respect price and availability freshness.
- Explain basic recommendation reasons.
- Establish event definitions and measurement.

**Stage B — Evidence-informed merchant evaluation**
- Use reliable listing quality and merchant information.
- Introduce carefully defined response and customer-outcome evidence.
- Incorporate substantiated commercial evidence where available.
- Monitor new-merchant exposure and concentration.

**Stage C — Buyer personalisation**
- Introduce explicit preferences and reliable behavioural signals.
- Add buyer controls and feedback.
- Measure whether personalisation improves useful discovery over the non-personalised baseline.

**Stage D — Controlled learning and optimisation**
- Test contextual ranking improvements.
- Add measured exploration.
- Consider more advanced statistical or machine-learning methods only when data quality, scale, evaluation and operational capacity justify them.

These stages are a proposed sequence, not a release commitment. Each stage requires investigation of existing Mudaala functionality and data before implementation.

## 17. Architecture constraints

The engine should be a modular capability within Mudaala's existing platform.

- Reuse the existing merchant identities and product catalogue.
- Reuse existing analytics/event infrastructure where suitable.
- Keep eligibility, candidate generation, ranking, personalisation and explanations logically separable.
- Keep ranking decisions observable and testable.
- Support sparse data and graceful fallback.
- Use feature flags and safe rollback for material changes.
- Avoid a duplicate merchant database, shadow catalogue or disconnected recommendation service.
- Do not introduce a dedicated machine-learning platform or microservices before demonstrated need.

The exact storage model, event schema, APIs and integration points must be determined by inspecting the current repository and database. This document does not assume those implementation details already exist.

## 18. Decisions intentionally left open

The following should be resolved through product research, data inspection and pilot evidence—not invented in this document:

- Which current Mudaala events and analytics can be reused?
- What evidence can reliably establish completed sales and fulfilment?
- Which buyer interactions are available today, and which need explicit controls?
- What are the initial eligibility rules for each product category?
- How should stale prices and availability affect specific discovery surfaces?
- What is a fair and measurable new-merchant exploration policy?
- What ranking explanations are understandable to buyers and merchants?
- What minimum sample size and guardrails are needed for experiments?
- Which recommendation surfaces should be prioritised first?
- What privacy, consent, retention and access controls are required for each event?

## 19. Recommended implementation stack

The recommendation engine should be implemented as a capability inside the existing Mudaala application. It should not begin as a separate service, database or independently deployed product.

### Application language and framework

- **TypeScript** is the primary implementation language for candidate retrieval orchestration, eligibility checks, contextual ranking, personalisation and API contracts.
- **Next.js App Router** remains the application and server-route framework.
- Use the existing project conventions, dependency versions, test runner and deployment configuration. Do not introduce a second framework merely for the recommendation engine.
- Keep core ranking functions deterministic, typed and independently testable. A ranking decision should be reproducible from its inputs and versioned rules.

Python or a dedicated machine-learning runtime is not required for the initial system. Reconsider another language only when a demonstrated workload—such as offline model training or large-scale feature processing—cannot be handled appropriately by the existing stack.

### Database and data access

- **Supabase PostgreSQL** remains the system of record.
- **Prisma**, using the repository's existing configuration, is the default typed application data-access layer.
- **Cloudflare Hyperdrive** remains the configured database connectivity layer for the deployed Worker where the current application uses it.
- Use SQL for database constraints, indexes, carefully reviewed queries, migrations and row-level security policies.
- Reuse existing merchant, shop, product, account and analytics records. Do not create shadow copies of the catalogue or merchant identity.
- Add recommendation-specific tables only after repository and schema inspection proves the data is not already represented.

The production database connection must use a dedicated least-privilege role appropriate to the application. Verify the actual role and grants used by Prisma through Hyperdrive before implementation. Do not assume that an application connection automatically carries the end user's Supabase identity into PostgreSQL.

### Data ownership boundaries

The engine may own recommendation-specific state such as explicit buyer preference records, recommendation experiment assignments or carefully defined impression/outcome events if equivalent records do not already exist.

It must not become the owner of:
- Merchant identity or account ownership.
- Shop and product source data.
- Product prices or stock truth.
- Authentication credentials or session state.
- Transaction truth that belongs to a separate verified transaction workflow.

Recommendation outputs are derived decisions, not a new source of truth for the underlying commerce records.

## 20. API route and service boundaries

All recommendation decisions that require trusted data or ranking logic must execute on the server.

The browser should call narrow, purpose-specific application routes. It must not connect directly to privileged database credentials or submit arbitrary ranking instructions.

Potential route responsibilities—not a commitment to create every endpoint—include:

- **Recommendation retrieval:** return a bounded set of eligible results for a defined surface and buyer context.
- **Interaction/event intake:** accept only recognised event types and validated references; derive the actor from the authenticated session or a controlled anonymous-session mechanism.
- **Preference management:** let a buyer read, change or reset their own personalisation preferences.
- **Merchant correction and evidence workflows:** allow authorised merchants to correct their own business or product information through existing product workflows.
- **Internal evaluation and administration:** restricted operational functions for monitoring experiments and diagnosing recommendation quality.

Keep route handlers thin. They should authenticate, validate, authorise, apply rate limits and call domain services. Ranking logic belongs in reusable server-side modules, not duplicated inside route handlers.

Do not create public endpoints for changing merchant trust, sales evidence, ranking weights, eligibility or recommendation outcomes.

## 21. API and route security requirements

Every route must apply the following controls according to its purpose:

1. **Authentication:** identify the caller using a verified server-side session or token. Never trust a user ID supplied in the request body as proof of identity.
2. **Object-level authorisation:** verify that the caller may access the specific buyer profile, shop, product, event or preference being requested. Being signed in is not sufficient.
3. **Input validation:** validate request bodies, query parameters, identifiers, enum values, lengths, pagination and payload sizes against explicit schemas.
4. **Allowlisted events:** accept only defined event types and permitted fields. Never allow clients to invent a purchase, fulfilment, trust or merchant-performance event.
5. **Rate and abuse controls:** apply per-account, per-session and appropriate IP-based limits. Protect event intake and expensive recommendation queries from automated abuse.
6. **Safe mutations:** use appropriate origin/CSRF protections for cookie-authenticated mutations, idempotency where retries could duplicate outcomes, and explicit confirmation for consequential actions.
7. **Output minimisation:** return only fields required by the client. Never expose private buyer histories, confidential merchant evidence, internal fraud signals, credentials or raw ranking features.
8. **Error discipline:** return safe, consistent errors without SQL, stack traces, tokens or private records.
9. **Auditability:** record security-sensitive administrative changes, evidence corrections and material ranking configuration changes.
10. **Operational controls:** use feature flags, monitoring and rollback for ranking changes; secrets remain in server-side environment bindings and secret stores.

Public catalogue discovery and private buyer personalisation are different access classes. Anonymous browsing may receive a safe, non-personalised result set; private preferences and histories require the appropriate authenticated or session-bound access.

## 22. PostgreSQL security and row-level access policies

Row-Level Security (RLS) is a database enforcement layer, not a replacement for application authorisation.

### Required database rules

- Enable RLS on every table exposed through Supabase's Data API.
- Review grants separately from RLS: a policy does not itself grant table access.
- Use explicit policies for each table and operation. Do not apply a generic policy to every table.
- Scope buyer preference and private interaction records to their actual owner.
- Scope merchant-managed records to the merchant/shop relationship verified by trusted database relationships, not a client-supplied shop ID alone.
- Keep internal ranking evidence, experiment configuration and administrative records inaccessible to public and ordinary buyer roles.
- Use restrictive grants and a least-privilege runtime database role.
- Review views, functions, triggers and storage policies as separate security surfaces.

For Supabase RLS policies:
- Target roles explicitly, such as `TO authenticated` or `TO anon`, as appropriate.
- Combine authentication with ownership or relationship predicates; `TO authenticated` alone is not authorisation.
- For updates, enforce both row visibility (`USING`) and the resulting row state (`WITH CHECK`).
- Do not use user-editable JWT user metadata for authorisation decisions.
- Treat views carefully because ordinary views can bypass RLS; use security-invoker views where supported and appropriate.
- Avoid `SECURITY DEFINER` functions as a shortcut around access errors. Any genuinely necessary privileged function requires restricted execution grants, a fixed safe search path, explicit authorisation checks and security review.

### Important Prisma and Hyperdrive qualification

Supabase's `auth.uid()` is available when a request reaches PostgreSQL with the appropriate Supabase user JWT context. A conventional Prisma connection through Hyperdrive using a database username/password does not automatically establish that per-user context.

Therefore, before relying on RLS for Prisma-originated user queries, inspect and prove the actual connection and transaction model. Do not assume that an RLS policy based on `auth.uid()` will work simply because the application user is signed in.

The initial safe design must combine:
- Verified application authentication.
- Explicit server-side object-level authorisation.
- A least-privilege database role.
- RLS for exposed Data API access and as database defence-in-depth where the connection context is correctly established.

If per-user RLS context is deliberately introduced for pooled connections, it must be transaction-scoped, set from verified server-side identity, and tested to prove that context cannot leak between pooled requests. Never set it from an untrusted request field.

### Secrets and credentials

- Never expose Supabase service-role or secret keys in browser bundles or `NEXT_PUBLIC_*` variables.
- Do not place database passwords in source code, logs, error messages or client responses.
- Rotate credentials if exposure is suspected.
- Keep local, preview and production credentials separated.
- Review privileges and revoke unused grants.

## 23. Database integrity and migration rules

Database rules should protect the meaning of commerce data, not just its shape.

- Use foreign keys for real relationships and appropriate unique constraints to prevent duplicate identities or duplicate event processing where applicable.
- Use check constraints for valid states and bounded values.
- Use indexes based on measured query patterns, including the access paths used by buyer, merchant, category and location queries.
- Use timestamps consistently and define how stale product information is treated.
- Make event ingestion idempotent where retries are possible.
- Preserve provenance and correction history for important commercial evidence.
- Do not let a browser write directly to authoritative sales, trust, fulfilment or ranking fields.
- Make schema changes through reviewed, version-controlled migrations with rollback considerations.
- Test migrations against a representative non-production database before production rollout.

Do not create tables or policies based solely on this conceptual document. Inspect the current Prisma schema, Supabase schema, existing migrations, grants, RLS policies and production connection role first.

## 24. Security and architecture verification gates

Before the engine is exposed to real users, verify at minimum:

- An anonymous buyer cannot read another buyer's preferences or history.
- An authenticated buyer cannot access or alter another buyer's records by changing an ID.
- A merchant can manage only shops and products they are authorised to manage.
- A merchant cannot manufacture confirmed sales, buyer feedback or trust evidence through event submission.
- Public clients cannot access service-role credentials or privileged database operations.
- RLS policies and table grants behave as intended through every enabled access path.
- Prisma/Hyperdrive connection context does not leak identity between pooled requests.
- Invalid, oversized, replayed and high-volume event submissions are handled safely.
- Recommendation responses do not expose private or internal evidence.
- Ranking and eligibility logic have automated tests for fairness, relevance and ineligible listings.
- Security advisors and relevant application tests are run after schema or policy changes.

A security test is not complete merely because a route returns HTTP 200. Verify both allowed and denied access paths.

## 19. Governing standard

Mudaala should recommend a product because it is relevant to the buyer and the listing is eligible. It should give merchants greater opportunity when reliable evidence shows that they serve demand well. It should learn a buyer's preferences from meaningful interactions without turning attention into the objective.

**The engine should reward usefulness, learn from evidence, preserve choice and remain fair to the next good shop that has not yet had a chance to prove itself.**
