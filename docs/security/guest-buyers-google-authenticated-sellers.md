# Guest Buyers and Google-Authenticated Sellers

**Status:** Google-linking foundation implemented on a draft PR; Google-first login and recovery remain incomplete  
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


## Implementation status — Google account linking foundation

The feature branch now contains an initial, additive implementation:

- Prisma models and SQL migrations for `GoogleIdentity` and `GoogleOAuthState`, including separate `LINK` and anonymous `LOGIN` OAuth state purposes. Login state is bound to the initiating browser and atomically consumed.
- Google identity uniqueness is enforced by provider + immutable subject, and by one Google identity per Mudaala user. Email is metadata only.
- OAuth linking initiation is a POST endpoint, not a state-changing GET. It requires a current Mudaala session created within the last 10 minutes. A separate POST start endpoint supports sign-in only for Google identities already linked to a Mudaala account; it refuses to silently switch an active session.
- OAuth state and nonce are random 256-bit values; only SHA-256 hashes are persisted. State is bound to the Mudaala user, expires after five minutes, and is consumed atomically once.
- The callback exchanges the authorization code server-side and verifies the Google ID token signature with Google's published RS256 JWKS, plus issuer, audience/authorized-party, expiry, issued-at and nonce. It rejects unverified Google email addresses, does not use tokeninfo, and does not trust browser-supplied identity claims.
- Callback redirects are pinned to the canonical `https://mudaala.store` origin rather than derived from the incoming Host header, preventing a Host-header-based open redirect.
- Successful linking writes an audit event. Unique-constraint conflicts prevent linking a Google identity already owned by another Mudaala user. Google sign-in looks up the immutable provider subject only (never email), creates a Mudaala session for that linked user, and records a sign-in audit event. Unlinked Google accounts are directed to the existing phone/password sign-in and explicit linking flow.
- Settings exposes a Google-link action and a server-derived linked/unlinked state. The UI explicitly says Google linking does not verify a shop or phone.
- A centralized `requireSeller()` guard was added. Seller management routes use it; it is feature-gated by `SELLER_GOOGLE_REQUIRED=true` so the policy cannot accidentally activate before configuration and verification.
- The migration marks accounts that already have a shop profile, listing, business product, collection, showroom item or sale as grandfathered. They retain seller access when the feature flag is enabled.

### Required configuration and rollout gates

Set these Cloudflare Worker environment values only after the Google OAuth web client is configured:

- `GOOGLE_CLIENT_ID` — public OAuth client identifier.
- `GOOGLE_CLIENT_SECRET` — secret stored as a Cloudflare secret, never committed or pasted into chat.
- `GOOGLE_REDIRECT_URI` — exact HTTPS callback URL: `https://mudaala.store/api/auth/google/callback`.
- `SELLER_GOOGLE_REQUIRED=true` — enable enforcement only after migration, CI, preview tests, and merchant recovery checks pass.

The Google OAuth client must allow the production origin `https://mudaala.store` and the exact redirect URI above. Add preview origins only when needed and explicitly controlled.

### Not yet complete or verified

- The migration has been committed but **has not been applied** to any database.
- Prisma Client has been generated and the schema/build/typecheck/lint, OIDC unit tests, migration checks, API regression suite, browser journeys, mobile overflow check, and blocking production dependency audit passed on commit `0c0082c`. A follow-up hardening commit now adds verified-email enforcement and canonical-origin redirects; its full CI run is pending.
- Google OAuth credentials and Cloudflare Worker secrets are not configured or verified.
- New sellers still create a phone/password Mudaala account first and explicitly link Google in Settings. The current Google sign-in then works for those linked accounts. It does not yet create Google-only accounts or provide a new Google-first seller onboarding path.
- Google sign-in can recover access for an already-linked account without the Mudaala password. Existing phone/password sign-in and SMS password reset remain available. A linked Google identity can be unlinked only after a fresh password-created session and a new SMS challenge to the current registered phone.
- Account deletion reauthentication has not yet been updated for Google-only identities.
- The linking flow requires a recent Mudaala password session plus a separate, short-lived SMS challenge to the account's current registered phone. The challenge is rate-limited, expires after 10 minutes, has a five-attempt ceiling, stores only an HMAC, and is audited. A keyed HMAC of the phone number is bound to the challenge, so the phone itself is not duplicated in the challenge table and changing the profile phone invalidates the proof.
- PKCE S256 is implemented for both Google login and account linking. The verifier is stored only in a short-lived HttpOnly, Secure-on-HTTPS, SameSite=Lax callback cookie and submitted during the server-side token exchange.
- The modified seller write routes use the centralized requireSeller() guard when SELLER_GOOGLE_REQUIRED=true; a final route-by-route audit and preview end-to-end test are still required before enabling the flag.
- PR #253 remains a draft. No merge, production database migration, or production deployment has occurred.

Do not enable `SELLER_GOOGLE_REQUIRED` until the above verification gates are complete.


## Security hardening added after the initial implementation

- Authorization-code PKCE S256 is used for both LOGIN and LINK flows. The callback requires the browser-bound state/verifier cookie and sends the verifier only to Google's token endpoint.
- Explicit Google linking now requires a fresh Mudaala password session and recent SMS proof for the account's current phone number. The SMS proof is a separate purpose-specific table, not a reused password-reset record.
- Phone verification codes are six digits, HMAC-hashed using the existing reset-code pepper/settings key, expire after ten minutes, are rate-limited by account and IP, and are invalidated after five failed attempts or when a newer challenge is issued.
- Successful phone verification is audited. A verified challenge is accepted for Google linking or unlinking only for ten minutes and only while its keyed phone HMAC matches the user's current registered phone.
- The Settings screen provides the SMS challenge before linking and before unlinking Google.
- Sessions now record whether they were created by PASSWORD or GOOGLE authentication. Recent Google sessions cannot satisfy the fresh-password reauthentication required for linking or unlinking; the callback rechecks this requirement.
- CI now applies the new phone-verification migration in disposable PostgreSQL and checks its RLS policies and runtime grants. The OIDC test suite includes a PKCE S256 regression assertion.

## Remaining before the owner configures Google OAuth credentials

1. Wait for all CI workflows on the final branch head and fix any failures.
2. Finish the route-by-route authorization audit, including guest/public read routes and account deletion/recovery.
3. Confirm the Cloudflare Worker runtime build supports the SMS route's existing Node crypto dependency and run the full OAuth flow in a preview environment.
4. Keep SELLER_GOOGLE_REQUIRED disabled until Google OAuth credentials are configured and the preview flow is verified.
5. Do not run the production migration or deploy this feature before review and a rehearsed rollback plan.

Google-only account creation and passwordless account deletion are intentionally not included in this rollout. Unlinking is supported for existing phone/password accounts after fresh password and SMS reauthentication. Existing phone/password accounts remain the account model; Google is an additional explicitly linked sign-in method.

## Operator configuration gate — stop before credentials are supplied

The code path is prepared, but production OAuth must remain disabled until the operator completes the following in Cloudflare and Google Cloud Console.

### Cloudflare Worker variables and secrets

Set these on the intended Worker environment only:

| Name | Type | Value / purpose |
|---|---|---|
| `GOOGLE_CLIENT_ID` | Worker variable | OAuth 2.0 Web client ID from Google Cloud |
| `GOOGLE_CLIENT_SECRET` | Worker secret | Matching OAuth client secret; never commit or paste into chat |
| `GOOGLE_REDIRECT_URI` | Worker variable | `https://mudaala.store/api/auth/google/callback` |
| `SELLER_GOOGLE_REQUIRED` | Worker variable | Keep `false` until the rollout is explicitly approved |
| `AT_API_KEY` | Worker secret | Africa's Talking API key for real SMS delivery |
| `AT_USERNAME` | Worker variable/secret | Africa's Talking account username |
| `AT_SENDER_ID` | Worker variable, optional | Approved sender ID, if the account has one |

Production SMS delivery always selects Africa's Talking. A production Worker without SMS credentials fails closed; it must never print verification codes or phone numbers to logs. The console SMS provider is available only outside production for controlled tests.

### Google Cloud Console

Create an OAuth 2.0 Client ID of type **Web application**. Add the exact authorized redirect URI:

```text
https://mudaala.store/api/auth/google/callback
```

Do not use a wildcard, a preview URL, an alternate host, or an HTTP URI for production. If preview testing is required, use a separate OAuth client and its exact preview callback URI; do not mix preview and production secrets.

### Final pre-enable checks

1. Confirm the Google client ID and secret belong to the same OAuth client.
2. Confirm the production callback URI exactly matches the Cloudflare Worker variable.
3. Confirm Africa's Talking credentials are active and the sender configuration is approved.
4. Exercise phone-code send, wrong-code ceiling, expiry, resend invalidation, Google link, Google login, unlink, and account-recovery paths on a non-production test identity.
5. Verify guest browse/contact flows remain usable without Google.
6. Verify all seller write routes enforce the server-side seller guard and existing merchants remain grandfathered.
7. Keep `SELLER_GOOGLE_REQUIRED=false` until the migration, preview, rollback, and operational recovery checks have passed.

**Do not enable the flag or run a production database migration as part of credential setup.** Credential configuration is a separate operator step; production rollout requires a separate review and explicit go/no-go decision.

