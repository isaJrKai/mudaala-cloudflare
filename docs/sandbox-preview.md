# Running Mudaala in an ephemeral sandbox (preview recipes)

Local/sandbox recipes. Production runs on Cloudflare Workers + Supabase
Postgres per `docs/deploy-cloudflare.md` — that is the durable home.

## Why a sandbox preview can show "refused to connect"

Two independent causes — do not conflate them:

1. **App-side (fixed on this branch).** The security headers refused
   cross-origin embedding (`X-Frame-Options: SAMEORIGIN`,
   `frame-ancestors 'self'`) while the preview panel embeds the app in a
   cross-origin iframe; Chromium renders `<host> refused to connect.` for
   exactly that. Fix: `.zscripts/dev.sh` exports
   `FRAME_ANCESTORS='self' https://*.space-z.ai` (dev only) and
   `next.config.ts` sets `allowedDevOrigins: ["*.space-z.ai"]` so `next dev`
   accepts the proxy's HMR requests.
2. **Platform-side (not fixable app-side).** Ephemeral sandboxes reset to a
   baseline snapshot after roughly 30–60 min of inactivity: processes die and
   the workspace is wiped. Verify `GET /api/health` before blaming the app.

## Fast rebuild recipe (verified end-to-end on 2026-11-13/14)

```bash
npm install                    # NOT npm ci: older lockfiles shipped without prisma
node node_modules/@embedded-postgres/linux-x64/scripts/hydrate-symlinks.js 2>/dev/null || true
node .pgtool/start-pg.js &     # postgres:postgres@127.0.0.1:5432/mudaala
export DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:5432/mudaala"
export DIRECT_URL="$DATABASE_URL"      # set SEPARATELY — export A=x B=$A leaves B empty
npx prisma generate && npx prisma db push --skip-generate && npm run db:seed
# Seeded admin ID changes on every reseed:
#   SELECT id FROM "User" WHERE phone='+256712000001';
bun run dev                    # dev mode (dev.sh carries the FRAME_ANCESTORS fix)
# or production standalone (headers are baked at BUILD time — export
# FRAME_ANCESTORS/NEXT_PUBLIC_APP_URL before `npm run build`, not just at start):
export NEXT_PUBLIC_APP_URL="https://<your-preview-host>"
export CI=true                 # src/lib/db.ts local-Node fallback
npm run build
(cd .next/standalone && NODE_ENV=production CI=true HOSTNAME=0.0.0.0 PORT=3000 node server.js)
nohup bash .zscripts/preview-keepalive.sh >/dev/null 2>&1 &
```

## Environment landmines (all hit in practice)

- **Stale lockfile**: older `package-lock.json` shipped without `prisma`
  entries, so `npm ci` installed almost nothing. Regenerate it.
- **npm install-script gating**: the repo's `allowScripts` block covers
  prisma/sharp et al.; `@embedded-postgres` hydration may still need the
  manual `hydrate-symlinks.js` step above.
- **`embedded-postgres` import shape**: use
  `require('embedded-postgres').default` from a script inside the repo
  (`.pgtool/start-pg.js`) — never require the package dir by absolute path.
- **Production env guards (fail closed)**: with `NODE_ENV=production` the app
  refuses to boot without `NEXT_PUBLIC_APP_URL`, `ADMIN_USER_IDS` and —
  unless `CI=true` — a HYPERDRIVE binding.
- **Next renames its process** to `next-server (vN)` — kill it with
  `pkill -f "[n]ext-server"`, and never `pkill -f` a pattern that also
  appears in your own compound command (it kills your own shell).
- **Health**: `GET /api/health` must return
  `{"ok":true,"app":"up","database":"up"}`.

## Known platform quirks

- Some edge gateways answer `HEAD` with 403 while `GET` works; HEAD-based
  monitors misread a healthy preview as down.
- Triage a dead-looking preview: while the sandbox is up, open the preview
  URL directly in a browser tab. Tab works + panel fails ⇒ the panel/edge
  layer is at fault; report it with the app's request log (which will show
  zero requests from the panel).
