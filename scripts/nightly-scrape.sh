#!/bin/bash
# Nightly registration scrape — invoked by cron inside the production container.
#
# Re-scrapes the last 7 days of registration reports (catches backdated/edited
# registrations) and writes spider output JSON to the import data volume.
# Cron runs with a minimal environment, so we explicitly export everything the
# scraper/spider need (output dir, cookie file, Puppeteer/chromium, PATH).

export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

export IMPORT_DATA_DIR="${IMPORT_DATA_DIR:-/data/migrate}"
export MIGRATE_OUTPUT_DIR="${MIGRATE_OUTPUT_DIR:-/data/migrate}"
export MIGRATE_COOKIE_FILE="${MIGRATE_COOKIE_FILE:-/data/cookie.txt}"
export PUPPETEER_SKIP_DOWNLOAD="${PUPPETEER_SKIP_DOWNLOAD:-true}"
export PUPPETEER_EXECUTABLE_PATH="${PUPPETEER_EXECUTABLE_PATH:-/usr/bin/chromium-browser}"

# --- Log rotation ----------------------------------------------------------
# Cron invokes this script with no stdout redirect; we own our own logging so
# we can rotate before writing. The log lives on the /data volume and would
# otherwise grow unbounded over months of nightly runs. We keep a fixed number
# of size-capped, numbered backups (.1 .. .N) and prune the rest.
LOG_DIR="${NIGHTLY_LOG_DIR:-/data/logs}"
LOG_FILE="$LOG_DIR/nightly-scrape.log"
LOG_MAX_BYTES="${NIGHTLY_LOG_MAX_BYTES:-5242880}"   # rotate when log exceeds 5 MB
LOG_KEEP="${NIGHTLY_LOG_KEEP:-7}"                     # keep this many old logs (.1 .. .N)

mkdir -p "$LOG_DIR"

if [ -f "$LOG_FILE" ]; then
  CUR_SIZE="$(wc -c < "$LOG_FILE" 2>/dev/null | tr -d ' ')"
  if [ -n "$CUR_SIZE" ] && [ "$CUR_SIZE" -ge "$LOG_MAX_BYTES" ]; then
    # Drop the oldest, then shift each backup up by one.
    rm -f "$LOG_FILE.$LOG_KEEP"
    i=$((LOG_KEEP - 1))
    while [ "$i" -ge 1 ]; do
      [ -f "$LOG_FILE.$i" ] && mv "$LOG_FILE.$i" "$LOG_FILE.$((i + 1))"
      i=$((i - 1))
    done
    mv "$LOG_FILE" "$LOG_FILE.1"
  fi
fi

# Send all stdout/stderr from here on to the (possibly freshly rotated) log.
exec >> "$LOG_FILE" 2>&1
# ---------------------------------------------------------------------------

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DAYS_BACK=7
TODAY="$(date '+%d/%m/%Y')"

echo ""
echo "############################################################"
echo "# Nightly registration scrape"
echo "# Started:   $(date)"
echo "# Start date: $TODAY (DD/MM/YYYY), days back: $DAYS_BACK"
echo "# Output:    $MIGRATE_OUTPUT_DIR"
echo "############################################################"

bash "$SCRIPT_DIR/migrate-site/scrape-registrations.sh" "$TODAY" "$DAYS_BACK"
STATUS=$?

echo "# Finished:  $(date) (exit $STATUS)"
echo "############################################################"

exit $STATUS
