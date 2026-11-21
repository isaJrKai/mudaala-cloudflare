# NFC / QR shop tags

A tag is a sticker that stores one thing: `https://<site>/s/MD-XXXX?t=<tagCode>`.
Tap (NFC) or scan (QR, `&v=qr`) opens the existing public shop page. Payment happens
only through the shop's own pay sheet - a tag never carries a payment number.

- Seller UI: "Tap-to-shop tags" panel on the owner's shop page (max 10 tags per shop).
- API: `GET/POST /api/my/tags`, `PATCH /api/my/tags/:id` (rename, turn off/on, rotate, mark locked),
  public beacon `POST /api/shops/tag-tap` (rate limited, counters only, no buyer data).
- Tag codes: 10 random characters (no 0/1/i/l/o). Rotating retires a lost or tampered tag.
- Counting happens in the browser (`TagTapBeacon`), so crawlers/link previews are not counted;
  the owner's own visits are skipped.
- Writing/locking in-app uses Web NFC (Android Chrome). Other phones: copy the link into the free NFC Tools app.

Rollout: `npm run db:deploy` (migration `20261121100000_shop_nfc_tags`), then deploy.
Tests: `npm run test:shop-tags`.
