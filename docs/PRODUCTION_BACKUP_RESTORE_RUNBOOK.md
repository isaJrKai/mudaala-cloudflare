# Mudaala production backup and restore runbook

## Status and safety boundary

This runbook is for the founder/authorized operator to produce and verify a protected backup. It does not claim that a production backup has already been taken. Never restore into the production project as part of a drill.

The Supabase organization currently reports the Free plan. Do not assume managed daily backups are available. Check the project dashboard and plan before relying on provider backups.

**Do not put database dumps, Storage objects, connection strings, passwords, API keys, or encryption private keys in Git, GitHub Actions logs/artifacts, chat, or an unencrypted shared folder.** Do not enable paid infrastructure without founder approval.

## What must be protected

1. PostgreSQL database: schema, application data, authentication records, policies/functions/triggers, and relevant roles.
2. Supabase Storage object bytes, separately from the database. The database contains object metadata, not the actual uploaded photos.
3. Recovery instructions and non-secret configuration needed to rebuild the application (already represented in the repository and provider dashboards).

A successful database restore alone is not a complete Mudaala recovery drill.

## Before the first production export

- Confirm the project ref and environment in the Supabase Dashboard. Use the production project's **Connect** panel to obtain a database connection string.
- Confirm there is an approved encrypted off-site destination with restricted access and a retention policy. If no destination is approved, stop after the local encrypted export and do not call the off-site gate complete.
- Install a current Supabase CLI, Docker, PostgreSQL client tools, and an encryption tool such as `age`.
- Store the database URL and encryption private key in a password manager or secret manager. Do not paste either into a terminal transcript that will be shared.
- Create a private working directory and ensure it is excluded from cloud sync and Git.

## Create an encrypted logical database export

Run this from a trusted workstation, with `DATABASE_URL` set securely in the shell environment to the production connection string. Do not use the application's restricted runtime credential if it cannot read all required backup data; use a separately authorized database credential with only the access needed for export.

```bash
set -euo pipefail
umask 077
: "${DATABASE_URL:?Set DATABASE_URL securely before continuing}"
: "${AGE_RECIPIENT:?Set AGE_RECIPIENT to the approved backup recipient's public age key}"

workdir="$(mktemp -d)"
trap 'rm -rf "$workdir"' EXIT

supabase db dump --db-url "$DATABASE_URL" --role-only -f "$workdir/roles.sql"
supabase db dump --db-url "$DATABASE_URL" -f "$workdir/schema.sql"
supabase db dump --db-url "$DATABASE_URL" --use-copy --data-only -f "$workdir/data.sql"

tar -C "$workdir" -czf "$workdir/mudaala-db-backup.tar.gz" roles.sql schema.sql data.sql
age -r "$AGE_RECIPIENT" -o "$workdir/mudaala-db-backup.tar.gz.age" "$workdir/mudaala-db-backup.tar.gz"
sha256sum "$workdir/mudaala-db-backup.tar.gz.age"
```

Upload **only** the encrypted `.age` file and its checksum to the approved off-site destination. Confirm the upload completed and verify the checksum against the uploaded bytes. Keep the decryption private key separate from the backup destination. Record the timestamp, project ref, CLI version, checksum, destination, and operator in the private operations log—not secrets or row contents.

This command creates a logical database export. It does not back up Storage object bytes.

## Storage object backup

Use an approved method supported by the project's configured Supabase Storage access (for example, the Storage S3-compatible endpoint if enabled). Copy object bytes and required bucket/access metadata to the approved private destination. Keep private credentials out of logs and never change the existing bucket's public/private setting as part of a backup.

After copying, compare bucket names, object counts, total bytes, and per-object checksums where the chosen transfer method supports them. Verify a small sample can be decrypted/accessed in the backup destination without changing or deleting production objects. If no safe destination or supported authenticated copy method is available, document this as an open blocker; do not claim photos are backed up.

## Restore drill — disposable target only

- Use a **local disposable Supabase stack or another isolated test target** with a compatible PostgreSQL/Supabase version and required extensions. Do not use the production project, production connection string, or a live customer account as the restore target.
- Download the encrypted database archive from the off-site destination; verify its checksum before decryption.
- Decrypt into a private temporary directory. Restrict file permissions and ensure the plaintext files are removed after the drill.
- Follow the current Supabase platform-to-local restore instructions for the installed CLI/version. Restore roles, schema, and data into the disposable target, resolving only documented version/extension incompatibilities. Never work around an error by disabling production protections.
- Run read-only verification against the restored target:
  - expected public application tables and migrations are present;
  - schema, indexes, constraints, RLS policies, grants, functions, and extensions are present;
  - key-table row counts match the source snapshot where comparison is available;
  - authentication and representative application records can be read in the isolated target;
  - Storage bucket metadata and backed-up object counts/checksums match the recorded snapshot.
- Do not print private row contents, emails, phone numbers, tokens, or object paths in logs. Do not connect the restored database to the live Worker.
- Remove the disposable target and plaintext temporary files after recording pass/fail evidence and any blockers.

## Completion criteria

The production recovery gate is complete only when all of the following are evidenced:

- [ ] Encrypted logical export created from the intended production project.
- [ ] Encrypted database backup copied to an approved off-site destination and checksum verified.
- [ ] Storage object bytes backed up separately; counts/bytes/checksums verified.
- [ ] Database archive successfully restored to a disposable isolated target.
- [ ] Schema/security structure and key-table counts verified against the source snapshot.
- [ ] Storage restore/sample-object checks pass.
- [ ] Timestamp, tool versions, destination, checksum, restore duration, results, and unresolved limitations recorded without secrets.

The CI logical dump/restore test is useful regression evidence, but does not satisfy these production-data criteria.
