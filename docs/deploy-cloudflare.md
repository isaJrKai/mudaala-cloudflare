# Cloudflare Workers deployment and operations

This is the active deployment runbook for Mudaala. Production runs on **Cloudflare Workers**, uses **Supabase PostgreSQL** through **Cloudflare Hyperdrive**, and stores shop/listing photos in Supabase Storage. Do not follow the retired VM/Render instructions from older versions of this document.

## Production resources

- Worker: `mudaala-cloudflare`
- Public URL: https://mudaala-cloudflare.kaisoisaac.workers.dev
- Database: Supabase PostgreSQL, connected from the Worker through the `HYPERDRIVE` binding in `wrangler.jsonc`
- Photo bucket: `mudaala-photos`
- Scheduled trigger: `0 3 * * *` UTC, configured in `wrangler.jsonc`

Do not put database passwords, Supabase service-role keys, Cloudflare API tokens, or other secrets in source control or in public issue comments.

## Deployment flow

1. Create a feature branch and pull request. The `validate-pr.yml` workflow installs the lockfile dependencies, validates/generates Prisma, builds the Worker, and runs API/security tests against a disposable PostgreSQL service.
2. Review the diff and wait for validation to finish. Do not merge if build, schema, or behavior tests fail.
3. A push to `main` triggers `deploy-cloudflare.yml`. It builds the Worker without production database credentials, captures the active Worker version, deploys, and performs a read-only `GET /api/health` check.
4. If deployment or the health check fails, the workflow attempts to route traffic back to the previously active Worker version and checks health again.

Do not manually deploy a feature branch to production to bypass the pull-request validation.

## Required runtime configuration

The Worker must receive the production values for:

- `DATABASE_URL` for local/Node execution paths; Cloudflare runtime database access uses the configured `HYPERDRIVE` binding.
- `NEXT_PUBLIC_APP_URL` for canonical URLs, sitemap and metadata.
- `CRON_SECRET` for the protected scheduled sweep endpoint.
- `SETTINGS_ENCRYPTION_KEY` (or its supported legacy alias) for encryption of stored settings.
- `ADMIN_PHONES` for the administrator allowlist.
- `STORAGE_ENDPOINT`, `STORAGE_BUCKET`, `STORAGE_KEY`, `STORAGE_SECRET`, and `STORAGE_PUBLIC_URL` for S3-compatible photo storage.

Set secrets in the appropriate Cloudflare/GitHub secret stores. Use the repository's current deployment workflow as the source of truth for the secret names and deployment steps. Never copy production secrets into `.env.example`, test fixtures, screenshots, or logs.

## Database safety

- Production schema changes must be reviewed migrations in `prisma/migrations/`.
- Never run `prisma db push`, `prisma migrate reset`, or seed/removal scripts against production as a cleanup shortcut.
- The CI workflow uses disposable PostgreSQL and must not be pointed at the live Supabase database.
- The Supabase project and storage bucket contain live user data. Before a schema or access-policy change, review the migration, least-privilege access, and rollback implications.

## Read-only verification

Check the production health endpoint after a deployment:

```bash
curl --fail --silent --show-error \
  https://mudaala-cloudflare.kaisoisaac.workers.dev/api/health
```

The response must indicate that the app and database are up. Health checks confirm connectivity, not the correctness of every customer flow; use the API tests and explicit shop-owner/public-shop verification for those.

## Photos

Photo uploads use the storage configuration above. After a photo-related change, verify an authenticated upload, the returned public URL, object persistence after refresh, and rendering on the public shop/listing page. Avoid test uploads or test accounts in production unless they are clearly controlled and removed safely.
