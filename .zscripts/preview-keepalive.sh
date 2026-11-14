#!/bin/bash
# Preview self-healing supervisor for ephemeral sandboxes (crash-only: it dies
# with the sandbox; re-run after any recycle). See docs/sandbox-preview.md.
set -u
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG=/tmp/preview-keepalive.log
cd "$PROJECT_DIR" || exit 1
export DATABASE_URL="${DATABASE_URL:-postgresql://postgres:postgres@127.0.0.1:5432/mudaala}"
export DIRECT_URL="${DIRECT_URL:-$DATABASE_URL}"
export AUTH_BEARER_FALLBACK="${AUTH_BEARER_FALLBACK:-1}"
export CRON_SECRET="${CRON_SECRET:-dev-cron-secret}"
export SETTINGS_ENC_KEY="${SETTINGS_ENC_KEY:-dev-settings-enc-key}"
export ADMIN_PHONES="${ADMIN_PHONES:-+256712000001}"
# Seeded admin ID changes on every reseed — re-query and update:
#   SELECT id FROM "User" WHERE phone='+256712000001';
export ADMIN_USER_IDS="${ADMIN_USER_IDS:-SET_ME_AFTER_SEED}"
export NEXT_PUBLIC_APP_URL="${NEXT_PUBLIC_APP_URL:-http://localhost:3000}"
export APP_ORIGIN="${APP_ORIGIN:-$NEXT_PUBLIC_APP_URL}"
export CSRF_TRUSTED_HOSTS="${CSRF_TRUSTED_HOSTS:-.space-z.ai,.preview-platform.example}"
export FRAME_ANCESTORS="${FRAME_ANCESTORS:-'self' https://*.space-z.ai}"
# src/lib/db.ts: production refuses DATABASE_URL unless CI=true (designed
# local-Node fallback for sandbox previews).
export CI="${CI:-true}"
export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=1536}"
STANDALONE="$PROJECT_DIR/.next/standalone/server.js"
pg_up()  { (exec 3<>/dev/tcp/127.0.0.1/5432) 2>/dev/null; }
app_up() { (exec 3<>/dev/tcp/127.0.0.1/3000) 2>/dev/null; }
start_app() {
  if [ -f "$STANDALONE" ]; then
    echo "[$(date '+%F %T')] starting standalone server" >> "$LOG"
    (cd "$PROJECT_DIR/.next/standalone" && NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3000 \
      nohup node server.js > /tmp/mudaala-preview-standalone.log 2>&1 &)
  else
    echo "[$(date '+%F %T')] standalone missing — starting dev server" >> "$LOG"
    nohup bun run dev > /tmp/mudaala-preview-dev.log 2>&1 &
  fi
}
echo "[$(date '+%F %T')] keepalive started (pid $$, project $PROJECT_DIR)" >> "$LOG"
while true; do
  if ! pg_up; then
    echo "[$(date '+%F %T')] PostgreSQL down — starting .pgtool" >> "$LOG"
    nohup node "$PROJECT_DIR/.pgtool/start-pg.js" > /tmp/pg-boot-keepalive.log 2>&1 &
    sleep 8
  fi
  if ! app_up; then
    sleep 5
    if ! app_up; then
      echo "[$(date '+%F %T')] app port 3000 closed — restarting" >> "$LOG"
      start_app
    fi
  fi
  sleep 30
done
