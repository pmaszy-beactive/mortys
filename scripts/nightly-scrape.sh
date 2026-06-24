#!/bin/bash
# Nightly registration scrape — invoked by cron inside the production container.
#
# Re-scrapes the last 7 days of registration reports (catches backdated/edited
# registrations) and writes spider output JSON to the import data volume.
# Cron runs with a minimal environment, so we explicitly export everything the
# scraper/spider need (output dir, cookie file, Puppeteer/chromium, PATH).
#
# On failure (non-zero exit, or the spider reporting an expired cookie / login
# redirect) the office is alerted via the running app's internal alert endpoint,
# which sends email (SendGrid) + in-app notifications. A persisted failure
# counter (on the /data volume) makes each failing night re-alert with the
# running "N nights in a row" count, and the first success after a streak sends
# a one-time "recovered" notice. Otherwise successful runs stay quiet.

export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

# crond runs jobs with a minimal env. The entrypoint persists the runtime secrets
# (alert token + overrides) to this file; source it so they're available here.
CRON_ENV_FILE="${CRON_ENV_FILE:-/etc/nightly-scrape.env}"
if [ -f "$CRON_ENV_FILE" ]; then
    # shellcheck disable=SC1090
    . "$CRON_ENV_FILE"
fi

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

# Where the running app listens (same container). Used to post failure alerts.
ALERT_URL="${SCRAPE_ALERT_URL:-http://localhost:${APP_INTERNAL_PORT:-5000}/api/internal/scrape-alert}"

# Persisted failure streak. The cron is stateless across runs, so we keep a
# tiny counter on the /data volume: it lets each failing night escalate the
# alert ("failing N days in a row") and lets the first success afterwards send a
# one-time "recovered" notice. Healthy runs that follow healthy runs touch this
# file but never notify, preserving the quiet-on-success behavior.
STATE_FILE="${SCRAPE_STATE_FILE:-/data/scrape-failure-count}"

read_failure_count() {
    local count=0
    if [ -f "$STATE_FILE" ]; then
        count="$(tr -dc '0-9' < "$STATE_FILE" 2>/dev/null)"
    fi
    [ -z "$count" ] && count=0
    echo "$count"
}

write_failure_count() {
    mkdir -p "$(dirname "$STATE_FILE")" 2>/dev/null
    echo "$1" > "$STATE_FILE" 2>/dev/null || \
        echo "# WARNING: could not write scrape state file $STATE_FILE"
}

# Helper: POST a JSON payload to the alert endpoint and log the result.
post_alert() {
    local payload="$1"
    local kind="$2"
    echo "# Sending $kind alert to $ALERT_URL"
    if [ -z "$INTERNAL_ALERT_TOKEN" ]; then
        echo "# WARNING: INTERNAL_ALERT_TOKEN is not set — the alert endpoint is disabled, no notification will be sent."
    fi
    local response
    response="$(curl -sS -m 30 -X POST "$ALERT_URL" \
        -H "Content-Type: application/json" \
        -H "X-Internal-Token: ${INTERNAL_ALERT_TOKEN}" \
        -d "$payload" 2>&1)"
    local rc=$?
    if [ $rc -eq 0 ]; then
        echo "# Alert endpoint response: $response"
    else
        echo "# WARNING: failed to reach alert endpoint (curl exit $rc): $response"
    fi
}

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

# Capture combined output so we can detect a login redirect and quote a tail of
# it in the failure alert, while still streaming everything to the cron log.
SCRAPE_OUTPUT="$(bash "$SCRIPT_DIR/migrate-site/scrape-registrations.sh" "$TODAY" "$DAYS_BACK" 2>&1)"
STATUS=$?
echo "$SCRAPE_OUTPUT"

echo "# Finished:  $(date) (exit $STATUS)"
echo "############################################################"

# Determine whether this run failed and why.
REASON=""
if [ $STATUS -ne 0 ]; then
    REASON="Scraper exited with status $STATUS"
fi
if echo "$SCRAPE_OUTPUT" | grep -qiE "Redirected to login|session cookie has expired"; then
    REASON="Session cookie expired (scraper was redirected to the login page). Refresh the cookie."
fi

PREV_FAILURES="$(read_failure_count)"

if [ -n "$REASON" ]; then
    # This run failed: bump the streak and send a (daily) alert that notes how
    # many consecutive nights it has now been failing.
    CONSECUTIVE=$((PREV_FAILURES + 1))
    write_failure_count "$CONSECUTIVE"
    echo "# Consecutive failure count: $CONSECUTIVE"

    # Quote the last 40 lines of output so the alert has actionable context.
    LOG_TAIL="$(echo "$SCRAPE_OUTPUT" | tail -n 40)"

    # Build a JSON payload safely (use python for proper escaping; fall back to
    # a minimal payload if python is unavailable).
    if command -v python3 >/dev/null 2>&1; then
        PAYLOAD="$(RUN_DATE="$TODAY" REASON="$REASON" LOG_TAIL="$LOG_TAIL" CONSECUTIVE="$CONSECUTIVE" python3 -c '
import json, os
print(json.dumps({
    "runDate": os.environ.get("RUN_DATE", ""),
    "reason": os.environ.get("REASON", ""),
    "logTail": os.environ.get("LOG_TAIL", ""),
    "consecutiveFailures": int(os.environ.get("CONSECUTIVE", "1") or "1"),
}))')"
    else
        PAYLOAD="{\"runDate\":\"$TODAY\",\"reason\":\"$REASON\",\"consecutiveFailures\":$CONSECUTIVE}"
    fi

    post_alert "$PAYLOAD" "failure"
else
    # This run succeeded. If we were in a failure streak, send a one-time
    # "recovered" notice, then reset the counter. Otherwise stay silent.
    if [ "$PREV_FAILURES" -gt 0 ]; then
        echo "# Scrape recovered after $PREV_FAILURES failed run(s) — sending recovery notice."
        if command -v python3 >/dev/null 2>&1; then
            PAYLOAD="$(RUN_DATE="$TODAY" PREV="$PREV_FAILURES" python3 -c '
import json, os
print(json.dumps({
    "runDate": os.environ.get("RUN_DATE", ""),
    "recovered": True,
    "consecutiveFailures": int(os.environ.get("PREV", "0") or "0"),
}))')"
        else
            PAYLOAD="{\"runDate\":\"$TODAY\",\"recovered\":true,\"consecutiveFailures\":$PREV_FAILURES}"
        fi
        post_alert "$PAYLOAD" "recovery"
    fi
    write_failure_count 0
fi

exit $STATUS
