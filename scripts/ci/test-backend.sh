#!/usr/bin/env bash
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT" || {
  echo "[test-backend] could not change to repository root: $ROOT" >&2
  exit 0
}

# lcov.info is the owned Sonar input. Remove an older report first so a failed
# or skipped run cannot make the scanner consume stale coverage.
rm -f "$ROOT/lcov.info"
BACKEND_COVERAGE_DIR="$ROOT/.ci-coverage-backend"
rm -rf "$BACKEND_COVERAGE_DIR"

if [ -x "$ROOT/node_modules/.bin/vitest" ]; then
  VITEST_BIN="$ROOT/node_modules/.bin/vitest"
elif command -v vitest >/dev/null 2>&1; then
  VITEST_BIN="$(command -v vitest)"
else
  echo "[test-backend] Vitest is not available; skipping backend coverage" >&2
  exit 0
fi

if [ ! -d "$ROOT/node_modules/@vitest/coverage-v8" ]; then
  echo "[test-backend] @vitest/coverage-v8 is not available; skipping backend coverage" >&2
  exit 0
fi

# Do not glob all server tests: many of them intentionally exercise the live
# PostgreSQL database and create/delete UAT records. This explicit unit list
# contains only DB-free tests. In particular, incar-pairing.test.ts and
# incar-cancellation-fee.test.ts are excluded because their imported services
# initialize the database even though those tests assert pure helpers.
BACKEND_UNIT_TESTS=(
  server/tests/auto-course-payment.test.ts
  server/tests/booking-rules-daily-cap.test.ts
  server/tests/class-time.test.ts
  server/tests/class-type-classification.test.ts
  server/tests/curriculum-planner.test.ts
  server/tests/moto-booking-rules.test.ts
)

# Vitest refuses to clean the project root as its reports directory. Keep an
# isolated temporary directory, then move only lcov.info to the contract path.
NODE_ENV=test "$VITEST_BIN" run \
  --config "$ROOT/vitest.config.ts" \
  --coverage \
  --coverage.provider=v8 \
  --coverage.reporter=lcov \
  --coverage.reportsDirectory="$BACKEND_COVERAGE_DIR" \
  --coverage.reportOnFailure \
  --coverage.include=server/**/*.ts \
  --coverage.include=shared/**/*.ts \
  --coverage.exclude=server/tests/** \
  --coverage.exclude=**/*.test.ts \
  --coverage.exclude=**/*.test.tsx \
  --coverage.exclude=**/*.spec.ts \
  --coverage.exclude=**/*.spec.tsx \
  --coverage.exclude=**/test/** \
  --coverage.exclude=**/tests/** \
  --coverage.exclude=**/fixtures/** \
  --coverage.exclude=**/*setup.ts \
  --coverage.exclude=**/*setup.tsx \
  "${BACKEND_UNIT_TESTS[@]}"
test_status=$?

if [ "$test_status" -ne 0 ]; then
  echo "[test-backend] Vitest exited with status $test_status; continuing without failing the scanner" >&2
fi

if [ -s "$BACKEND_COVERAGE_DIR/lcov.info" ]; then
  mv -f "$BACKEND_COVERAGE_DIR/lcov.info" "$ROOT/lcov.info"
fi
rm -rf "$BACKEND_COVERAGE_DIR"

if [ -s "$ROOT/lcov.info" ]; then
  echo "[test-backend] Generated: $ROOT/lcov.info"
else
  echo "[test-backend] lcov.info was not produced; Sonar coverage may read as 0%" >&2
fi
exit 0