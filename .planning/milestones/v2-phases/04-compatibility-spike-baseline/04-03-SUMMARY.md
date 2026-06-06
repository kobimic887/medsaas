---
phase: 04-compatibility-spike-baseline
plan: 03
subsystem: api
tags: [bun, docker, express, healthcheck, arm64]
requires:
  - phase: 04-02
    provides: live MongoDB compose verification path on oracle
provides:
  - Unmodified Express server boot proof under Bun
  - Pinned oven/bun:1.3.14-slim arm64 container proof serving /health
  - Spike README covering all CMPT scripts and results
affects: [phase-05-runtime-migration, phase-07-containerization, docker, express]
tech-stack:
  added: []
  patterns:
    - Pinned Bun runtime container for server health checks
    - HOST_PORT override for shared oracle host port conflicts
key-files:
  created:
    - spike/01-boot-health.ts
    - spike/Dockerfile.bun
    - spike/run-container-check.sh
    - spike/README.md
  modified: []
key-decisions:
  - "The server boot spike proves the unmodified app; server/index.js remains unchanged."
  - "The Bun container uses oven/bun:1.3.14-slim and installs server dependencies with bun install --production."
  - "oracle port 3000 was already occupied, so CMPT-06 used HOST_PORT=3300 while the container app still listened on port 3000."
patterns-established:
  - "Docker-dependent proofs run on oracle from isolated /tmp bundles when local Docker is unavailable."
requirements-completed: [CMPT-01, CMPT-06]
duration: 6 min
completed: 2026-06-04
---

# Phase 04 Plan 03: Bun Server Boot and Container Health Summary

**The unmodified Express server boots under Bun and the pinned oven/bun arm64 container serves `/health` successfully.**

## Performance

- **Duration:** 6 min
- **Started:** 2026-06-04T16:08:30Z
- **Completed:** 2026-06-04T16:14:08Z
- **Tasks:** 3
- **Files modified:** 4

## Accomplishments

- Added `spike/01-boot-health.ts`, which spawns `bun server/index.js`, polls `/health`, verifies body `status: "OK"`, and always kills the spawned server.
- Added `spike/Dockerfile.bun` pinned to `oven/bun:1.3.14-slim`.
- Added `spike/run-container-check.sh`, a single-command build/run/health proof that starts compose Mongo, asserts arm64 image architecture, runs the container, polls `/health`, and cleans up.
- Added `spike/README.md` with prerequisites, commands, CMPT mapping, results, and the compose-network Mongo URI.

## Task Commits

Each task was committed atomically:

1. **Task 1: Express boot + /health under Bun** - `32debd2` (feat)
2. **Task 2: oven/bun arm64 container build + serve /health** - `4cb78d8` (feat)
3. **Task 3: Spike README** - `b8d1e78` (docs)

## Files Created/Modified

- `spike/01-boot-health.ts` - Boots the real server under Bun and verifies `/health`.
- `spike/Dockerfile.bun` - Builds the API on pinned `oven/bun:1.3.14-slim`.
- `spike/run-container-check.sh` - Automates build, arm64 assertion, container run, health poll, and cleanup.
- `spike/README.md` - Documents every spike command and result.

## Verification

Remote verification ran on `ssh oracle` from `/tmp/medsaas-phase4-04-03`:

- `docker compose up -d mongo` started healthy MongoDB under project `medsaasphase403`.
- `docker run --rm --network medsaasphase403_default ... oven/bun:1.3.14-slim bun run spike/01-boot-health.ts` passed:
  - `PASS: Bun server /health returned 200`
  - body: `{"status":"OK","timestamp":"2026-06-04T16:12:54.453Z","message":"Server is running"}`
- `COMPOSE_PROJECT_NAME=medsaasphase403 HOST_PORT=3300 bash spike/run-container-check.sh` passed:
  - built `medsaas:bun-spike` from `oven/bun:1.3.14-slim`
  - image architecture assertion passed as arm64
  - container `/health` returned HTTP 200
  - body: `{"status":"OK","timestamp":"2026-06-04T16:13:31.388Z","message":"Server is running"}`

Local source checks:

- `git diff -- server/index.js` returned no changes.
- `grep -q "oven/bun:1.3.14-slim" spike/Dockerfile.bun` passed.
- README checks confirmed `bun run spike/01-boot-health.ts`, `run-container-check.sh`, CMPT rows, and `HOST_PORT=3300` documentation.

## Decisions Made

The container proof used `HOST_PORT=3300` because port 3000 on the shared `oracle` host was already allocated. The containerized app still listened on port 3000, so the internal production port boundary remains the same. No unrelated service on `oracle` was stopped.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Avoided oracle host port 3000 conflict**
- **Found during:** Task 2 (oven/bun container proof)
- **Issue:** The first `docker run` failed because `0.0.0.0:3000` was already allocated on `oracle`.
- **Fix:** Re-ran the same script with `HOST_PORT=3300`, preserving container `PORT=3000`.
- **Files modified:** `spike/README.md` documents the host-port override.
- **Verification:** Container `/health` returned HTTP 200.
- **Committed in:** `b8d1e78` for README documentation; the script already supported `HOST_PORT`.

---

**Total deviations:** 1 auto-fixed (Rule 3).
**Impact on plan:** The Bun container proof remains valid; only the host-side port binding changed to avoid disrupting an existing service.

## Issues Encountered

Local Docker remains unavailable, so Docker-dependent verification used `oracle`. The `medsaasphase403` Mongo stack is intentionally left running for the Phase 4 baseline capture that follows.

## User Setup Required

None. Re-running the container proof requires Docker or access to `ssh oracle`.

## Next Phase Readiness

CMPT-01 and CMPT-06 are proven. Phase 4 can proceed to `04-04` baseline capture using the same `oracle` compose Mongo path.

## Self-Check: PASSED

All key files exist, the unmodified server booted under Bun, the pinned arm64 Bun image served `/health`, README documents all spike scripts, and `server/index.js` was not modified.

---
*Phase: 04-compatibility-spike-baseline*
*Completed: 2026-06-04*
