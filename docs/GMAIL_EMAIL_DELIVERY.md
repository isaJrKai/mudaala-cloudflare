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
