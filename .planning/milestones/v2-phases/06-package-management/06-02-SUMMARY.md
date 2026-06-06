---
phase: 06-package-management
plan: 02
subsystem: infra
tags: [bun, package-management, vite, static-serving, docs, npm-fallback]

# Dependency graph
requires:
  - phase: 06-package-management
    provides: Bun-default root scripts and dual lockfiles from Plan 01
  - phase: 05-server-runtime-on-bun
    provides: Bun unified server runtime and runtime smoke harness with --assert-static
provides:
  - Developer docs for Bun-default install/dev/build/start commands
  - npm/Node fallback command documentation for install/dev/build/start
  - Dual-lockfile maintenance rule for root, client, and server package roots
  - PKG-03 verification report proving Bun-invoked Vite build and Bun static serving
affects: [phase-07-docker-ci-scripts, package-management, developer-docs]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Bun defaults are documented first, with npm/Node fallback aliases immediately nearby
    - Vite remains the client bundler while Bun acts as package runner
    - Package-management verification reports record commands and assertions without full terminal logs

key-files:
  created:
    - .planning/phases/06-package-management/BUN-PACKAGE-MANAGEMENT.md
  modified:
    - README.md
    - CLAUDE.md

key-decisions:
  - "Bun defaults are now the documented root commands for install, dev, build, and start; npm/Node fallbacks use explicit :node aliases"
  - "Dual lockfile maintenance is documented for root, client, and server: run bun run lockfiles:refresh and commit Bun plus npm lockfiles together"
  - "PKG-03 keeps Vite as the client bundler; bun run build invokes the existing client vite build through Bun's package runner"

patterns-established:
  - "Pattern 1: command docs present Bun defaults first and npm/Node fallback commands second for every supported workflow"
  - "Pattern 2: verification reports capture command names, lockfile inventory, retained-tool assertions, and smoke outcomes"

requirements-completed: [PKG-02, PKG-03]

# Metrics
duration: 23min
completed: 2026-06-05
---

# Phase 06 Plan 02: Developer Docs and Bun Build Verification Summary

**Bun-default package-management documentation plus PKG-03 proof that Bun invokes the retained Vite build and the Bun unified server serves the built frontend.**

## Performance

- **Duration:** ~23 min
- **Started:** 2026-06-05T07:17:27Z
- **Completed:** 2026-06-05T07:40:00Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments

- Updated README local setup and package-management guidance so `bun run install:all`, `bun run dev`, `bun run build`, and `bun run start` are the documented defaults.
- Added exact npm/Node fallback commands beside the defaults: `npm run install:all:node`, `npm run dev:node`, `npm run build:node`, and `npm run start:node`.
- Documented the D-01/D-02 lockfile rule: root, `client/`, and `server/` keep both `bun.lock` and `package-lock.json`; dependency changes run `bun run lockfiles:refresh` and commit both families together.
- Updated CLAUDE.md command guidance with the same Bun-default and npm/Node fallback contract.
- Created `BUN-PACKAGE-MANAGEMENT.md` with lockfile inventory, script contract, PKG-03 Vite build result, static-serving smoke result, and fallback build result.

## Task Commits

Each task was committed atomically:

1. **Task 1: Update developer command docs for Bun defaults and npm/Node fallbacks** - `f4553f9` (docs)
2. **Task 2: Verify Bun-invoked Vite build and static serving, then record results** - `69effe6` (docs)

## Files Created/Modified

- `README.md` - Developer-facing Bun-default setup, build/start commands, npm/Node fallbacks, Vite-retained note, Phase 7 scope note, and dual-lockfile maintenance rule.
- `CLAUDE.md` - Agent/developer command guidance updated to Bun defaults, npm/Node fallbacks, retained Vite bundler, Phase 7 scope, and lockfile refresh rule.
- `.planning/phases/06-package-management/BUN-PACKAGE-MANAGEMENT.md` - Phase 6 package-management verification report for PKG-03 and related script/lockfile contract.

## Decisions Made

- Bun defaults are documented as the first command path for install, dev, build, and start; npm/Node fallback commands are documented immediately nearby.
- Vite remains the build tool for PKG-03. `bun run build` is treated as a Bun package-runner path into the existing `vite build`, not a bundler replacement.
- Docker, CI, `check`, and test script migration remain out of Phase 6 and explicitly deferred to Phase 7.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- The first `--assert-static` smoke attempt failed before server startup because the ephemeral `mongodb-memory-server` process exceeded its 10s startup timeout. The same required command passed on retry with 15/15 checks. No code or harness changes were made.

## User Setup Required

None - no external service configuration required.

## Verification

- `grep -q "bun run install:all" README.md && grep -q "npm run install:all:node" README.md && grep -q "bun run lockfiles:refresh" README.md && grep -q "bun run build" README.md && grep -q "npm run build:node" README.md && grep -q "bun run install:all" CLAUDE.md && grep -q "npm run install:all:node" CLAUDE.md && grep -q "bun run dev" CLAUDE.md && grep -q "npm run dev:node" CLAUDE.md` passed.
- `bun run build` passed and invoked `bun --cwd=client run build`, then `vite build`.
- `FRONTEND_DIST=../client/dist SERVER_RUNTIME=bun bun --cwd=server run test:runtime-smoke -- --assert-static` passed on retry with 15/15 checks, including `GET / returns 200` and `GET / returns HTML`.
- `npm run build:node` passed and invoked the npm fallback Vite build.
- `test -f .planning/phases/06-package-management/BUN-PACKAGE-MANAGEMENT.md && grep -q "PKG-03" ... && grep -q "Vite retained" ... && grep -q -- "--assert-static" ... && grep -q "GET / returns 200" ... && grep -q "GET / returns HTML" ...` passed.

## Next Phase Readiness

- Phase 7 can consume the documented script contract and lockfile inventory when migrating Docker, CI/CD, `check`, and test scripts.
- PKG-03 is now observable through the committed verification report and existing static-serving smoke harness.

## Known Stubs

None - no UI stubs, placeholder rendering, or mock data paths introduced.

## Threat Flags

None - no new network endpoints, auth paths, file access patterns, or schema changes introduced. Documentation command paths, build artifacts, static serving, fallback build, and verification evidence were all covered by the plan threat model.

## Self-Check: PASSED

- [x] `.planning/phases/06-package-management/06-02-SUMMARY.md` exists
- [x] `.planning/phases/06-package-management/BUN-PACKAGE-MANAGEMENT.md` exists
- [x] Task commit `f4553f9` confirmed in git log
- [x] Task commit `69effe6` confirmed in git log
- [x] Stub scan found no blocking stubs; the only match was this summary's explicit Known Stubs section

---
*Phase: 06-package-management*
*Completed: 2026-06-05*
