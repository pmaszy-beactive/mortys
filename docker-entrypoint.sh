#!/bin/sh
set -e

echo "=== Morty's Driving School — Starting ==="

echo "[1/2] Running database migrations..."
node dist/migrate.js

echo "[2/2] Starting application..."
exec node dist/index.js
