#!/usr/bin/env bash
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT" || {
  echo "[setup-frontend] could not change to repository root: $ROOT" >&2
  exit 0
}

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo "[setup-frontend] node and npm are required to install the Vitest runner" >&2
  exit 1
fi

# Backend and frontend use the same repository dependency tree. Do not reinstall
# it when setup-backend.sh has already made the runner available.
if [ -x "$ROOT/node_modules/.bin/vitest" ] &&
  [ -d "$ROOT/node_modules/@vitest/coverage-v8" ]; then
  echo "[setup-frontend] Vitest and @vitest/coverage-v8 are already available"
  exit 0
fi

if [ -f "$ROOT/package-lock.json" ]; then
  npm ci
elif [ -f "$ROOT/package.json" ]; then
  npm install
else
  echo "[setup-frontend] package.json was not found; cannot install dependencies" >&2
  exit 0
fi
install_status=$?

if [ "$install_status" -ne 0 ]; then
  echo "[setup-frontend] dependency installation failed; frontend coverage will be skipped" >&2
  exit 0
fi

if [ -x "$ROOT/node_modules/.bin/vitest" ] &&
  [ -d "$ROOT/node_modules/@vitest/coverage-v8" ]; then
  echo "[setup-frontend] Vitest coverage runner is available"
else
  echo "[setup-frontend] Vitest or @vitest/coverage-v8 is unavailable; frontend coverage will be skipped" >&2
fi
exit 0