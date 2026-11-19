# Gmail transactional email

Mudaala uses the Gmail API over HTTPS (not SMTP) so it works in Cloudflare Workers.

## Sender

The default sender is `mudaalakatale@gmail.com`. Set `GOOGLE_GMAIL_SENDER` only if the authorized Google account has that address configured as a valid sending alias.

## Worker secrets

Set these as Cloudflare Worker secrets; never commit their values:

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_GMAIL_REFRESH_TOKEN`

Optional non-secret configuration:

- `GOOGLE_GMAIL_SENDER=mudaalakatale@gmail.com`

The refresh token must belong to the Google account that owns the sender address and must have been explicitly authorized with the `https://www.googleapis.com/auth/gmail.send` scope. The existing Mudaala Google sign-in/link flow requests identity scopes only; signing into Mudaala with Google does not authorize Gmail sending. Use a separate, owner-controlled OAuth consent flow to grant the Gmail scope.

Do not enable email-based password reset or passwordless login until:
1. the owner has authorized the Gmail send scope;
2. all three Worker secrets are configured;
3. a real message has been delivered to and received by a test inbox; and
4. the account-email verification and recovery flows are deployed and verified.

Phone ownership checks (including appeal verification) must continue to use SMS. Gmail is not proof of control of a registered phone number.


## Implemented account-email routes

All email identity and recovery endpoints are backed by the private `User.email` field and `EmailAuthChallenge` table:

- `POST /api/auth/email/request-verification` — signed-in user requests verification for an address.
- `POST /api/auth/email/verify` — verifies the six-digit code and attaches the private address to that account.
- `POST /api/auth/email-login/request` and `/verify` — passwordless sign-in for verified addresses only.
- `POST /api/auth/email-reset/request` and `/verify` — password recovery for verified addresses only.

Codes are HMAC-hashed, expire after 10 minutes, are limited to five failed attempts, and are single-use. Request endpoints use anti-enumeration responses and rate limits. A successful password reset revokes all existing sessions. Suspended accounts cannot establish a passwordless session.

## Rollout sequence

1. Authorize the sender account for Gmail API `gmail.send` and configure the three Worker secrets above.
2. Apply the Prisma migration with the repository's normal release migration step (`prisma migrate deploy`) before deploying code that reads the new fields/table.
3. Verify a message reaches a controlled test inbox.
4. Test email verification, sign-in, and recovery with a non-production account, including wrong/expired/replayed codes and suspended-account rejection.
5. Only then enable the updated application in production. Existing phone/password and SMS recovery remain available throughout the transition.

The migration is additive: existing users retain their phone, password, sessions, and shop records. No email is inferred from a public shop contact or Google identity.

## Google OAuth setup notes

Use the Google Cloud project that owns the OAuth client. Enable the Gmail API and configure the OAuth consent screen. The sender account must be an allowed test user while the app is in Testing.

For a one-time owner authorization, the Google OAuth 2.0 Playground can be used with **your own OAuth credentials**:
1. In the OAuth client configuration, add `https://developers.google.com/oauthplayground` as an authorized redirect URI (only if using the Playground).
2. In the Playground settings, enable **Use your own OAuth credentials**, select server-side flow and **Offline** access, then enter the OAuth client ID and secret.
3. Authorize only `https://www.googleapis.com/auth/gmail.send` while signed into `mudaalakatale@gmail.com`.
4. Exchange the authorization code and place the returned refresh token directly into the Cloudflare Worker secret. Do not paste it into chat, GitHub, source files or logs.

**Important token-lifetime warning:** Google documents that refresh tokens issued while an External OAuth consent screen is in **Testing** expire after 7 days when Gmail scopes are requested. Do not treat a Testing-mode token as a production credential. Before relying on this sender in production, resolve the OAuth app publishing/verification requirements for the sensitive `gmail.send` scope and obtain a refresh token under the intended production consent configuration. Google may also revoke refresh tokens for other security or account-policy reasons, so delivery failures must be monitored.

Official references:
- https://developers.google.com/identity/protocols/oauth2
- https://developers.google.com/workspace/gmail/api/auth/scopes
- https://developers.google.com/oauthplayground

