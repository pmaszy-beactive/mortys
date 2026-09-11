#!/usr/bin/env bash
set -uo pipefail

# Small behavioral checks for the CI wrappers. They use a fake local Vitest
# binary, so they never run application tests or touch this repository's
# reports/dependencies.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TMP_ROOT="$(mktemp -d)"
trap 'rm -rf "$TMP_ROOT"' EXIT

fail() {
  echo "[test-scripts] $1" >&2
  exit 1
}

mkdir -p "$TMP_ROOT/scripts/ci" "$TMP_ROOT/node_modules/.bin" \
  "$TMP_ROOT/node_modules/@vitest/coverage-v8" "$TMP_ROOT/client/src" \
  "$TMP_ROOT/run-from-here" "$TMP_ROOT/no-runner"
cp "$ROOT/scripts/ci/test-backend.sh" "$TMP_ROOT/scripts/ci/test-backend.sh"
cp "$ROOT/scripts/ci/test-frontend.sh" "$TMP_ROOT/scripts/ci/test-frontend.sh"
cp "$ROOT/scripts/ci/teardown.sh" "$TMP_ROOT/scripts/ci/teardown.sh"
chmod +x "$TMP_ROOT/scripts/ci/"*.sh

cat >"$TMP_ROOT/node_modules/.bin/vitest" <<'FAKE_VITEST'
#!/usr/bin/env bash
set -uo pipefail
printf '%s\n' "$PWD" >"$(cd "$(dirname "$0")/../.." && pwd)/fake-vitest-cwd"
report_dir=""
for argument in "$@"; do
  case "$argument" in
    --coverage.reportsDirectory=*) report_dir="${argument#*=}" ;;
  esac
done
if [ -n "$report_dir" ]; then
  mkdir -p "$report_dir"
  printf 'TN:\nSF:server/fake.ts\nDA:1,1\nend_of_record\n' >"$report_dir/lcov.info"
fi
exit "${FAKE_VITEST_EXIT:-0}"
FAKE_VITEST
chmod +x "$TMP_ROOT/node_modules/.bin/vitest"

# Non-root invocation still resolves and uses the repository root.
(
  cd "$TMP_ROOT/run-from-here" || exit 1
  "$TMP_ROOT/scripts/ci/test-backend.sh" >/dev/null 2>&1
) || fail "backend wrapper failed when called outside the repository root"
grep -qx "$TMP_ROOT" "$TMP_ROOT/fake-vitest-cwd" ||
  fail "backend wrapper did not run Vitest from the repository root"

# A missing runner is a warning, not a scanner-blocking error, and stale
# backend output is removed before the skipped run.
printf 'stale\n' >"$TMP_ROOT/lcov.info"
rm "$TMP_ROOT/node_modules/.bin/vitest"
set +e
missing_output="$(PATH="$TMP_ROOT/no-runner:/usr/bin:/bin" "$TMP_ROOT/scripts/ci/test-backend.sh" 2>&1)"
missing_status=$?
set -e
[ "$missing_status" -eq 0 ] || fail "missing backend runner returned $missing_status"
printf '%s\n' "$missing_output" | grep -qi 'not available' ||
  fail "missing backend runner did not emit a warning"
[ ! -e "$TMP_ROOT/lcov.info" ] || fail "stale backend report survived a skipped run"

# A red test run is also best-effort. Restore the fake runner and make it fail.
cp "$ROOT/scripts/ci/test-backend.sh" "$TMP_ROOT/scripts/ci/test-backend.sh"
cp "$ROOT/scripts/ci/test-frontend.sh" "$TMP_ROOT/scripts/ci/test-frontend.sh"
cat >"$TMP_ROOT/node_modules/.bin/vitest" <<'FAILING_VITEST'
#!/usr/bin/env bash
set -uo pipefail
exit 23
FAILING_VITEST
chmod +x "$TMP_ROOT/node_modules/.bin/vitest"
set +e
failure_output="$("$TMP_ROOT/scripts/ci/test-backend.sh" 2>&1)"
failure_status=$?
set -e
[ "$failure_status" -eq 0 ] || fail "red backend run returned $failure_status"
printf '%s\n' "$failure_output" | grep -q 'status 23' ||
  fail "red backend run did not emit its exit status"

# Frontend stale output is removed when its runner is unavailable.
mkdir -p "$TMP_ROOT/client/coverage"
printf 'stale\n' >"$TMP_ROOT/client/coverage/lcov.info"
mkdir -p "$TMP_ROOT/client/coverage/lcov-report"
printf 'stale\n' >"$TMP_ROOT/client/coverage/lcov-report/stale.html"
rm "$TMP_ROOT/node_modules/.bin/vitest"
PATH="$TMP_ROOT/no-runner:/usr/bin:/bin" "$TMP_ROOT/scripts/ci/test-frontend.sh" >/dev/null 2>&1 ||
  fail "missing frontend runner returned nonzero"
[ ! -e "$TMP_ROOT/client/coverage/lcov.info" ] ||
  fail "stale frontend report survived a skipped run"
[ ! -e "$TMP_ROOT/client/coverage/lcov-report/stale.html" ] ||
  fail "stale frontend HTML report survived a skipped run"

# Teardown removes only owned reports, preserving scanner configuration and
# installed dependencies.
printf 'generated\n' >"$TMP_ROOT/lcov.info"
mkdir -p "$TMP_ROOT/client/coverage"
printf 'generated\n' >"$TMP_ROOT/client/coverage/lcov.info"
mkdir -p "$TMP_ROOT/client/coverage/lcov-report"
printf 'generated\n' >"$TMP_ROOT/client/coverage/lcov-report/index.html"
printf 'keep\n' >"$TMP_ROOT/node_modules/keep"
printf 'keep\n' >"$TMP_ROOT/sonar-project.properties"
"$TMP_ROOT/scripts/ci/teardown.sh" >/dev/null 2>&1 ||
  fail "teardown returned nonzero"
[ ! -e "$TMP_ROOT/lcov.info" ] || fail "teardown kept root lcov.info"
[ ! -e "$TMP_ROOT/client/coverage/lcov.info" ] ||
  fail "teardown kept frontend lcov.info"
[ ! -e "$TMP_ROOT/client/coverage/lcov-report" ] ||
  fail "teardown kept frontend HTML coverage"
[ -e "$TMP_ROOT/node_modules/keep" ] || fail "teardown removed node_modules"
[ -e "$TMP_ROOT/sonar-project.properties" ] ||
  fail "teardown removed scanner configuration"

echo "[test-scripts] behavioral checks passed"