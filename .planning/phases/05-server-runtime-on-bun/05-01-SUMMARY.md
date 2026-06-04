---
phase: 05-server-runtime-on-bun
plan: 01
subsystem: infra
tags: [bun, node, runtime, npm-scripts, rollback]

# Dependency graph
requires:
  - phase: 04-compatibility-spike-baseline
    provides: Bun/Node compat proofs, BASELINE.md Node RSS metrics (118.9 MiB)
provides:
  - Runtime availability probe (spike/runtime-env-check.mjs) with --target, --host, --output, --require
  - RUNTIME-ENV.md recording local bun/node/npm paths and oracle probe command form
  - server/package.json default scripts using bun (start, dev, start:unified)
  - server/package.json Node rollback scripts (start:node, dev:node, start:unified:node)
  - Root package.json aliases for Bun and Node paths (start:bun, start:node, start:api:bun, start:api:node, dev:bun, dev:node)
  - README Bun runtime section with exact rollback commands and BUN-BEFORE-AFTER.md reference
affects: [05-02, 05-03, phase-06-pkg-bun, phase-07-docker-bun]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - npm-invoked Bun runtime scripts: scripts in server/package.json call bun directly; npm stays as runner
    - parallel *:bun and *:node script aliases for one-command runtime switching
    - runtime-env-check CLI pattern: dependency-free ESM probe with --target/--host/--output/--require

key-files:
  created:
    - spike/runtime-env-check.mjs
    - .planning/phases/05-server-runtime-on-bun/RUNTIME-ENV.md
  modified:
    - server/package.json
    - package.json
    - README.md

key-decisions:
  - "Bun is default server runtime via server/package.json scripts; npm remains the script runner (D-01, D-02)"
  - "Node fallback is one-command via *:node aliases at both server and root levels (D-04)"
  - "runtime-env-check.mjs exits non-zero only when required binaries (not docker) are missing locally"
  - "ORACLE_PROBE_CMD uses plain string concatenation to avoid template-literal variable interpolation in bash"

patterns-established:
  - "Pattern 1: npm-invoked Bun runtime — scripts call bun directly but npm start/dev remain entry points"
  - "Pattern 2: parallel runtime aliases — every bun script has a matching :node alias for instant rollback"

requirements-completed: [RUN-01, RUN-02, RUN-04]

# Metrics
duration: 18min
completed: 2026-06-04
---

# Phase 05 Plan 01: Runtime Boundary Setup Summary

**Bun set as default server runtime via npm scripts with parallel Node rollback aliases and a dependency-free runtime availability probe recording local host binary paths.**

## Performance

- **Duration:** ~18 min
- **Started:** 2026-06-04T20:45:00Z
- **Completed:** 2026-06-04T21:03:00Z
- **Tasks:** 3
- **Files modified:** 5

## Accomplishments

- Created `spike/runtime-env-check.mjs`: a dependency-free ESM CLI that probes bun, node, npm, and docker on local or oracle targets, records exact binary paths and versions, and marks blocking missing runtimes
- Wrote `RUNTIME-ENV.md` confirming bun 1.3.14 at `/Users/kobigenis/.bun/bin/bun`, node v22.22.3, npm 10.9.8 on local host; docker not found but not required
- Switched `server/package.json` default scripts to `bun index.js` and `bun --watch index.js`; added explicit `:bun` and `:node` alias pairs
- Added 6 root `package.json` aliases (`start:bun`, `start:node`, `start:api:bun`, `start:api:node`, `dev:bun`, `dev:node`) all routing through `npm --prefix server run ...`
- Documented Bun runtime in README with exact rollback commands and forward reference to `BUN-BEFORE-AFTER.md`

## Task Commits

Each task was committed atomically:

1. **Task 1: Create runtime availability probe** - `a816e07` (feat)
2. **Task 2: Switch default scripts to Bun and add rollback aliases** - `fc9147c` (feat)
3. **Task 3: Document default runtime and rollback commands** - `ea3c53a` (docs)

## Files Created/Modified

- `spike/runtime-env-check.mjs` - Dependency-free runtime availability probe CLI; supports --target, --host, --output, --require
- `.planning/phases/05-server-runtime-on-bun/RUNTIME-ENV.md` - Local host runtime snapshot; records oracle probe command form for downstream plans
- `server/package.json` - start/dev/start:unified now invoke bun; :bun aliases explicit; :node rollbacks added; test:runtime-smoke and test:runtime-watch stubs added for plan 02
- `package.json` - 6 root aliases added delegating to npm --prefix server run; no existing scripts changed
- `README.md` - "Bun runtime and Node rollback" subsection added after Local Setup step 5

## Decisions Made

- Template literal interpolation issue in `ORACLE_PROBE_CMD`: initial implementation used a template literal containing `${b}` (the bash loop variable), which Node.js resolved as undefined. Fixed by switching to plain string concatenation.
- docker is probed but not required (not in default `--require bun,node,npm`); missing docker does not cause non-zero exit or populate `Blocking Missing Runtime`.
- Root `start:bun` and `start:node` run `npm run build` first (mirrors root `start` behavior) to stay consistent for unified production runs.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed template-literal bash variable collision in ORACLE_PROBE_CMD**
- **Found during:** Task 1 (runtime availability probe)
- **Issue:** `ORACLE_PROBE_CMD` was an arrow function using a template literal containing `${b}` — Node.js interpolated `b` as a JS variable (undefined) before the string was passed to the SSH command
- **Fix:** Converted to plain string concatenation function so the literal `$b` shell variable is preserved in the output string
- **Files modified:** spike/runtime-env-check.mjs
- **Verification:** `node spike/runtime-env-check.mjs --target local --output ...` ran successfully
- **Committed in:** a816e07 (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 - Bug)
**Impact on plan:** Essential correctness fix for the probe script. No scope creep.

## Issues Encountered

- Initial template literal produced `ReferenceError: b is not defined` at runtime due to bash `$b` being parsed as JS variable. Resolved immediately by converting to string concatenation.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Plan 02 (05-02) can proceed: server scripts now call bun; RUNTIME-ENV.md records local binary paths
- Plan 02 needs: Stripe `constructEventAsync` migration, `server/test/runtime-smoke.test.mjs`, `server/test/runtime-watch-smoke.mjs`
- Plan 03 needs: `spike/runtime-capture.mjs`, BUN-BEFORE-AFTER.md measurements, MEAS-03 gate decision
- No blockers for Plan 02 — all required fallback scripts and documentation are in place

## Stub Tracking

None — no UI rendering stubs or placeholder values introduced.

## Threat Flags

None — no new network endpoints, auth paths, file access patterns, or schema changes introduced. Script changes affect only build/run tooling.

## Self-Check: PASSED

- [x] spike/runtime-env-check.mjs exists
- [x] .planning/phases/05-server-runtime-on-bun/RUNTIME-ENV.md exists
- [x] server/package.json default scripts use bun (verified by plan automated check)
- [x] package.json has all 6 root aliases (verified by plan automated check)
- [x] README.md contains all required grep targets
- [x] Commits a816e07, fc9147c, ea3c53a confirmed in git log

---
*Phase: 05-server-runtime-on-bun*
*Completed: 2026-06-04*
