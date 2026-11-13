# Guest Buyers and Google-Authenticated Sellers

**Status:** Approved product direction; implementation pending security review  
**Branch:** `feat/google-sign-in-security`

## Product decision

Mudaala is public by default for buyers and identity-gated for sellers.

### Buyers
- Anyone can browse shops and products without registering or signing in.
- A buyer can contact a seller and complete a purchase directly with that seller without a Google account.
- Do not force a Google prompt at checkout, on a product page, or before displaying public seller contact/payment instructions.
- Only ask a buyer to create an account for an optional feature that genuinely needs persistent identity (for example, saved searches or following shops). These features must not block buying.
- Guest purchase/contact flows must use abuse controls that do not depend on a buyer account: rate limits, spam controls, safe contact links, and privacy-conscious telemetry.

### Sellers
- A person must authenticate with Google before creating or managing a shop.
- Verify Google's ID token on the server. Use Google's immutable `sub` as the external identity key; never trust a client-supplied email or user ID.
- Require verified Google email, validate signature, issuer, audience, expiry, nonce and CSRF/state. Protect callback/token exchange against replay.
- Google authentication proves control of the Google account at sign-in; it does not prove legal identity, business legitimacy, phone ownership, product authenticity, or payment receipt.
- Collect a seller's public contact phone when required to publish a shop/listing, but mark it self-reported unless a separate phone challenge is completed. Do not call it verified merely because it matches a profile value.
- Apply stronger safeguards to seller actions: recent reauthentication for changing account recovery details, payout/payment destination details, shop ownership, or destructive actions; audit sensitive changes; rate-limit publishing and uploads; retain moderation/reporting controls.

## Existing-account transition

- Preserve current phone/password accounts during rollout; do not lock existing merchants out.
- Add a safe Google-linking flow for an existing account only after the user has authenticated to that existing account (and, for sensitive cases, completed fresh reauthentication).
- Never silently merge accounts because Google returns an email matching an existing account. Email equality alone is not proof that the two account records belong together.
- New seller onboarding must create or attach a Google identity before granting seller-management capability.
- Do not invent placeholder phone numbers or passwords for Google-only identities.

## Data model and migration requirements

The current `User` schema requires both `phone` and `passwordHash`. A Google-first seller identity cannot be implemented safely by adding a button alone.

Before changing those columns:
1. Add a dedicated external identity table with a unique constraint on (provider, providerAccountId), a user foreign key, and timestamps.
2. Add nullable email and carefully planned optional phone/password fields, preserving existing rows and phone uniqueness.
3. Backfill/retain all existing accounts without fabricating data.
4. Audit every code path that assumes phone/password are non-null: registration, login, password reset, settings, account deletion, shop setup, listings, contact details, admin authorization, API schemas, exports and tests.
5. Make seller capability explicit and enforce it server-side in every seller write route; hiding seller UI is not authorization.
6. Keep buyer guest routes public and verify they do not accidentally call `requireUser`.

## Security acceptance tests

- Guest can browse, open a shop/product, see permitted seller contact/payment details, and reach the seller without Google sign-in.
- Guest cannot call any seller-management write API.
- Seller cannot create/manage a shop without a valid Google identity.
- Valid Google identity creates a session; forged, expired, wrong-audience, wrong-issuer, nonce-mismatched and replayed tokens fail.
- A Google identity already linked to another user cannot be attached again.
- Matching email does not silently link accounts.
- Existing phone/password merchants retain access and can explicitly link Google after reauthentication.
- Phone remains unverified until an actual phone verification challenge succeeds.
- Seller contact number, Google email, account recovery address and public shop email remain distinct concepts.
- Seller-sensitive changes require recent authentication and produce audit records.

## Rollout gates

- Implement and test the database migration against disposable PostgreSQL.
- Verify Google token validation in the Cloudflare Workers runtime.
- Run lint, typecheck, build, API tests, auth regression tests and guest/seller authorization tests.
- Configure the Google OAuth web client for the canonical production origin and exact callback URI. Keep private secrets in Cloudflare secrets; never commit them.
- Deploy only after review and a rehearsed migration/rollback plan. Existing production accounts must remain usable throughout rollout.

## Explicit non-goals

- No Google account requirement for buyers.
- No mandatory buyer account at purchase/contact.
- No claim that Google sign-in verifies a seller's business, phone number, products, or mobile-money recipient.
- No requirement to collect buyer Google identity just to improve analytics.


## Product and security review — rollout refinement

The direction is sound, but Google sign-in must not be marketed or implemented as seller verification. It is an account-control and abuse-accountability measure, not a trust badge.

### Recommended rollout policy

- **New sellers:** require a verified Google identity before enabling shop creation and seller-management capabilities.
- **Existing phone/password merchants:** grandfather access during a clearly communicated migration window. Prompt them to link Google through an authenticated, explicit linking flow; do not abruptly block their shops or listings. Decide and publish the end date only after measuring successful linking and providing a recovery path.
- **If a merchant cannot use Google:** provide a documented human-reviewed recovery/alternative process before enforcing any deadline. Do not make a Google outage or a lost Google account an irreversible loss of shop ownership.
- **Buyers:** remain guests by default. Optional accounts must never become a hidden purchase prerequisite.

### Important trade-offs

1. **Google becomes a dependency.** OAuth outages, account suspensions, lost Google accounts, or users with limited connectivity can interrupt seller access. Keep Mudaala sessions revocable and provide a recovery process; avoid relying on Google being available for every ordinary request.
2. **Google identity is not business legitimacy.** Display no “verified seller” badge from Google sign-in. Keep distinct evidence states for phone control, business checks, payment-recipient checks, and marketplace behaviour.
3. **A mandatory Google-only path may exclude some merchants.** Validate this assumption with actual onboarding feedback in Uganda before removing other safe identity options. A future alternative may use phone verification plus manual risk review, but an unverified phone number alone is not equivalent to Google authentication.
4. **Account linking is a high-risk operation.** Require an active session on the existing Mudaala account plus recent reauthentication; notify the account's existing contact channel where possible; write an immutable audit event; prevent one Google subject from being linked to multiple users.
5. **Do not weaken the existing account model in one migration.** The current schema requires phone and password. Prefer a separate external-identity table (provider + immutable subject, unique constraint) and staged nullable-column migration only after every phone/password assumption is inventoried. Do not insert fake values.
6. **Seller authorization must be explicit.** A valid login session is not by itself seller permission. Enforce seller capability on every seller write endpoint and verify ownership in the same server-side operation. Guest endpoints must remain read-only or narrowly scoped.

### Decision

Proceed with Google authentication for new seller onboarding, while preserving guest buying and a safe transition for existing merchants. Do not merge or deploy until the identity model, account recovery, seller-route authorization, migration, and regression tests are complete. This is a good direction, not a security-complete implementation.


## Source audit findings on the current branch

Reviewed the current Prisma User model, shared API helpers, account deletion, listing publishing/editing, shop profile updates, seller catalogue writes, and upload signing/finalization.

- The current User model has **required** phone and passwordHash fields. Google-only users therefore require a deliberate schema and account-lifecycle migration; a UI-only OAuth integration would be incomplete.
- requireUser() in src/lib/api.ts proves only that a valid Mudaala session exists. It does not establish Google authentication or a seller capability.
- Core seller writes such as POST /api/listings, PATCH /api/listings/[id], PUT /api/profile, POST /api/my/business-products, and upload endpoints currently rely on requireUser(). Once the policy changes, these need a centralized seller authorization guard, not scattered UI checks.
- Account deletion in src/app/api/account/route.ts assumes every user has a password and verifies it directly. Google-only accounts need a recent-authentication path that does not invent a password.
- Public listing search/detail are deliberately available without login. Preserve this. Public contact/payment information should remain visible under the existing privacy and moderation rules.
- The shared API wrapper already returns controlled 503 responses when the authoritative rate-limit service is unavailable. Preserve this fail-closed behavior for security-sensitive authentication and seller actions.

### Implementation order

1. Design the external identity relation and account lifecycle first.
2. Add a central requireSeller / recent-auth guard and apply it to every seller-management write route.
3. Implement Google OIDC verification and one-time state/nonce handling for the Cloudflare Workers runtime.
4. Implement explicit account linking, account recovery, and passwordless account deletion/re-auth.
5. Add migration, concurrency, authorization, guest-browsing, and rollback tests.
6. Only then enable the new-seller policy in production, with the existing-merchant transition staged and measurable.
