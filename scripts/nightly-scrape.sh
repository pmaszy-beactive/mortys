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
