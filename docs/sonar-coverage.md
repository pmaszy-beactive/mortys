# SonarQube coverage integration

The repository's CI coverage wrappers use Vitest's JavaScript/TypeScript
`lcov` reporter. The scanner must read both reports with this exact property:

```properties
sonar.javascript.lcov.reportPaths=lcov.info,client/coverage/lcov.info
```

There is intentionally no `coverage.xml` output: this is a TypeScript/Vitest
project, so the JavaScript/TypeScript LCOV property above is the
Sonar-compatible format.

## Scanner ordering

Before invoking `sonar-scanner`, a caller can use the wrappers without knowing
anything about Vitest:

```bash
PROJECT_ROOT="$(pwd)"

[ -x "$PROJECT_ROOT/scripts/ci/setup-backend.sh" ] &&
  "$PROJECT_ROOT/scripts/ci/setup-backend.sh" || true
[ -x "$PROJECT_ROOT/scripts/ci/test-backend.sh" ] &&
  "$PROJECT_ROOT/scripts/ci/test-backend.sh" || true

[ -x "$PROJECT_ROOT/scripts/ci/setup-frontend.sh" ] &&
  "$PROJECT_ROOT/scripts/ci/setup-frontend.sh" || true
[ -x "$PROJECT_ROOT/scripts/ci/test-frontend.sh" ] &&
  "$PROJECT_ROOT/scripts/ci/test-frontend.sh" || true

sonar-scanner

# Run after the scanner has posted its result, not before.
[ -x "$PROJECT_ROOT/scripts/ci/teardown.sh" ] &&
  "$PROJECT_ROOT/scripts/ci/teardown.sh" || true
```

The wrappers are best effort: unavailable runners and red test runs produce a
warning and leave the scanner usable, while a missing `node`/`npm` package
manager is reported by setup as a nonzero setup error.

## Test scope and output

| Script | Scope / output |
| --- | --- |
| `setup-backend.sh` | Installs the locked npm dependencies if Vitest or its coverage provider is missing |
| `test-backend.sh` | Database-free backend unit suites; root `lcov.info` |
| `setup-frontend.sh` | Uses the same root npm dependency tree |
| `test-frontend.sh` | Existing client tests; `client/coverage/lcov.info` |
| `teardown.sh` | Removes generated coverage only; preserves dependencies and scanner configuration |

The backend wrapper explicitly selects the payment, daily-cap rules, class-time,
class-type classification, curriculum planner, and motorcycle booking-rules unit
suites. It does **not** run the full backend test suite. Database integration
tests are excluded to avoid creating or deleting records in a connected UAT
database. The pairing and cancellation-fee helper tests are also excluded
because their service imports initialize the database. Add new database-free
unit suites to `BACKEND_UNIT_TESTS` in `test-backend.sh`.

Coverage includes untested production files in `server/` and `shared/`, so these
unit tests do not imply full backend coverage. Frontend coverage includes
production files in `client/src/`. Tests, fixtures, and test setup are excluded.

Run the script-contract checks with:

```bash
./scripts/ci/test-scripts.sh
```

These wrappers intentionally return success after recoverable failures, as
required by the supplied contract. They are coverage collectors, not a
replacement for a separate CI test job that fails when tests fail.