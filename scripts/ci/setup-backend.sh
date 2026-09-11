#!/usr/bin/env bash
set -uo pipefail

# This script deliberately resolves the repository from its own location so it
# can be called from a scanner, a CI checkout, or any other working directory.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT" || {
  echo "[setup-backend] could not change to repository root: $ROOT" >&2
  exit 0
}

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo "[setup-backend] node and npm are required to install the Vitest runner" >&2
  exit 1
fi

# Keep an existing dependency tree intact. npm ci is intentionally only used
# when the runner or its coverage provider is missing.
if [ -x "$ROOT/node_modules/.bin/vitest" ] &&
  [ -d "$ROOT/node_modules/@vitest/coverage-v8" ]; then
  echo "[setup-backend] Vitest and @vitest/coverage-v8 are already available"
  exit 0
fi

if [ -f "$ROOT/package-lock.json" ]; then
  npm ci
elif [ -f "$ROOT/package.json" ]; then
  npm install
else
  echo "[setup-backend] package.json was not found; cannot install dependencies" >&2
  exit 0
fi
install_status=$?

if [ "$install_status" -ne 0 ]; then
  echo "[setup-backend] dependency installation failed; backend coverage will be skipped" >&2
  exit 0
fi

if [ -x "$ROOT/node_modules/.bin/vitest" ] &&
  [ -d "$ROOT/node_modules/@vitest/coverage-v8" ]; then
  echo "[setup-backend] Vitest coverage runner is available"
else
  echo "[setup-backend] Vitest or @vitest/coverage-v8 is unavailable; backend coverage will be skipped" >&2
fi
exit 0