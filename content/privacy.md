# Privacy Policy

Mudaala is a marketplace for local trade in Uganda. This policy explains, in plain words, what we collect and what we never do. The short version: your phone number is your account, we do not sell your data, and we do not show your contact details to strangers until you choose to.

_Last updated: October 2026. Questions? Reach the team through the app or the support email on your notifications._

## What we collect

- **Your account:** name, phone number and country. The phone number is your identity on Mudaala. It is how you sign in and how buyers reach you.
- **Your listings:** what you publish: titles, descriptions, prices, photos, location and the contact number you attach to each ad.
- **Your shop:** the business name, photo, description, area and opening hours you enter.
- **Technical records:** when you sign in we keep a session token so the app remembers you. We keep coarse network records (such as an IP address) only to rate-limit abuse and to deduplicate reports, never to profile you.
- **Messages you send us:** reports you file and appeals you send.

## What we never do

- We never sell your personal data. There is no advertising tracker on Mudaala.
- We never publish your phone number in search engines. Ad pages, metadata and sitemaps deliberately exclude it; a buyer sees your number only on the ad you attached it to, or when you contact them.
- We never store your password in a readable form. Passwords are hashed; password-reset codes are hashed too and die after ten minutes.

## How your data is protected

- Sessions are httpOnly cookies; tokens cannot be read by other websites.
- Sensitive deployment secrets are encrypted at rest with AES-256-GCM.
- Photos you upload are re-processed on our servers: location data (EXIF/GPS) is stripped and large photos are resized before anyone can see them.

## Deleting your data

You can delete any listing yourself, any time. To delete your whole account, contact support through the app. We will remove your account, listings and shop, except the small records we must keep to honour the law and to keep abusers out.

## Changes to this policy

When this policy changes, the version date at the top changes and the app may ask you to review it again. Continuing to use Mudaala after a change means you accept the updated policy.


## Bug reports and feedback

If you send “Report a bug / Send feedback”, Mudaala stores the category, summary, comment, the page path you were viewing, a limited browser user-agent string, and any contact detail you choose to provide. Contact details are optional. Feedback is visible to authorized Mudaala administrators for investigation and triage; internal admin notes are not shown to reporters. Feedback is rate-limited to reduce abuse. Do not include passwords, payment secrets, or sensitive personal information in a report. This first version does not accept screenshot attachments. Feedback records are retained while reasonably needed to investigate issues, maintain platform safety, and document resolutions, subject to applicable deletion and legal requirements.


## Image safety checks

When automated photo moderation is enabled, newly uploaded original photos and their small previews are sent securely to OpenAI's Moderation API for classification before Mudaala stores or publishes them. The provider receives image data and returns safety categories. Mudaala does not send account passwords or payment details as part of this check. If moderation credentials are missing or the provider is unavailable, production photo uploads are temporarily blocked rather than published without a safety check. Existing photos are not retroactively scanned by this upload-time control.
