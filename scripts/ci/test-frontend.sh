#!/usr/bin/env bash
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT" || {
  echo "[test-frontend] could not change to repository root: $ROOT" >&2
  exit 0
}

# Remove stale output before running. This keeps a skipped/red run from
# accidentally uploading a previous scan's frontend coverage.
rm -f "$ROOT/client/coverage/lcov.info"
rm -rf "$ROOT/client/coverage/lcov-report"

if [ ! -d "$ROOT/client/src" ]; then
  echo "[test-frontend] client/src is not present; skipping frontend coverage" >&2
  exit 0
fi

if [ -x "$ROOT/node_modules/.bin/vitest" ]; then
  VITEST_BIN="$ROOT/node_modules/.bin/vitest"
elif command -v vitest >/dev/null 2>&1; then
  VITEST_BIN="$(command -v vitest)"
else
  echo "[test-frontend] Vitest is not available; skipping frontend coverage" >&2
  exit 0
fi

if [ ! -d "$ROOT/node_modules/@vitest/coverage-v8" ]; then
  echo "[test-frontend] @vitest/coverage-v8 is not available; skipping frontend coverage" >&2
  exit 0
fi

FRONTEND_TESTS=()
while IFS= read -r test_file; do
  FRONTEND_TESTS+=("$test_file")
done < <(find "$ROOT/client/src" -type f \( -name '*.test.ts' -o -name '*.test.tsx' \) -print | sort)

if [ "${#FRONTEND_TESTS[@]}" -eq 0 ]; then
  echo "[test-frontend] no frontend test files were found; skipping frontend coverage" >&2
  exit 0
fi

mkdir -p "$ROOT/client/coverage"
NODE_ENV=test "$VITEST_BIN" run \
  --config "$ROOT/vitest.config.ts" \
  --coverage \
  --coverage.provider=v8 \
  --coverage.reporter=lcov \
  --coverage.reportsDirectory="$ROOT/client/coverage" \
  --coverage.reportOnFailure \
  --coverage.include=client/src/**/*.ts \
  --coverage.include=client/src/**/*.tsx \
  --coverage.exclude=**/*.test.ts \
  --coverage.exclude=**/*.test.tsx \
  --coverage.exclude=**/*.spec.ts \
  --coverage.exclude=**/*.spec.tsx \
  --coverage.exclude=**/test/** \
  --coverage.exclude=**/tests/** \
  --coverage.exclude=**/fixtures/** \
  --coverage.exclude=**/*setup.ts \
  --coverage.exclude=**/*setup.tsx \
  "${FRONTEND_TESTS[@]}"
test_status=$?

if [ "$test_status" -ne 0 ]; then
  echo "[test-frontend] Vitest exited with status $test_status; continuing without failing the scanner" >&2
fi

if [ -s "$ROOT/client/coverage/lcov.info" ]; then
  echo "[test-frontend] Generated: $ROOT/client/coverage/lcov.info"
else
  echo "[test-frontend] lcov.info was not produced; Sonar coverage may read as 0%" >&2
fi
exit 0