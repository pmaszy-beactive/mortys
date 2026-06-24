#!/bin/sh
set -e

echo "=== Morty's Driving School — Starting ==="

# Ensure the import data volume exists (scraper output + dedup state + cookie).
IMPORT_DIR="${IMPORT_DATA_DIR:-/data/migrate}"
mkdir -p "$IMPORT_DIR"
echo "[import] Data dir: $IMPORT_DIR"

echo "[1/2] Running database migrations..."
node dist/migrate.js

echo "[2/2] Starting application..."
exec node dist/index.js
