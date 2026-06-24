#!/bin/bash
# Scrape registration reports by date, counting backwards from a start date.
#
# Usage:
#   ./scrape-registrations.sh <start_date> <num_days>
#   ./scrape-registrations.sh 10/02/2026 30
#
# Date format is DD/MM/YYYY. Subtracts days going backwards.
# Example: 10/02/2026 with 5 days = 10/02, 09/02, 08/02, 07/02, 06/02

if [ $# -lt 2 ]; then
    echo "Usage: $0 <start_date DD/MM/YYYY> <num_days>"
    echo "Example: $0 10/02/2026 30"
    exit 1
fi

START_DATE="$1"
NUM_DAYS="$2"
BASE_URL="https://mortys.drivetraqr.ca/admin/reports/registrations/"
SLEEP_SECONDS=30

echo "============================================================"
echo "Registration Report Scraper"
echo "============================================================"
echo "Start date: $START_DATE (DD/MM/YYYY)"
echo "Days back:  $NUM_DAYS"
echo "Sleep:      ${SLEEP_SECONDS}s between requests"
echo "============================================================"
echo ""

for ((i=0; i<NUM_DAYS; i++)); do
    if [[ "$OSTYPE" == "darwin"* ]]; then
        CURRENT_DATE=$(date -j -v-${i}d -f "%d/%m/%Y" "$START_DATE" "+%d/%m/%Y")
    else
        PARSED=$(date -d "$(echo $START_DATE | awk -F/ '{print $3"-"$2"-"$1}')" "+%Y-%m-%d")
        CURRENT_DATE=$(date -d "$PARSED - $i days" "+%d/%m/%Y")
    fi

    ENCODED_DATE=$(echo "$CURRENT_DATE" | sed 's|/|%2F|g')
    URL="${BASE_URL}?date=${ENCODED_DATE}"

    echo "[$(($i + 1))/$NUM_DAYS] Date: $CURRENT_DATE"
    echo "  URL: $URL"

    node "$(dirname "$0")/spider.js" "$URL" --max-pages 256 --delay 5000

    if [ $? -ne 0 ]; then
        echo "ERROR: Spider failed on $CURRENT_DATE. Stopping."
        exit 1
    fi

    if [ $i -lt $(($NUM_DAYS - 1)) ]; then
        echo "  Sleeping ${SLEEP_SECONDS}s..."
        sleep $SLEEP_SECONDS
    fi

    echo ""
done

echo "============================================================"
echo "Done! Scraped $NUM_DAYS days of registration reports."
echo "============================================================"
