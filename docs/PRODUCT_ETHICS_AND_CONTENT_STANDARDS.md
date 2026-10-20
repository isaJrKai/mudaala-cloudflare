# Mudaala Product Ethics & Content Standards

**Status:** Proposed for review in PR; implementation is field-specific and enforced at the shared validation boundary.
**Scope:** All Mudaala product surfaces, marketplace content, business profiles, seller tools, system messages, and moderation decisions.
**Product promise:** Professional, elegant, trustworthy, fair, and accessible commerce.

## 1. Principles

1. **Trust over hype.** No fabricated reviews, activity, sales counts, verification badges, scarcity, or guarantees.
2. **Premium, not pretentious.** Calm layouts, consistent typography and icons, concise language, and careful spacing. Never equate premium presentation with a seller's wealth, English fluency, or price point.
3. **Dignity and fairness.** Apply the same rules to equivalent cases, explain rejections in plain language, and provide a practical correction path.
4. **Clarity over manipulation.** Prices, units, conditions, fees, discounts, and consent must be clear. No dark patterns or fake urgency.
5. **Privacy by design.** Collect only necessary data, disclose its purpose, restrict access, and avoid exposing private contact or location details.
6. **Accessible by default.** Readable contrast and text, keyboard/screen-reader-friendly controls, low-bandwidth consideration, and language that does not shame users.
7. **Local relevance.** Use familiar Ugandan commerce terms and UGX where appropriate. Make quantity units explicit (per bottle, cup, piece, slice, plate, pack, dozen, kilogram, or batch) where a price otherwise could be ambiguous.

## 2. Emoji and symbol policy by field

Emoji are not globally banned; their use depends on the field's purpose.

| Surface / field | Rule | Reason |
| --- | --- | --- |
| Shop/business name | **Reject emoji** | A stable, searchable business identity |
| Listing/product title | **Reject emoji** | Searchability, scanability, and professional product naming |
| Listing description | **Reject emoji** | Consistent, accessible, information-first marketplace copy |
| Navigation, buttons, system status | **Use approved interface icons** | Consistent icon family, sizing, meaning, and accessibility labels |
| Category and verification badges | **Use controlled icons and labels** | No arbitrary emoji; never imply verification without evidence |
| Private buyer-seller messages | **Allow** | Natural conversation, subject to conduct, spam, and safety rules |
| Support messages | **Use sparingly** | Warmth is acceptable; clarity and professionalism take priority |
| User-generated photo/image | **Allow relevant imagery** | Images are content; moderate them under image and listing policies |

### Validation rules

- Reject emoji at the API/server validation boundary as well as in forms; client-only validation is insufficient.
- Use Unicode-aware detection that covers presentation emoji, emoji variation sequences, paired regional-indicator flags, and keycap sequences.
- Do not silently strip emoji from a new submission: show a respectful field-specific error and preserve the user's other input so they can correct it.
- Do not reject ordinary punctuation such as apostrophes, ampersands, hyphens, commas, periods, or parentheses merely because it is punctuation.
- Do not automatically rewrite or delete existing seller content in bulk. Audit first, preserve the full original value for review, and make only explicitly authorized, narrow corrections.
- Never use a simplistic ASCII-only allowlist for names: genuine local names, accented letters, and legitimate spelling must remain possible.

Suggested messages:
- Business name: "Remove emojis from your shop name. Use your business name as you want customers to find it."
- Listing title: "Remove emojis from the product title so buyers can find it easily."
- Listing description: "Please remove emojis from the description and keep the product details in words."

## 3. Marketplace diction and voice

Mudaala speaks in clear, composed, respectful, direct language. It is warm without forced excitement, concise without being abrupt, and honest about what it knows.

- Prefer **"Shop", "Product", "Listing", "Price", "Contact seller", "Save changes"** consistently. Do not switch between "post", "ad", "item", and "product" for the same concept without a product reason.
- Error messages state what happened and the next action.
- Avoid excessive capitals, multiple exclamation marks, emoji decoration, slang in system messages, shaming, or jokes at a user's expense.
- Never label a seller "trusted", "safe", or "verified" without a defined, evidenced process.
- State uncertainty honestly; do not promise a guaranteed outcome when Mudaala cannot guarantee it.
- Do not use "free" if later fees or material conditions apply. Show actual terms and prices clearly.
- Use plain English and preserve meaningful local product names and terms.

Examples:
- Instead of "Oopsie! Something went wrong 😭": "We couldn't save your changes. Please try again."
- Instead of "HURRY!!! BEST DEAL 🔥": use a factual title and accurate price.
- Instead of "You entered a bad name": "Remove emojis from your shop name, then try again."

## 4. Content and integrity rules

- **Names:** no emoji, control characters, impersonation, or deceptive claims. Preserve legitimate business identity.
- **Titles:** descriptive, factual, and useful for search; no emoji decoration, keyword stuffing, repeated punctuation, or unsupported claims.
- **Descriptions:** relevant and honest. Do not claim authenticity, condition, safety, warranty, availability, or outcomes without evidence.
- **Prices:** show currency and applicable unit; discounts must compare against a genuine previous/reference price. Explain negotiable prices accurately.
- **Images:** prefer genuine, relevant images; never imply a photo proves ownership, authenticity, or quality on its own.
- **Badges and metrics:** never fabricate verification, reviews, stock, sales, or engagement.
- **Moderation:** proportionate, consistent, explainable, and appealable where applicable.
- **Safety and privacy:** protect private information; do not expose precise location or personal details beyond the feature's intended purpose.
- **Fairness:** do not penalize users for local naming conventions, limited literacy, or low-cost products when the content otherwise follows the rules.

## 5. Enforcement architecture

1. Keep reusable rules in the shared validation module; forms and APIs must use the same schemas.
2. Validate on the server even if the browser also validates.
3. Add automated cases for emoji presentation forms, flags, keycaps, Unicode names, ordinary punctuation, whitespace, and overlong content.
4. Audit existing records read-only before remediation. Preserve accounts, listings, photos, shop codes, and relationships.
5. For an existing violation, change only the specific offending characters when explicitly authorized; do not rename or delete the whole business profile.
6. Verify CI, API rejection behavior, existing data integrity, and production behavior before closing a rollout.
7. Do not broaden a content-policy change into unrelated storefront redesign or other frozen workstreams.

## 6. Rollout checklist

- [ ] Review and merge the standards document and shared validation changes.
- [ ] Add/confirm automated tests for accepted punctuation and rejected emoji forms.
- [ ] Run the repository's required validation workflows.
- [ ] Review existing business/listing content read-only and report candidate records.
- [ ] Apply only founder-authorized narrow cleanup; confirm the business name and photo remain otherwise unchanged.
- [ ] Deploy through the established gated process and verify live API/form behavior.
- [ ] Keep this document as the canonical content-policy source; update it when policy changes.
