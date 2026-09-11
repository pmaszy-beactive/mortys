#!/usr/bin/env bash
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT" || {
  echo "[teardown] could not change to repository root; nothing was removed" >&2
  exit 0
}

# Only remove reports owned by these wrappers. In particular, leave
# node_modules, package files, scanner configuration, and any other user files
# untouched.
rm -f "$ROOT/lcov.info"
rm -f "$ROOT/client/coverage/lcov.info"
rm -rf "$ROOT/client/coverage/lcov-report"
rm -rf "$ROOT/.ci-coverage-backend"

# Avoid leaving an empty generated directory, while preserving it if a caller
# placed another file there.
if [ -d "$ROOT/client/coverage" ]; then
  rmdir "$ROOT/client/coverage" 2>/dev/null || true
fi
exit 0