# Mudaala

Mudaala gives small shops in Uganda a simple digital identity and public catalogue. A shop can share its page and products, then customers can discover items and contact the owner directly by phone or WhatsApp. It is **not a checkout marketplace**: no in-app payments, escrow, delivery dispatch, or in-app chat.

## Production architecture

- **Web app:** Next.js App Router + TypeScript, built for Cloudflare Workers with OpenNext.
- **Database:** PostgreSQL on Supabase, reached by the Worker through Cloudflare Hyperdrive and Prisma's PostgreSQL adapter.
- **Photos:** Supabase Storage, using the `mudaala-photos` bucket and public URLs where configured.
- **Hosting:** Cloudflare Workers. The production URL is [mudaala-cloudflare.kaisoisaac.workers.dev](https://mudaala-cloudflare.kaisoisaac.workers.dev).
- **Deployment:** GitHub Actions validates pull requests. Pushes to `main` build and deploy the Worker, check `/api/health`, and attempt to roll back if the deploy or health check fails.

The current production path is **Cloudflare Workers + Supabase**. The old Render and always-on-VM deployment instructions are no longer the production runbook.

## Local development

Requirements: Node.js 22+, npm, and a local PostgreSQL database.

```bash
npm ci
cp .env.example .env
# Edit .env to point DATABASE_URL at a local PostgreSQL database.
npx prisma generate
npm run dev
```

The app runs at `http://localhost:3000`. Keep real production credentials out of local files and commits. The destructive database commands (`db:push`, `db:reset`, and `db:seed`) are guarded against remote database URLs unless `ALLOW_REMOTE_DB_WRITE=1` is deliberately set for that command.

## Validation and tests

The pull-request workflow uses a **disposable PostgreSQL service**, not the production Supabase database. It validates the Prisma schema, builds the Cloudflare Worker, creates a test schema, seeds development fixtures, starts the app, and runs the API/security suite.

```bash
npm ci
npx prisma validate
npx prisma generate
npx tsx scripts/test-api.ts
```

Run the API test script against a local test database and local app only. It covers authentication, ownership and account isolation, listing validation, saved searches, notifications, moderation, rate limiting, security headers, photo upload behavior, and health checks.

## Development fixtures

`scripts/seed.ts` creates demo users and listings for local review. **Never seed production.** Fixture accounts use demo credentials and are marked with `isSeed`. To inspect seed data before removing it:

```bash
npx tsx scripts/remove-seed-data.ts
```

Only use the destructive `--yes` option after reviewing the dry-run output and confirming the target is the intended local/test database.

## Deployment and required configuration

See [Cloudflare deployment and operations](docs/deploy-cloudflare.md). Production settings are managed through the Cloudflare Worker configuration/secrets and GitHub Actions secrets, not by committing a real `.env`.

The application expects a database connection, canonical public URL, cron secret, settings-encryption key, and admin phone allowlist in production. Photo storage also needs its S3-compatible storage configuration. Keep all credentials private.

## Repository structure

- `src/app/` — App Router pages and API routes.
- `src/components/` — application and UI components.
- `src/lib/` — database access, auth, validation, listing and shop domain logic.
- `prisma/schema.prisma` and `prisma/migrations/` — PostgreSQL schema and migrations.
- `scripts/test-api.ts` — API/security integration tests.
- `.github/workflows/` — pull-request validation, live verification and production deployment.
