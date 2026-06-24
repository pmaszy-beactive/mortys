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
# on the /data volume (append-only, no rotation) so the operator can scroll back.
LOG_DIR="/data/logs"
mkdir -p "$LOG_DIR"
echo "[2/3] Starting cron daemon (nightly registration scrape @ 22:00)..."
echo "[cron] Schedule: 0 22 * * * — last 7 days of registrations"
echo "[cron] Run log:  $LOG_DIR/nightly-scrape.log (append-only)"
crond -b -c /etc/crontabs -L "$LOG_DIR/crond.log"

echo "[3/3] Starting application..."
exec node dist/index.js
