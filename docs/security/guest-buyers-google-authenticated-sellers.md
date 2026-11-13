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
