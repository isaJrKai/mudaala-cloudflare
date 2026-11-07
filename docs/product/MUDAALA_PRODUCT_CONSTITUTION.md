# Mudaala Product Constitution
## The principles and decision discipline that govern what we build

**Status:** Foundational product guidance  
**Applies to:** Product strategy, design, engineering, AI, merchant acquisition, distribution, partnerships and monetisation  
**Relationship:** Complements `docs/vision/MUDAALA_COMMERCE_DISCOVERY_NETWORK.md`. The vision describes what Mudaala may become; this constitution governs how we decide what belongs in Mudaala and how we pursue it.

---

## 1. Our purpose

Mudaala exists to make commerce easier to discover and connect: helping buyers find relevant products and trustworthy shops, and helping merchants become discoverable and connect with genuine demand.

We are building a commerce connection network rooted in real shops, products, people and places.

**Nothing enters Mudaala merely because it is technically possible. It enters because it creates a clearly defined improvement in commerce.**

This is a decision standard, not a slogan. It applies equally to a small interface change and a major AI or network initiative.

## 2. Start with the problem and intended outcome

Do not begin a proposal with a technology, screen or feature.

Every meaningful initiative must first explain:

1. **Who:** Which buyer, merchant, supplier or operator has the problem?
2. **Need:** What are they trying to accomplish?
3. **Friction:** What prevents them from doing it today?
4. **Outcome:** What should become easier, faster, safer or more reliable?
5. **Evidence:** What observation, user feedback or data supports the problem?
6. **Measurement:** What observable result would demonstrate improvement?

Describe the user journey and desired outcome before selecting a feature or technology.

Example:

- Weak: “Add AI product discovery.”
- Strong: “Help a buyer in Kampala find a particular product from relevant nearby shops, compare exact matches and alternatives, and contact the shop they choose without searching across multiple social pages.”

AI is a means, not a product outcome. Use it only where it improves the experience measurably over simpler methods.

## 3. Preserve the identity and boundaries of Mudaala

The following are durable product boundaries:

- Mudaala is a commerce discovery and connection network, not an AI marketplace.
- It is not checkout-first; buyers and merchants may arrange transactions directly.
- It is not a collection of disconnected channel-specific shops.
- It does not maintain duplicate merchant identities or parallel product catalogues.
- It does not treat views, searches, clicks or private shortlists as sales or qualified leads.
- It does not sacrifice buyer choice, merchant fairness, privacy or truthful information for growth.
- It does not build broad ERP functionality unrelated to its commerce connection purpose.

Extend the existing platform and interfaces where possible. Do not replace working systems or introduce a new interface, database, service or workflow without a demonstrated need.

## 4. Make ambition large and execution deliberate

Maintain a clear distinction between long-term direction and immediate commitments.

Classify initiatives as:

- **Foundation:** capabilities required by multiple journeys or modules.
- **Immediate:** the smallest valuable work that can be built and validated now.
- **Next:** valuable work dependent on evidence or capabilities from earlier stages.
- **Later:** opportunities that need new permissions, economics, scale or proof.

A strategic vision is not an implementation backlog. Recording an idea does not authorise its implementation.

Prefer a narrow, complete, working journey over many partially working channels or features. Expand only when the current stage demonstrates value and can be operated reliably.

## 5. Design complete journeys, not isolated features

A feature is not complete because its screen exists or its code compiles.

For each important journey, consider the full path:

1. User starts with a real need.
2. Mudaala understands the request and its constraints.
3. Relevant options or actions are presented.
4. The user can make an informed choice.
5. The intended action is completed.
6. The other party receives the correct information at the correct time.
7. The outcome can be understood, corrected and measured.

Include failure and edge cases: no match, stale information, unavailable stock, delayed response, incorrect location, poor connectivity, duplicate messages, denied permissions and user cancellation.

Do not declare a journey complete until its meaningful end-to-end behaviour has been tested.

## 6. Use decision gates for substantial work

Before approving a significant feature, integration or architectural change, answer:

### Necessity
Does this solve a real problem that matters to Mudaala's users?

### Strategic fit
Does it strengthen Mudaala's purpose and respect its boundaries?

### Evidence
What supports the need? What remains an assumption, and how can we test it cheaply?

### Feasibility
Can we build, operate, support and maintain it with our actual capacity?

### Economics
What are the development, provider, infrastructure, support and per-use costs? Who might pay, and why?

### Consequences
What could go wrong for buyers, merchants, partners, the platform or our reputation? What safeguards are required?

### Reversibility
Can we pilot it behind a feature flag, limit exposure, measure it and switch it off safely?

If important answers are unknown, do not disguise uncertainty as a decision. Design a small experiment or record the unresolved question.

This is a lightweight discipline, not a requirement to write a lengthy proposal for every minor change.

## 7. Protect trust in every interaction

Trust is part of product functionality.

- **Buyer autonomy:** Mudaala recommends; the buyer chooses.
- **Merchant fairness:** ranking and distribution should be explainable; paid placements must be labelled.
- **Qualified notifications:** browsing and private comparison do not notify merchants. An intentional buyer action directed to a merchant does.
- **Truthfulness:** never invent or silently imply stock, prices, availability, supplier status, reservations or completed transactions.
- **Local relevance:** prioritise shops that are genuinely relevant to the buyer's location and service needs.
- **Privacy:** protect buyer identity, shortlists, requests and communication permissions.
- **Consent:** do not contact buyers or merchants through a channel without the required permission.
- **Attribution:** distinguish Mudaala merchants, external suppliers and promoted content.
- **Recovery:** provide ways to correct stale or incorrect information and report abuse.

A merchant should receive an opportunity notification because a buyer intentionally contacted that merchant—not because the buyer merely viewed, searched, compared or privately shortlisted.

An enquiry is not a reservation. A reservation is not a purchase. A click is not evidence of a sale.

## 8. Treat data quality as a product capability

Discovery quality cannot exceed the quality of the underlying supply information.

Prioritise accurate and maintainable:
- Product names, descriptions, categories and images.
- Prices and wholesale price distinctions.
- Availability and last-confirmed timestamps.
- Merchant identity and verification state.
- Location, service area, pickup and delivery information.
- Product variants, quantities and minimum order requirements where relevant.

Make uncertainty visible. Do not give stale or unverified data the appearance of certainty.

Verification should be progressive and proportionate. Clearly distinguish what has been checked—such as phone control, shop details, address or transaction history—rather than using a vague universal “verified” label.

## 9. Build for the market we serve

Mudaala must work for real operating conditions, not only ideal broadband and fluent typed English.

Design and validate for:
- Low-end devices, slow or intermittent data and modest bandwidth.
- Short, understandable interactions for busy shop owners.
- English, Luganda, Swahili and natural code-switching as demand and quality allow.
- Voice notes and image-led product requests where they provide practical value.
- Clear fallback paths when AI or a platform integration cannot understand or complete a request.
- Buyers who need basic discovery without creating an account.
- Merchants who may need assisted onboarding and simple product updates.

Do not claim language or voice capability is supported until it has been tested with real local usage.

## 10. Prove liquidity before expanding the network

A network is useful only when meaningful demand can meet relevant supply.

Do not assume that launching more categories, channels or AI features automatically creates liquidity.

Choose pilots based on evidence:
- Existing merchant and product coverage.
- Real buyer demand and unmet needs.
- Product comparability and availability of useful information.
- Merchant responsiveness.
- Local density and service coverage.
- Repeat purchase or replenishment behaviour.
- Cost of acquiring and serving both sides.

Start with inbound buyer demand and existing Mudaala supply where possible. Treat broad external social listening and proactive demand discovery as later-stage capabilities dependent on official platform access, permission, economics and demonstrated value.

Do not make the initial network dependent on scraping or unauthorised access.

## 11. Make economics visible early

A feature that creates value but costs more to operate than the business can sustain is not yet a viable product capability.

Track, where relevant:
- Cost to acquire and onboard a merchant.
- Cost to acquire or serve a buyer request.
- Cost per useful match and qualified connection.
- Messaging, model, image-processing and provider costs.
- Human review and customer-support effort.
- Merchant response and fulfilment rates.
- Potential willingness to pay and the party receiving the value.

Keep buyer discovery useful and accessible. Test merchant-side monetisation hypotheses carefully; do not let monetisation undermine relevance, fairness or trust. Do not introduce paid ranking that quietly overrides the buyer's interests.

## 12. Measure outcomes, not busyness

Distinguish activity from value.

| Activity | More meaningful outcome |
|---|---|
| Product views | Relevant product discovery |
| Shop visits | Useful buyer–merchant connections |
| Search volume | Searches resulting in useful local options |
| WhatsApp clicks | Merchant responses and meaningful conversations |
| Merchant registrations | Active merchants with useful, maintained catalogues |
| AI responses | Accurate and helpful recommendations |
| Enquiries | Confirmations and reported fulfilment, where known |

Use metrics with honest definitions. Separate observed events from reported outcomes and inferred estimates. Do not claim a sale or fulfilled order without evidence.

Every initiative should have a small number of success measures and explicit reasons to continue, change, pause or stop.

## 13. Engineering discipline: investigate, fix, deploy, verify

Engineering work should follow a consistent sequence:

1. **Investigate:** inspect the existing implementation, data model, interfaces, dependencies and failure evidence.
2. **Define:** state the intended behaviour, scope, constraints and acceptance criteria.
3. **Design:** reuse existing components and architecture where appropriate; document material trade-offs.
4. **Implement:** make the smallest coherent change that achieves the outcome.
5. **Test:** cover relevant unit, integration, security, accessibility, performance and end-to-end behaviour.
6. **Deploy:** use the established release process and avoid unrelated changes.
7. **Verify:** inspect the deployed experience and real behaviour; provide evidence.
8. **Evaluate:** compare results with the intended outcome and decide what follows.

Do not confuse a successful build, merged pull request or green CI run with proof that the user journey works in production.

Avoid speculative rewrites, duplicate interfaces, unnecessary dependencies, premature microservices and decorative functionality. Every button, metric, map, AI output and integration must do what the interface promises.

## 14. Keep the process deliberate, not bureaucratic

The level of process should match the risk and scope.

- Small, reversible UI fixes need concise acceptance criteria and appropriate tests.
- User-facing flows need journey-level validation.
- Payments, identity, privacy, messaging, external integrations and data migrations need explicit risk review and rollback plans.
- Major strategic initiatives need evidence, economics, sequencing and a clear owner.

The goal is thoughtful speed: fewer accidental decisions, less rework and more reliable progress—not paperwork for its own sake.

## 15. The operating cycle

Use this cycle for substantial initiatives:

**Understand → Define → Design → Implement → Verify → Evaluate → Decide**

At the final step, choose deliberately:
- **Improve** when the problem is real but the solution is incomplete.
- **Expand** when the journey works and evidence justifies more reach.
- **Pause** when a dependency, permission or economic assumption is unresolved.
- **Stop** when the problem is not important, the solution does not work or the costs and consequences are unjustified.

Record important decisions and the reasoning behind them so future work does not repeatedly reopen settled questions.


## 16. Establish merchant trust through evidence

Merchant trust is a continuously earned, evidence-based understanding of a business's legitimacy, operating discipline, customer conduct, commercial activity and integrity.

It is not a one-time badge, a popularity contest or a single opaque score. It helps Mudaala determine which merchants and individual products are eligible for recommendations, and helps buyers understand the evidence behind those recommendations.

### 16.1 What merchant trust must establish

Assess merchants across six distinct dimensions:

1. **Business legitimacy:** Is this a genuine business or identifiable business operator? Consider consistent business identity, reachable contact details, physical location where applicable, declared delivery or service area, genuine products or services, category fit and evidence that the person controls or is authorised to represent the business. Do not make formal company registration or a public physical storefront compulsory for every small or informal trader.
2. **Product and catalogue discipline:** Are product photographs genuine and useful? Are names, descriptions, specifications, variants and prices meaningful? Is quotation-based pricing clearly stated? Are availability, stock changes and corrections maintained? Reward catalogue accuracy and maintenance, not raw listing volume.
3. **Mudaala commitment and engagement:** Does the merchant meaningfully maintain its shop? Consider publishing genuine products, updating prices and availability, correcting errors, responding to enquiries, maintaining contact details, reviewing useful analytics and returning to keep the catalogue current. Measure meaningful actions and consistency, not logins, screen views or superficial activity.
4. **Customer treatment and service reliability:** Does the merchant respond to genuine enquiries, provide accurate information, honour quoted prices, communicate stock changes, follow through on commitments and handle delivery, collection and complaints responsibly? Consider credible feedback and repeat customers. Distinguish enquiry experiences from completed purchases.
5. **Commercial track record:** Is there credible evidence of actual trading? Consider the duration, frequency and recency of completed sales, repeat customers, revenue evidence and consistency appropriate to the business category and business model. Do not impose one universal revenue target across dissimilar businesses.
6. **Platform integrity and conduct:** Does the merchant avoid misleading listings, impersonation, duplicate shops, fabricated sales or reviews, artificial engagement, manipulated prices or locations, misuse of customer information and attempts to manipulate recommendations? Consider how the merchant responds to warnings and corrects genuine mistakes. Serious deliberate misconduct may disqualify a merchant regardless of popularity or sales.

Business legitimacy and platform integrity are foundational safeguards. Strength in one dimension must not compensate for serious failure in another. In particular, popularity or sales volume must never offset deception or serious customer harm.

### 16.2 Keep different trust signals separate

Do not collapse the following into one score:

- **Audience:** genuine followers and meaningful interest in a shop or its products.
- **Operational reliability:** catalogue accuracy, availability freshness, responsiveness and follow-through.
- **Commercial performance:** substantiated completed transactions, revenue evidence and repeat business.
- **Trust and integrity:** business legitimacy, honest conduct, customer outcomes and policy compliance.

A popular merchant is not automatically reliable. A merchant with modest sales may still serve customers exceptionally well. A merchant's audience, activity and commercial performance should be represented accurately and separately.

### 16.3 Treat the 21-day and 100-follower milestone as a provisional Emerging route

A proposed route to **Emerging Merchant** recognition is:

- At least 21 days of Mudaala presence.
- At least 100 genuine Mudaala shop followers.
- An established, reachable business identity.
- Eligible published products.
- Meaningful shop-management activity during the qualifying period.
- No serious unresolved integrity concerns.
- Reasonable safeguards against purchased, automated, duplicate or otherwise artificial followers.

These thresholds are hypotheses to validate with real merchant and buyer data, not permanent universal rules. Twenty-one days demonstrates a period of presence; 100 followers indicates audience interest. Neither proves sales, service quality or trustworthiness.

This milestone must not prevent a new or smaller merchant from appearing in ordinary relevant discovery or earning recognition through other evidence. A merchant with fewer followers may demonstrate strong reliability or commercial activity. Do not make follower count a substitute for the six-dimensional assessment.

### 16.4 Use transparent merchant recognition states

The proposed recognition vocabulary is:

- **Listed:** has an active Mudaala shop and eligible published products. This indicates platform presence, not endorsement.
- **Established:** has demonstrated a credible business identity, reachable contact details and meaningful operating activity.
- **Emerging:** has demonstrated audience interest and meaningful Mudaala engagement; the proposed 21-day and 100-follower route is one qualification path.
- **Trading:** has credible evidence of completed commercial activity.
- **Proven:** has a sustained, substantiated trading record and positive customer outcomes.
- **Trusted:** has strong evidence across all six dimensions, including responsible conduct and sustained reliability.

These are recognition states, not necessarily a rigid progression. Merchants may demonstrate commercial activity before reaching an audience milestone. Explain what each state establishes and what it does not guarantee. Recognition is subject to ongoing review and must not imply a guarantee of authenticity, stock, fulfilment or transaction outcome.

### 16.5 Assess merchant and product eligibility separately

A merchant's overall standing does not automatically make every listing recommendable.

**Merchant-level checks** should consider business identity, reachable contact and operating information, good standing and the absence of disqualifying integrity concerns.

**Product-level checks** should consider genuine representation, useful photographs and descriptions, clear pricing or quotation status, sufficiently recent or explicitly unconfirmed availability, understandable location and delivery or collection details, and the absence of misleading or restricted content.

A shop without eligible published products is not eligible for product recommendations. A merchant may remain listed while an individual product is corrected, marked unavailable or temporarily excluded from recommendations.

### 16.6 Maintain an explainable evidence history

Where the platform has a legitimate basis to observe or collect an event, maintain a proportionate, time-stamped merchant evidence history. Relevant events may include:

- Product created, updated or removed.
- Price or availability confirmed or changed.
- Enquiry received and response recorded, where the interaction is observable.
- Buyer-confirmed purchase or platform-recorded transaction.
- Complaint submitted, investigated and resolved.
- Verification completed, expired or challenged.
- Merchant correction, appeal or review outcome.

For each material assessment, retain the evidence source, date, confidence or verification level, relevant time window and any correction or dispute. Distinguish platform-observed events, independently confirmed evidence, merchant-provided records and unverified merchant claims.

Do not infer a completed sale from a view, click, follower, enquiry or WhatsApp handoff. Do not claim a verified purchase unless there is adequate evidence. Collect only information needed for the assessment, protect private merchant and buyer records, and show buyers concise explanations rather than confidential documents or private revenue data.

### 16.7 Make assessments fair, contextual and reviewable

- Measure meaningful behaviour over relevant periods; account for seasonality, business category, transaction frequency, connectivity and business model.
- Do not penalise a merchant solely for having fewer followers, fewer enquiries or lower revenue.
- Exclude spam, duplicate and invalid enquiries from responsiveness measures where they can be identified reliably.
- Distinguish deliberate deception from ordinary mistakes that are promptly corrected.
- Use evidence proportionate to the claim being made.
- Tell merchants what is assessed and how they can improve.
- Provide a way to correct inaccurate records and appeal material decisions.
- Reassess trust over time; do not let old positive activity permanently outweigh recent serious problems.
- Never sell trust status or allow payment to buy a higher trust assessment.

### 16.8 Apply trust to recommendations

Mudaala should recommend only shops that exist on Mudaala and have eligible published products. Recommendation eligibility should consider the specific product, buyer relevance, location or service coverage, price clarity, availability freshness, merchant standing and evidence-backed trust signals.

Recommendation ranking must not equate popularity with reliability or let paid placement silently override relevance and buyer interests. Explain meaningful trust signals to buyers and preserve their freedom to compare and choose.

**Governing principle:** Mudaala should not recommend a shop simply because it is popular. It should recommend a shop because there is sufficient, relevant evidence that the business and the specific product listing can reasonably serve the buyer's need.


---

## The standard

Before Mudaala builds something, we should be able to explain:

- Whose problem it solves.
- Why that problem matters.
- How it advances Mudaala's purpose.
- How the complete journey should work.
- What it depends on and what it must not compromise.
- What it costs and what could go wrong.
- How we will test it.
- What evidence will determine the next decision.

**Our ambition determines how far Mudaala can go. Our deliberateness determines whether we get there with trust, focus and sound judgement.**
