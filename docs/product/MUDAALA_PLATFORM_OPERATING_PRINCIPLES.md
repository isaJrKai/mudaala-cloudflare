# Mudaala Platform Operating Principles
## How the platform discovers, ranks, recommends and connects commerce

**Status:** Working strategic principles — evolving, not implementation approval  
**Applies to:** Buyer discovery, merchant recommendations, ranking, personalisation, notifications, search, feeds, merchant visibility, trust signals, experimentation and future recommendation systems  
**Relationship:** Complements `MUDAALA_PRODUCT_CONSTITUTION.md`, `MUDAALA_COMMERCE_DISCOVERY_NETWORK.md` and the Merchant Trust Framework in the Product Constitution. The constitution establishes what Mudaala stands for; these operating principles describe how the platform should behave.

---

## 1. The platform exists to create useful commerce connections

Mudaala should help a buyer find relevant products and capable shops, make an informed choice and connect with the merchant they choose.

The platform should help good merchants become discoverable because they provide useful products and serve customers well—not merely because they are large, old, loud or already popular.

A recommendation is successful when it helps a person make progress towards a genuine need. More impressions, longer sessions and more clicks are not success by themselves.

## 2. Keep buyer personalisation and merchant ranking distinct

Mudaala has two related but different learning problems:

1. **Buyer personalisation:** learn what a particular buyer is looking for and which products, categories, locations, price ranges and shops may be relevant to that person.
2. **Merchant and product evaluation:** learn whether a merchant and a particular listing are relevant, accurate, reliable and capable of satisfying buyer demand.

Do not confuse a buyer's interests with a merchant's trustworthiness. A buyer interacting frequently should receive more relevant recommendations, not automatically more messages. A merchant making more sales may gain stronger commercial evidence, but sales alone do not prove trust or make every product relevant to every buyer.

## 3. Learn from meaningful buyer behaviour

The platform may use appropriate, disclosed and privacy-respecting signals to improve a buyer's recommendations, including:

- Search terms and stated needs.
- Categories and product types deliberately explored.
- Products opened, saved or compared.
- Shops deliberately followed.
- Enquiries or contact actions initiated by the buyer.
- Purchases or repeat purchases when adequately confirmed.
- Explicit feedback such as “not interested”, “show me less” or “this is relevant”.
- Buyer-selected location, delivery area, budget or other stated preferences.

Treat signals according to their meaning and reliability. An explicit preference or confirmed purchase is generally stronger evidence than an accidental view. A click is not proof of interest, an enquiry is not a purchase, and time spent on a screen is not automatically positive feedback.

Do not infer sensitive personal characteristics or use unrelated private information to personalise commerce recommendations.

## 4. Personalisation should improve relevance, not maximise attention

As a buyer meaningfully uses Mudaala, the platform should become better at understanding their needs. It may then surface a more relevant selection of shops and products.

The objective is not to keep pushing more content at the buyer. It is to reduce search effort and improve the quality of choices.

- Prefer relevance over volume.
- Respect explicit buyer preferences and exclusions.
- Allow buyers to reset, correct or shape personalisation.
- Avoid repetitive recommendations when useful alternatives exist.
- Do not interpret every interaction as permission for a notification.
- Do not create artificial urgency or exploit behavioural vulnerabilities.
- Do not optimise for endless scrolling, compulsive use or time-on-app as a primary goal.

A buyer who finds what they need quickly and leaves satisfied may represent a better outcome than a buyer who spends an hour browsing without progress.

## 5. Use sales as evidence, not as an automatic trust score

Completed sales can provide valuable evidence that a merchant's products meet demand. Repeat purchases and positive post-purchase outcomes can provide stronger evidence of continued relevance and customer satisfaction.

However, distinguish:
- Merchant-reported sales.
- Sales supported by merchant records.
- Buyer-confirmed purchases.
- Transactions recorded by Mudaala.
- Repeat purchases supported by reliable evidence.
- Fulfilment and customer outcomes that have been confirmed.

Do not treat product views, followers, clicks, enquiries or WhatsApp handoffs as completed sales.

More credible sales evidence may strengthen a merchant's commercial track record and, where relevant, increase the opportunity for eligible products to be recommended. It must not automatically override product relevance, listing accuracy, current availability, customer treatment, integrity or buyer choice.

A high sales count does not prove that every product is in stock, every customer was satisfied or the merchant is trustworthy in every respect.

## 6. Reward demonstrated merchant quality without locking out new shops

The recommendation system must avoid a self-reinforcing popularity loop in which already visible merchants receive nearly all exposure and new or smaller merchants never get a fair opportunity to demonstrate quality.

- Give eligible new merchants a reasonable path to discovery.
- Use controlled exploration to learn whether less-exposed relevant products serve buyers well.
- Evaluate smaller merchants on evidence appropriate to their category and stage.
- Do not equate follower count or sales volume with overall trust.
- Avoid letting historic popularity permanently dominate current relevance.
- Reassess products and merchants as evidence changes.
- Apply exposure limits where needed to prevent a small number of shops from monopolising discovery.

Exploration must remain relevant and safe. It is not a reason to recommend low-quality, misleading or ineligible listings.

## 7. Rank the product and the merchant in context

A recommendation should evaluate both the specific product listing and the merchant behind it.

Relevant considerations may include:
- Match to the buyer's stated need and intent.
- Product category, attributes, variant and suitability.
- Price clarity and affordability where known.
- Availability and freshness of confirmation.
- Buyer location and merchant service coverage.
- Delivery, pickup or collection practicality.
- Listing completeness and accuracy.
- Merchant legitimacy and integrity standing.
- Responsiveness and customer outcomes where reliably measured.
- Commercial evidence and repeat demand.
- Buyer feedback and prior interactions.

The relative importance of these factors may differ by query, category and context. A buyer asking for the cheapest available item has different priorities from a buyer asking for a particular brand, urgent delivery or a highly reliable supplier.

Do not use a single universal ranking formula for every shopping situation.

## 8. Local relevance is a first-class ranking consideration

For ordinary local shopping, prioritise merchants who can realistically serve the buyer's location.

Consider distance, service area, delivery capability, collection options, availability and the buyer's stated willingness to travel. Do not recommend a distant shop merely because it has more followers or sales.

A farther-away option may be appropriate when the buyer asks for a specialised product, broader search, delivery from elsewhere or a comparison beyond their immediate area. Make the reason clear.

Never invent a merchant's location, delivery coverage or ability to fulfil an order.

## 9. Preserve choice and useful variety

Recommendations should help buyers compare meaningful alternatives rather than force a single result.

- Present multiple relevant merchants when supply allows.
- Explain meaningful differences such as price, location, availability, delivery and trust evidence.
- Avoid showing near-identical listings repeatedly when distinct alternatives exist.
- Do not hide a relevant eligible merchant solely because it is less popular.
- Let buyers sort, filter, compare and choose.
- Keep paid placements clearly labelled and separate from organic relevance.
- Never imply that a recommendation is an endorsement or guarantee.

The buyer remains the decision-maker. Mudaala is a discovery and connection layer, not an authority that chooses the merchant on the buyer's behalf.

## 10. Keep trust, relevance, popularity and promotion separate

These are different concepts and should be represented separately in data, ranking logic and buyer-facing explanations:

- **Trust:** evidence of legitimacy, reliability, customer treatment and integrity.
- **Relevance:** how well the product and merchant fit this buyer's current need.
- **Popularity:** observed audience interest or demand, with its evidence limitations.
- **Commercial performance:** credible completed sales and repeat business.
- **Promotion:** paid or otherwise sponsored visibility.

A popular product can be irrelevant to a particular buyer. A trusted shop may not sell the requested product. A promoted listing is not necessarily the best match. A merchant with strong sales may still have an inaccurate or unavailable listing.

Do not collapse these into one unexplained “best” score.

## 11. Distinguish recommendations from notifications

Showing a product in a feed or search result is not permission to send a push notification, WhatsApp message, SMS or email.

- Use in-app recommendations when the buyer is actively discovering.
- Send notifications only when there is a clear user benefit and the required permission.
- Respect channel preferences, frequency limits, quiet periods and opt-outs.
- Avoid sending repetitive alerts for the same product or opportunity.
- Do not treat app engagement as blanket consent to contact the buyer.
- Merchant notifications should be tied to intentional buyer actions directed to that merchant, not passive views or private shortlists.

Personalisation should make the experience more useful, not more intrusive.

## 12. Use feedback as a correction mechanism

Buyers should be able to indicate when recommendations are irrelevant, repetitive, inaccurate or unwanted. Merchants should be able to correct product and business information and challenge material errors in their assessments.

Use feedback carefully:
- Distinguish explicit feedback from inferred behaviour.
- Prevent a small number of abusive or coordinated actions from unfairly suppressing a merchant.
- Investigate patterns rather than treating every report as established fact.
- Record corrections and appeal outcomes.
- Do not retaliate against buyers or merchants for legitimate feedback.
- Give users practical controls over personalisation.

## 13. Make recommendations explainable

Mudaala should be able to give a concise, truthful explanation for why a product or shop appears.

Possible explanations include:
- Matches the product or category you searched for.
- Serves your selected area.
- Price or availability was recently confirmed.
- You follow this shop or have chosen similar products.
- Buyers have confirmed purchases from this merchant.
- The merchant has a demonstrated record of responding to enquiries.

Only display explanations supported by evidence. Do not expose private buyer activity or confidential merchant information. Do not use vague labels such as “AI approved” or “100% trusted”.

## 14. Protect privacy and use data proportionately

Collect and retain only the information needed to provide, evaluate and improve the commerce experience.

- Be clear about the data used for personalisation.
- Respect applicable consent, privacy and communication requirements.
- Do not sell personal buyer behaviour as a condition of discovery.
- Do not expose private searches, saved lists or buyer identities to merchants without an intentional action and appropriate permission.
- Apply access controls and retention limits to merchant evidence and transaction records.
- Avoid sensitive-trait inference and unrelated profiling.
- Provide practical ways to manage preferences and request correction.

## 15. Measure outcomes, not engagement for its own sake

Evaluate recommendation quality using outcomes such as:
- Relevant search-to-product discovery.
- Useful product comparisons.
- Buyer-initiated qualified connections.
- Merchant response and follow-through.
- Confirmed purchases and repeat purchases where evidence exists.
- Product accuracy and availability freshness.
- Buyer satisfaction and recommendation usefulness.
- Fair exposure and discovery opportunities for eligible merchants.
- Complaint, mismatch and misleading-listing rates.
- Cost per useful connection and sustainable operating cost.

Track impressions, clicks, follows, session length and notification opens as diagnostic signals, not as the definition of success.

A recommendation system that increases clicks but also increases irrelevant enquiries, buyer frustration or merchant burden is not an improvement.

## 16. Test changes carefully and watch for feedback loops

Recommendation logic should evolve through controlled, measurable experiments.

Before expanding a ranking change:
- State the hypothesis and intended user outcome.
- Identify who may benefit and who may be disadvantaged.
- Define guardrails for trust, relevance, fairness, privacy and cost.
- Compare outcomes against a suitable baseline.
- Examine differences across locations, categories, merchant sizes and new versus established shops.
- Check for manipulation, gaming and unintended feedback loops.
- Keep a way to roll back or disable the change.

Do not silently deploy material ranking changes based only on a rise in clicks or engagement.

## 17. Keep the system honest under uncertainty

Product and merchant data can be incomplete, stale, disputed or unavailable.

- Show uncertainty rather than inventing certainty.
- Reduce confidence when availability or price has not been confirmed recently.
- Do not recommend a listing that fails basic eligibility or safety requirements.
- Provide useful alternatives when no exact match exists.
- Distinguish exact matches from similar alternatives.
- Do not claim stock, delivery, quality, reservation or purchase confirmation without evidence.
- Fall back gracefully when personalisation data is sparse or unavailable.

## 18. Start simple, learn, then add complexity

The first recommendation system does not need a sophisticated machine-learning model.

Start with understandable rules using reliable catalogue data, buyer intent, local relevance, availability, merchant eligibility and evidence-backed trust. Introduce more advanced personalisation or ranking only when there is enough high-quality data, a clear improvement over simpler methods and the capacity to monitor it.

Keep the system modular, measurable, reversible and consistent with Mudaala's existing merchant identities, product catalogue and platform architecture. Do not create duplicate merchant profiles, shadow catalogues or disconnected recommendation databases.

---

## Governing principles

1. **More meaningful buyer interaction should improve relevance, not maximise attention.**
2. **More credible completed sales can strengthen commercial evidence, but cannot buy trust or override customer outcomes.**
3. **More exposure should be earned through relevance and demonstrated quality, not popularity alone.**
4. **New and smaller eligible merchants must have a fair path to discovery.**
5. **The product listing must qualify in its own right; merchant reputation cannot make inaccurate stock or misleading information recommendable.**
6. **Recommendations should preserve buyer choice and explain meaningful reasons.**
7. **Notifications require their own user-benefit and permission test.**
8. **The algorithm must be measurable, explainable, fair, privacy-respecting and reversible.**

**The goal is not to make people use Mudaala more. The goal is to make every useful interaction teach Mudaala how to connect people with better commerce.**
