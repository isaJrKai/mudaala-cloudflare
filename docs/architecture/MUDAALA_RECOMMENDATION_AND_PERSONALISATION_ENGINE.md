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

## 19. Governing standard

Mudaala should recommend a product because it is relevant to the buyer and the listing is eligible. It should give merchants greater opportunity when reliable evidence shows that they serve demand well. It should learn a buyer's preferences from meaningful interactions without turning attention into the objective.

**The engine should reward usefulness, learn from evidence, preserve choice and remain fair to the next good shop that has not yet had a chance to prove itself.**
