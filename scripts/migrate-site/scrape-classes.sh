#!/bin/bash
# Scrape daily class lists by date, counting backwards from a start date.
#
# For each date it hits /admin/classes/?locationId=X&date=YYYY-MM-DD for every
# real location (IDs 1, 2, 4, 5, 6, 8, 11 — 3, 7, 9, 10 are empty/N/A slots).
# The spider then follows each class's "Class List" link
# (classlist/?scheduledClassId=N) so per-class enrollments are captured too.
#
# Usage:
#   ./scrape-classes.sh <start_date> <num_days>
#   ./scrape-classes.sh 10/02/2026 30
#
# Date format is DD/MM/YYYY (same as scrape-registrations.sh). Subtracts days
# going backwards. The classes URL itself uses YYYY-MM-DD; we convert.

if [ $# -lt 2 ]; then
    echo "Usage: $0 <start_date DD/MM/YYYY> <num_days>"
    echo "Example: $0 10/02/2026 30"
    exit 1
fi

START_DATE="$1"
NUM_DAYS="$2"
BASE_URL="https://mortys.drivetraqr.ca/admin/classes/"
LOCATION_IDS=(1 2 4 5 6 8 11)
SLEEP_SECONDS=30

# Log verbosity passthrough — same convention as scrape-registrations.sh.
SCRAPE_LOG_LEVEL="${SCRAPE_LOG_LEVEL:-}"
LOG_LEVEL_ARGS=()
if [ -n "$SCRAPE_LOG_LEVEL" ]; then
    export SCRAPE_LOG_LEVEL
    LOG_LEVEL_ARGS=(--log-level "$SCRAPE_LOG_LEVEL")
fi

echo "============================================================"
echo "Daily Class List Scraper"
echo "============================================================"
echo "Start date: $START_DATE (DD/MM/YYYY)"
echo "Days back:  $NUM_DAYS"
echo "Locations:  ${LOCATION_IDS[*]}"
echo "Sleep:      ${SLEEP_SECONDS}s between dates"
echo "Log level:  ${SCRAPE_LOG_LEVEL:-info (default)}"
echo "============================================================"
echo ""

for ((i=0; i<NUM_DAYS; i++)); do
    if [[ "$OSTYPE" == "darwin"* ]]; then
        ISO_DATE=$(date -j -v-${i}d -f "%d/%m/%Y" "$START_DATE" "+%Y-%m-%d")
    else
        PARSED=$(date -d "$(echo $START_DATE | awk -F/ '{print $3"-"$2"-"$1}')" "+%Y-%m-%d")
        ISO_DATE=$(date -d "$PARSED - $i days" "+%Y-%m-%d")
    fi

    echo "[$(($i + 1))/$NUM_DAYS] Date: $ISO_DATE"

    for LOC in "${LOCATION_IDS[@]}"; do
        URL="${BASE_URL}?locationId=${LOC}&date=${ISO_DATE}"
        echo "  Location $LOC: $URL"

        node "$(dirname "$0")/spider.js" "$URL" --max-pages 256 --delay 5000 "${LOG_LEVEL_ARGS[@]}"

        if [ $? -ne 0 ]; then
            echo "ERROR: Spider failed on $ISO_DATE (location $LOC). Stopping."
            exit 1
        fi
    done

    if [ $i -lt $(($NUM_DAYS - 1)) ]; then
        echo "  Sleeping ${SLEEP_SECONDS}s..."
        sleep $SLEEP_SECONDS
    fi

    echo ""
done

echo "============================================================"
echo "Done! Scraped $NUM_DAYS days of class lists."
echo "============================================================"
