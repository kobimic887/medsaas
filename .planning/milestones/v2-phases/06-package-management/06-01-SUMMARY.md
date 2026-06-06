---
phase: 06-package-management
plan: 01
subsystem: infra
tags: [bun, package-management, lockfiles, npm-fallback, scripts]

# Dependency graph
requires:
  - phase: 05-server-runtime-on-bun
    provides: Bun-default server runtime scripts and Node fallback aliases
provides:
  - Root Bun-default install/dev/build/start script contract
  - Root npm/Node fallback aliases for install/dev/build/start script families
  - Dual-lockfile maintenance command for future dependency changes
  - Root npm fallback package-lock.json for the promoted concurrently devDependency
  - Bun lockfiles for root, client, and server package roots
affects: [06-02, phase-07-docker-ci-scripts, package-management]

# Tech tracking
tech-stack:
  added:
    - concurrently@^9.2.0 as a root devDependency
  patterns:
    - Bun is the default package runner; npm/Node fallback scripts use explicit :node aliases
    - Bun and npm lockfiles are regenerated together through lockfiles:refresh
    - Bun package-root commands use --cwd=<dir> for executable cross-root installs and runs

key-files:
  created:
    - bun.lock
    - package-lock.json
    - client/bun.lock
    - server/bun.lock
  modified:
    - package.json

key-decisions:
  - "Promoted concurrently to a root devDependency at ^9.2.0 so root dev/dev:bun/dev:node scripts no longer borrow client/node_modules/.bin/concurrently"
  - "Used Bun's executable --cwd=<dir> spelling for package-root commands because Bun 1.3.14 treats the planned space form as a script lookup for install"
  - "Retained client/package-lock.json and server/package-lock.json unchanged as npm fallback lockfiles"

patterns-established:
  - "Pattern 1: Bun-default root scripts with explicit npm/Node :node fallbacks for install, dev, build, and start"
  - "Pattern 2: dual lockfile maintenance through lockfiles:refresh whenever dependencies change"

requirements-completed: [PKG-01, PKG-02]

# Metrics
duration: 10min
completed: 2026-06-05
---

# Phase 06 Plan 01: Bun-Default Package Management Summary

**Bun-default package scripts with npm/Node fallback aliases and verified Bun plus npm lockfiles for root, client, and server package roots.**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-06-05T07:00:00Z
- **Completed:** 2026-06-05T07:09:25Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments

- Switched root `install:all`, `dev`, `build`, and `start` families to Bun defaults while preserving explicit npm/Node fallback aliases.
- Added `lockfiles:refresh` so future dependency changes regenerate Bun and npm lockfiles together.
- Promoted `concurrently` to a root devDependency at `^9.2.0`, retaining the existing client dependency.
- Generated and verified `bun.lock`, `client/bun.lock`, `server/bun.lock`, and root `package-lock.json`.
- Preserved Phase 7 scope: no Docker, CI, check/test migration, or Vite bundler replacement was introduced.

## Task Commits

Each task was committed atomically:

1. **Task 1: Convert root package scripts to Bun defaults with exact npm fallback aliases** - `9d2a234` (feat)
2. **Task 2: Generate Bun and npm fallback lockfiles for package roots** - `9792d21` (feat)

## Files Created/Modified

- `package.json` - Root script contract now defaults to Bun, includes npm/Node fallback aliases, adds `lockfiles:refresh`, and declares root `devDependencies.concurrently`.
- `package-lock.json` - Root npm fallback lockfile for the promoted root `concurrently` devDependency.
- `bun.lock` - Root Bun lockfile.
- `client/bun.lock` - Client Bun lockfile generated from the existing Vite/React package root.
- `server/bun.lock` - Server Bun lockfile generated from the existing Express package root.

## Decisions Made

- Root `concurrently` was added at `^9.2.0` as planned so root orchestration no longer depends on `client/node_modules/.bin/concurrently`.
- Bun package-root commands use `--cwd=<dir>` instead of the planned `--cwd <dir>` form because Bun 1.3.14 executes the equals form correctly for install paths.
- Existing `client/package-lock.json` and `server/package-lock.json` were retained as exact npm fallback artifacts.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed non-executable Bun `--cwd` script form**
- **Found during:** Task 2 (Generate Bun and npm fallback lockfiles for package roots)
- **Issue:** `bun run install:all` failed because Bun 1.3.14 treated `bun --cwd client install` as a script lookup and returned `Script not found "install"`.
- **Fix:** Updated root Bun script commands to use `bun --cwd=client ...` and `bun --cwd=server ...`; amended the Task 1 commit so the script contract remains atomic.
- **Files modified:** package.json
- **Verification:** Adjusted script assertions passed; `bun run install:all` succeeded; frozen Bun installs passed for root, client, and server.
- **Committed in:** 9d2a234 (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 - Bug)
**Impact on plan:** Required for executable Bun default scripts. No scope expansion beyond the planned package-management surface.

## Issues Encountered

- npm fallback installs completed but reported pre-existing audit findings in client and server dependency trees. No dependency versions were changed beyond the planned root `concurrently` promotion.

## User Setup Required

None - no external service configuration required.

## Verification

- `bun run install:all` passed.
- `bun install --frozen-lockfile` passed at the root.
- `bun --cwd=client install --frozen-lockfile` passed.
- `bun --cwd=server install --frozen-lockfile` passed.
- `npm ci --ignore-scripts` passed at the root.
- `npm --prefix client ci --ignore-scripts` passed.
- `npm --prefix server ci --ignore-scripts` passed.
- Script assertions passed for Bun defaults, npm/Node fallbacks, `lockfiles:refresh`, and root `concurrently`.
- Lockfile assertions passed for root/client/server npm lockfile version 3 and expected dependency entries.

## Next Phase Readiness

- Plan 06-02 can document the Bun-default command contract and run the Bun-invoked Vite/static-serving verification for PKG-03.
- Phase 7 can build on the Bun install artifacts and script aliases when Docker, CI, and check/test migration are in scope.

## Known Stubs

None - no UI stubs, placeholder rendering, or mock data paths introduced.

## Threat Flags

None - no new network endpoints, auth paths, file access patterns, or schema changes introduced. Package script and lockfile supply-chain surfaces were covered by the plan threat model and verified.

## Self-Check: PASSED

- [x] `.planning/phases/06-package-management/06-01-SUMMARY.md` exists
- [x] `package.json` contains the Bun-default script contract and root `concurrently`
- [x] `bun.lock` exists
- [x] `package-lock.json` exists
- [x] `client/bun.lock` exists
- [x] `server/bun.lock` exists
- [x] Commits `9d2a234` and `9792d21` confirmed in git log

---
*Phase: 06-package-management*
*Completed: 2026-06-05*
