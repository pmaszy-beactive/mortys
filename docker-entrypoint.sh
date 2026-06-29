#!/bin/sh
set -e

echo "=== Morty's Driving School — Starting ==="

# Ensure the import data volume exists (scraper output + dedup state + cookie).
IMPORT_DIR="${IMPORT_DATA_DIR:-/data/migrate}"
mkdir -p "$IMPORT_DIR"
echo "[import] Data dir: $IMPORT_DIR"

# First-boot seeding: if the volume has no JSON yet and bundled seed data exists
# in import-seed/, copy it onto the volume once. After that the volume is the
# source of truth (a re-scrape on the volume is never overwritten).
SEED_DIR="/app/import-seed"
if [ -d "$SEED_DIR" ] && [ -z "$(find "$IMPORT_DIR" -name '*.json' -print -quit 2>/dev/null)" ]; then
  SEED_COUNT="$(find "$SEED_DIR" -name '*.json' | wc -l | tr -d ' ')"
  if [ "$SEED_COUNT" -gt 0 ]; then
    echo "[import] Volume is empty — seeding $SEED_COUNT JSON file(s) from import-seed/ ..."
    cp -r "$SEED_DIR"/. "$IMPORT_DIR"/
    echo "[import] Seed complete. Open Data Migration → Import to Database and click Run Import."
  else
    echo "[import] No seed files in import-seed/ — skipping seed."
  fi
else
  echo "[import] Volume already has data (or no seed dir) — skipping seed."
fi

echo "[1/3] Running database migrations..."
node dist/migrate.js

# Nightly registration scrape cron. crond runs jobs with a minimal env, so the
# wrapper (scripts/nightly-scrape.sh) exports what the scraper needs. Logs persist
# on the /data volume; each nightly run rotates BOTH nightly-scrape.log and the
# cron daemon's own crond.log by size (5 MB) and keeps a bounded set of numbered
# backups so neither grows without limit.
LOG_DIR="/data/logs"
mkdir -p "$LOG_DIR"

# crond passes only a minimal env to jobs, so persist the runtime secrets the
# wrapper needs (failure-alert token + optional overrides) to a file it sources.
# Written to an ephemeral container path (not the /data volume) to avoid leaving
# secrets on persistent storage.
CRON_ENV_FILE="/etc/nightly-scrape.env"
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
exec node dist/index.js
