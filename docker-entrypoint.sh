#!/bin/sh
set -e

echo "=== Morty's Driving School — Starting ==="

# Ensure the import data volume exists (scraper output + dedup state + cookie).
IMPORT_DIR="${IMPORT_DATA_DIR:-/data/migrate}"
mkdir -p "$IMPORT_DIR"
echo "[import] Data dir: $IMPORT_DIR"

# First-boot seeding is intentionally asynchronous. The bundled import archive
# contains thousands of small files and is only needed when an operator later
# runs Data Migration; blocking startup on the copy can exhaust the deployment
# health-check window before the web server ever binds its port.
SEED_DIR="${IMPORT_SEED_DIR:-/app/import-seed}"
PUBLISHED_SEED_DIR="$IMPORT_DIR/import-seed-data"
SEED_OWNER="${HOSTNAME:-container}-$$"
SEED_STAGE="$IMPORT_DIR/.import-seed-staging.$SEED_OWNER"
SEED_PUBLISH_LOCK="$IMPORT_DIR/.import-seed-publish.lock"

has_live_import_data() {
  # Hidden staging directories are intentionally excluded. The JSON importer
  # ignores dot-prefixed paths too, so a staged archive is never partially read.
  [ -n "$(find "$IMPORT_DIR" -mindepth 1 -path "$IMPORT_DIR/.*" -prune \
    -o -name '*.json' -print -quit 2>/dev/null)" ]
}

seed_import_data() {
  COPY_PID=""
  cleanup_seed_worker() {
    if [ -n "$COPY_PID" ] && kill -0 "$COPY_PID" 2>/dev/null; then
      kill -TERM "-$COPY_PID" 2>/dev/null || kill -TERM "$COPY_PID" 2>/dev/null || true
      wait "$COPY_PID" 2>/dev/null || true
    fi
    rm -rf "$SEED_STAGE"
  }
  trap 'cleanup_seed_worker; exit 143' TERM INT HUP

  if [ ! -d "$SEED_DIR" ]; then
    echo "[import] No seed dir — skipping seed."
    return 0
  fi

  if [ -d "$PUBLISHED_SEED_DIR" ]; then
    echo "[import] Seed already completed — skipping seed."
    return 0
  fi

  # A populated volume predates this startup or was filled by the scraper and
  # is already the source of truth. Never copy seed files over live paths.
  if has_live_import_data; then
    echo "[import] Volume already has data — skipping seed."
    return 0
  fi

  SEED_COUNT="$(find "$SEED_DIR" -name '*.json' | wc -l | tr -d ' ')"
  if [ "$SEED_COUNT" -eq 0 ]; then
    echo "[import] No seed files in import-seed/ — skipping seed."
    return 0
  fi

  rm -rf "$SEED_STAGE"
  mkdir -p "$SEED_STAGE"
  echo "[import] Staging $SEED_COUNT JSON file(s) in background..."
  setsid cp -r "$SEED_DIR"/. "$SEED_STAGE"/ &
  COPY_PID=$!
  set +e
  wait "$COPY_PID"
  COPY_STATUS=$?
  set -e
  COPY_PID=""
  if [ "$COPY_STATUS" -ne 0 ]; then
    echo "[import] WARNING: Seed copy failed; it will resume on the next startup."
    rm -rf "$SEED_STAGE"
    return 1
  fi

  STAGED_COUNT="$(find "$SEED_STAGE" -name '*.json' | wc -l | tr -d ' ')"
  if [ "$STAGED_COUNT" -ne "$SEED_COUNT" ]; then
    echo "[import] WARNING: Seed validation failed ($STAGED_COUNT/$SEED_COUNT files); retrying next startup."
    rm -rf "$SEED_STAGE"
    return 1
  fi

  # Do not publish if scraper/operator data appeared while staging.
  if has_live_import_data; then
    echo "[import] Live data appeared while staging — preserving it and discarding bundled seed."
    rm -rf "$SEED_STAGE"
    return 0
  fi

  # Advisory locks are released by the OS on every process-death path,
  # including SIGKILL/OOM/host loss. The lock file itself may persist safely;
  # only the live file-descriptor lock grants permission to publish.
  exec 9>"$SEED_PUBLISH_LOCK"
  if ! flock -w 30 9; then
    if [ -d "$PUBLISHED_SEED_DIR" ]; then
      echo "[import] Another container published the seed first — discarding duplicate stage."
    else
      echo "[import] WARNING: Seed publish lock is still held; retrying next startup."
    fi
    rm -rf "$SEED_STAGE"
    exec 9>&-
    return 0
  fi

  # Recheck after acquiring the lock because live data or another completed
  # archive may have appeared while this worker was staging.
  if has_live_import_data || [ -d "$PUBLISHED_SEED_DIR" ]; then
    echo "[import] Another container published the seed first — discarding duplicate stage."
    rm -rf "$SEED_STAGE"
  elif mv "$SEED_STAGE" "$PUBLISHED_SEED_DIR"; then
    echo "[import] Seed complete. Open Data Migration → Import to Database and click Run Import."
  else
    echo "[import] WARNING: Could not publish staged seed; retrying next startup."
    rm -rf "$SEED_STAGE"
    flock -u 9
    exec 9>&-
    return 1
  fi

  flock -u 9
  exec 9>&-
}

seed_import_data &
SEED_PID=$!
echo "[import] Background seed started; continuing application startup."

echo "[1/3] Running database migrations..."
node dist/migrate.js

# Seed demo accounts (idempotent). Runs after migrations so the tables exist.
# Guarantees the demo instructor + demo student logins are present in production.
echo "[1b/3] Seeding demo accounts..."
node dist/seed-demo.js

# Nightly registration scrape cron. crond runs jobs with a minimal env, so the
# wrapper (scripts/nightly-scrape.sh) exports what the scraper needs. Logs persist
# on the /data volume; each nightly run rotates BOTH nightly-scrape.log and the
# cron daemon's own crond.log by size (5 MB) and keeps a bounded set of numbered
# backups so neither grows without limit.
LOG_DIR="${LOG_DATA_DIR:-/data/logs}"
mkdir -p "$LOG_DIR"

# crond passes only a minimal env to jobs, so persist the runtime secrets the
# wrapper needs (failure-alert token + optional overrides) to a file it sources.
# Written to an ephemeral container path (not the /data volume) to avoid leaving
# secrets on persistent storage.
CRON_ENV_FILE="${CRON_ENV_FILE:-/etc/nightly-scrape.env}"
: > "$CRON_ENV_FILE"
chmod 600 "$CRON_ENV_FILE"
for var in INTERNAL_ALERT_TOKEN SCRAPE_ALERT_URL SCRAPE_ALERT_EMAIL APP_INTERNAL_PORT \
           IMPORT_DATA_DIR MIGRATE_OUTPUT_DIR MIGRATE_COOKIE_FILE \
           PUPPETEER_SKIP_DOWNLOAD PUPPETEER_EXECUTABLE_PATH \
           SCRAPE_LOG_LEVEL SCRAPE_MAX_RETRIES; do
  eval "val=\${$var}"
  if [ -n "$val" ]; then
    printf 'export %s=%s\n' "$var" "$(printf '%s' "$val" | sed "s/'/'\\\\''/g; s/^/'/; s/$/'/")" >> "$CRON_ENV_FILE"
  fi
done
echo "[cron] Wrote cron environment to $CRON_ENV_FILE"
if [ -z "$INTERNAL_ALERT_TOKEN" ]; then
  echo "[cron] WARNING: INTERNAL_ALERT_TOKEN not set — scrape-failure alerts are disabled."
fi

echo "[2/3] Starting cron daemon (nightly registration scrape @ 22:00)..."
echo "[cron] Schedule: 0 22 * * * — last 7 days of registrations"
echo "[cron] Run log:  $LOG_DIR/nightly-scrape.log (size-rotated, 5 MB x 7 backups)"
echo "[cron] Daemon log: $LOG_DIR/crond.log (size-rotated nightly, 5 MB x 7 backups)"
crond -b -c /etc/crontabs -L "$LOG_DIR/crond.log"

echo "[3/3] Starting application..."
node dist/index.js &
APP_PID=$!

shutdown() {
  echo "[shutdown] Stopping application..."
  kill -TERM "$APP_PID" 2>/dev/null || true
  kill -TERM "$SEED_PID" 2>/dev/null || true
  wait "$APP_PID" 2>/dev/null || true
  wait "$SEED_PID" 2>/dev/null || true
}
trap shutdown TERM INT

set +e
wait "$APP_PID"
APP_STATUS=$?
set -e

if kill -0 "$SEED_PID" 2>/dev/null; then
  kill -TERM "$SEED_PID" 2>/dev/null || true
fi
wait "$SEED_PID" 2>/dev/null || true
exit "$APP_STATUS"
