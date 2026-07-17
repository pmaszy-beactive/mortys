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

# Scraper log verbosity / resilience. Leaving SCRAPE_LOG_LEVEL unset keeps the
# spider at its default `info` level so the nightly log stays readable; an
# operator can temporarily raise detail for nightly by setting SCRAPE_LOG_LEVEL
# (e.g. debug) in the container/cron environment without code edits. spider.js
# reads both directly. SCRAPE_LOG_LEVEL is only exported when set so the spider's
# own default applies otherwise.
[ -n "${SCRAPE_LOG_LEVEL:-}" ] && export SCRAPE_LOG_LEVEL

# Same --log-level passthrough the registration scrape uses, so the queue drain
# (which we invoke directly here, not via scrape-registrations.sh) honors it too.
LOG_LEVEL_ARGS=()
if [ -n "${SCRAPE_LOG_LEVEL:-}" ]; then
    LOG_LEVEL_ARGS=(--log-level "$SCRAPE_LOG_LEVEL")
fi

# Navigation resilience: default the nightly run to 2 retries (3 attempts per
# page, with backoff) so a transient timeout doesn't silently drop a page from
# the import. Retries only fire on failure, so a healthy run isn't slowed. An
# operator can override (e.g. SCRAPE_MAX_RETRIES=0 to restore single-attempt
# behavior). spider.js also defaults to 2, but we set it explicitly here so the
# nightly policy is visible and independent of the code default.
export SCRAPE_MAX_RETRIES="${SCRAPE_MAX_RETRIES:-2}"

# --- Log rotation ----------------------------------------------------------
# Cron invokes this script with no stdout redirect; we own our own logging so
# we can rotate before writing. Logs live on the /data volume and would
# otherwise grow unbounded over months of nightly runs. We keep a fixed number
# of size-capped, numbered backups (.1 .. .N) and prune the rest, via the
# shared rotate_log helper. Two logs are rotated here: this script's own run
# log, and the cron daemon's log (crond.log) — the nightly cron is the natural
# place to size-cap crond.log, which also lives on /data and otherwise grows
# forever (one line per scheduled run).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
. "$SCRIPT_DIR/rotate-log.sh"

LOG_DIR="${NIGHTLY_LOG_DIR:-/data/logs}"
LOG_FILE="$LOG_DIR/nightly-scrape.log"
LOG_MAX_BYTES="${NIGHTLY_LOG_MAX_BYTES:-5242880}"   # rotate when log exceeds 5 MB
LOG_KEEP="${NIGHTLY_LOG_KEEP:-7}"                     # keep this many old logs (.1 .. .N)

mkdir -p "$LOG_DIR"

# Rotate the cron daemon's own log (written by `crond -L`). BusyBox crond
# reopens its log per write, so an mv-based rotation is safe — the next logged
# run recreates a fresh crond.log. Defaults track our run log's policy.
CROND_LOG_FILE="${CROND_LOG_FILE:-$LOG_DIR/crond.log}"
rotate_log "$CROND_LOG_FILE" "${CROND_LOG_MAX_BYTES:-$LOG_MAX_BYTES}" "${CROND_LOG_KEEP:-$LOG_KEEP}"

# Rotate our own run log, then send all stdout/stderr to the (possibly freshly
# rotated) log.
rotate_log "$LOG_FILE" "$LOG_MAX_BYTES" "$LOG_KEEP"
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

DAYS_BACK=7
TODAY="$(date '+%d/%m/%Y')"

# Targeted-student priority queue. Filled on demand by
# server/scripts/build-scrape-queue.ts; drained here (via the spider) BEFORE the
# usual registration scrape so on-request students land first. Path defaults to
# the persistent volume and is overridable via SCRAPE_QUEUE_FILE, consistent
# with the other scraper paths.
QUEUE_FILE="${SCRAPE_QUEUE_FILE:-$MIGRATE_OUTPUT_DIR/scrape-queue.txt}"
QUEUE_MAX_PAGES="${SCRAPE_QUEUE_MAX_PAGES:-2000}"

echo ""
echo "############################################################"
echo "# Nightly registration scrape"
echo "# Started:   $(date)"
echo "# Start date: $TODAY (DD/MM/YYYY), days back: $DAYS_BACK"
echo "# Output:    $MIGRATE_OUTPUT_DIR"
echo "# Queue file: $QUEUE_FILE"
echo "############################################################"

# --- Step 1: drain the targeted-student queue first (if non-empty) ----------
# The spider crawls each queued student as a full record and removes successful
# entries from the queue file; failures stay queued for the next run.
QUEUE_OUTPUT=""
QUEUE_STATUS=0
QUEUE_COOKIE_EXPIRED=0
if [ -s "$QUEUE_FILE" ]; then
    echo "# Draining targeted-student queue ($(grep -c . "$QUEUE_FILE" 2>/dev/null) entr(ies))..."
    QUEUE_OUTPUT="$(node "$SCRIPT_DIR/migrate-site/spider.js" --queue-file "$QUEUE_FILE" --max-pages "$QUEUE_MAX_PAGES" --delay 5000 "${LOG_LEVEL_ARGS[@]}" 2>&1)"
    QUEUE_STATUS=$?
    echo "$QUEUE_OUTPUT"
    if echo "$QUEUE_OUTPUT" | grep -qiE "Redirected to login|session cookie has expired"; then
        QUEUE_COOKIE_EXPIRED=1
    fi
else
    echo "# Targeted-student queue is empty — skipping queue drain."
fi

# --- Step 2: the usual last-7-days registration scrape ----------------------
# If the queue drain already proved the cookie is expired, skip the registration
# scrape (it would only fail the same way) and report the expiry below.
if [ "$QUEUE_COOKIE_EXPIRED" -eq 1 ]; then
    SCRAPE_OUTPUT="(skipped registration scrape — the queue drain hit an expired session)"
    STATUS=1
else
    # Capture combined output so we can detect a login redirect and quote a tail
    # of it in the failure alert, while still streaming everything to the cron log.
    SCRAPE_OUTPUT="$(bash "$SCRIPT_DIR/migrate-site/scrape-registrations.sh" "$TODAY" "$DAYS_BACK" 2>&1)"
    STATUS=$?
    echo "$SCRAPE_OUTPUT"
fi

# A failed queue drain counts as a failed run even if it didn't expire the cookie.
if [ "$QUEUE_STATUS" -ne 0 ] && [ "$STATUS" -eq 0 ]; then
    STATUS="$QUEUE_STATUS"
fi

echo "# Finished:  $(date) (exit $STATUS)"
echo "############################################################"

# Combined output (queue drain + registration scrape) for reason detection and
# the alert log tail.
COMBINED_OUTPUT="$QUEUE_OUTPUT
$SCRAPE_OUTPUT"

# Determine whether this run failed and why.
REASON=""
if [ $STATUS -ne 0 ]; then
    REASON="Scraper exited with status $STATUS"
fi
if echo "$COMBINED_OUTPUT" | grep -qiE "Redirected to login|session cookie has expired"; then
    REASON="Session cookie expired (scraper was redirected to the login page). Refresh the cookie."
fi

# --- Skipped-page detection --------------------------------------------------
# The spider retries + re-queues flaky pages, but if it still gives up it only
# logs a "SKIPPING <url> ... MISSING from the scrape" line and a run-summary
# count — the run can exit 0 with pages silently missing. Sum the summary
# counts from every spider invocation (queue drain + registration scrape); if
# no summary line is present (e.g. the run died early), fall back to counting
# the individual SKIPPING lines.
SKIPPED_PAGES="$(echo "$COMBINED_OUTPUT" \
    | grep -oE "Pages SKIPPED after exhausting retries/re-queues: [0-9]+" \
    | grep -oE "[0-9]+" \
    | awk '{s+=$1} END {print s+0}')"
if [ "${SKIPPED_PAGES:-0}" -eq 0 ]; then
    SKIPPED_PAGES="$(echo "$COMBINED_OUTPUT" | grep -c "SKIPPING ")"
fi
[ -z "$SKIPPED_PAGES" ] && SKIPPED_PAGES=0
if [ "$SKIPPED_PAGES" -gt 0 ]; then
    echo "# Skipped pages detected in this run: $SKIPPED_PAGES"
fi

# --- Abandoned-page detection -------------------------------------------------
# The spider caps per-URL queue retries (SCRAPE_QUEUE_MAX_FAILURES, default 5
# consecutive failed nights). When a URL hits the cap it is dropped from the
# queue file for good and logged as "ABANDONED <url> ...". Because the entry is
# removed, this alert fires exactly once per URL — count those lines so the
# office gets a one-time "gave up on <url>" notice instead of nightly reminders
# forever.
# Match only the per-URL lines ("ABANDONED http..."), not the run-summary
# line ("Pages ABANDONED (...): N"), so the count is accurate.
ABANDONED_PAGES="$(echo "$COMBINED_OUTPUT" | grep -c "ABANDONED http")"
[ -z "$ABANDONED_PAGES" ] && ABANDONED_PAGES=0
if [ "$ABANDONED_PAGES" -gt 0 ]; then
    echo "# Abandoned pages (dropped from the retry queue) in this run: $ABANDONED_PAGES"
fi

PREV_FAILURES="$(read_failure_count)"

if [ -n "$REASON" ]; then
    # This run failed: bump the streak and send a (daily) alert that notes how
    # many consecutive nights it has now been failing.
    CONSECUTIVE=$((PREV_FAILURES + 1))
    write_failure_count "$CONSECUTIVE"
    echo "# Consecutive failure count: $CONSECUTIVE"

    # Quote the last 40 lines of output (queue drain + registration scrape) so
    # the alert has actionable context. If any URLs were permanently abandoned
    # this run, prepend those lines — the tail alone might scroll past them.
    LOG_TAIL="$(echo "$COMBINED_OUTPUT" | tail -n 40)"
    if [ "$ABANDONED_PAGES" -gt 0 ]; then
        ABANDONED_LINES="$(echo "$COMBINED_OUTPUT" | grep "ABANDONED http" | tail -n 40)"
        LOG_TAIL="$ABANDONED_LINES

$LOG_TAIL"
    fi

    # Build a JSON payload safely (use python for proper escaping; fall back to
    # a minimal payload if python is unavailable).
    if command -v python3 >/dev/null 2>&1; then
        PAYLOAD="$(RUN_DATE="$TODAY" REASON="$REASON" LOG_TAIL="$LOG_TAIL" CONSECUTIVE="$CONSECUTIVE" SKIPPED="$SKIPPED_PAGES" ABANDONED="$ABANDONED_PAGES" python3 -c '
import json, os
print(json.dumps({
    "runDate": os.environ.get("RUN_DATE", ""),
    "reason": os.environ.get("REASON", ""),
    "logTail": os.environ.get("LOG_TAIL", ""),
    "consecutiveFailures": int(os.environ.get("CONSECUTIVE", "1") or "1"),
    "skippedPages": int(os.environ.get("SKIPPED", "0") or "0"),
    "abandonedPages": int(os.environ.get("ABANDONED", "0") or "0"),
}))')"
    else
        PAYLOAD="{\"runDate\":\"$TODAY\",\"reason\":\"$REASON\",\"consecutiveFailures\":$CONSECUTIVE,\"skippedPages\":$SKIPPED_PAGES,\"abandonedPages\":$ABANDONED_PAGES}"
    fi

    post_alert "$PAYLOAD" "failure"
elif [ "$SKIPPED_PAGES" -gt 0 ]; then
    # The run exited cleanly but the spider still gave up on one or more pages
    # after exhausting retries/re-queues — those pages are missing from
    # tonight's data. Alert the office (email + in-app) so the gap isn't
    # silent. This does NOT count toward the failure streak: the streak (and
    # its recovery notice) tracks hard failures like an expired cookie, while
    # each night with skips sends its own fresh alert anyway.
    REASON="Scrape completed but $SKIPPED_PAGES page(s) were skipped after exhausting retries — they are missing from tonight's data. The skipped pages have been added to the scrape queue and will be re-fetched automatically on the next nightly run."
    if [ "$ABANDONED_PAGES" -gt 0 ]; then
        REASON="$REASON $ABANDONED_PAGES page(s) hit the retry cap and were permanently removed from the queue — they will NOT be retried automatically."
    fi
    echo "# Run succeeded with $SKIPPED_PAGES skipped page(s) — sending skipped-pages alert."

    # Quote the SKIPPING lines themselves (they name the missing URLs) so the
    # alert is actionable; cap at 40 lines like the failure log tail. ABANDONED
    # lines go first — they name the URLs that will never be retried again.
    LOG_TAIL="$(echo "$COMBINED_OUTPUT" | grep -E "ABANDONED http|SKIPPING " | tail -n 40)"

    if command -v python3 >/dev/null 2>&1; then
        PAYLOAD="$(RUN_DATE="$TODAY" REASON="$REASON" LOG_TAIL="$LOG_TAIL" SKIPPED="$SKIPPED_PAGES" ABANDONED="$ABANDONED_PAGES" python3 -c '
import json, os
print(json.dumps({
    "runDate": os.environ.get("RUN_DATE", ""),
    "reason": os.environ.get("REASON", ""),
    "logTail": os.environ.get("LOG_TAIL", ""),
    "skippedPages": int(os.environ.get("SKIPPED", "0") or "0"),
    "abandonedPages": int(os.environ.get("ABANDONED", "0") or "0"),
    "skippedOnly": True,
}))')"
    else
        PAYLOAD="{\"runDate\":\"$TODAY\",\"reason\":\"$REASON\",\"skippedPages\":$SKIPPED_PAGES,\"abandonedPages\":$ABANDONED_PAGES,\"skippedOnly\":true}"
    fi

    post_alert "$PAYLOAD" "skipped-pages"

    # A skip-only run still counts as a success for the hard-failure streak:
    # send the recovery notice if we were failing, then reset the counter.
    if [ "$PREV_FAILURES" -gt 0 ]; then
        echo "# Scrape recovered after $PREV_FAILURES failed run(s) — sending recovery notice."
        if command -v python3 >/dev/null 2>&1; then
            RECOVERY_PAYLOAD="$(RUN_DATE="$TODAY" PREV="$PREV_FAILURES" python3 -c '
import json, os
print(json.dumps({
    "runDate": os.environ.get("RUN_DATE", ""),
    "recovered": True,
    "consecutiveFailures": int(os.environ.get("PREV", "0") or "0"),
}))')"
        else
            RECOVERY_PAYLOAD="{\"runDate\":\"$TODAY\",\"recovered\":true,\"consecutiveFailures\":$PREV_FAILURES}"
        fi
        post_alert "$RECOVERY_PAYLOAD" "recovery"
    fi
    write_failure_count 0
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
