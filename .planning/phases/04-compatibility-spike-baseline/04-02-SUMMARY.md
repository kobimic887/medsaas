---
phase: 04-compatibility-spike-baseline
plan: 02
subsystem: api
tags: [bun, mongodb, rabbitmq, amqplib, compatibility]
requires: []
provides:
  - MongoDB driver live connect/insert/find/createIndex proof under Bun
  - amqplib live publish/consume proof under Bun
  - Remote oracle live-service verification path for Docker-dependent phase checks
affects: [phase-04, phase-05-runtime-migration, mongodb, rabbitmq]
tech-stack:
  added: []
  patterns:
    - Docker-dependent spike verification can run from an isolated /tmp bundle on ssh alias oracle
key-files:
  created:
    - spike/02-mongo.ts
    - spike/03-amqp.ts
  modified: []
key-decisions:
  - "Local Docker was unavailable, so live-service verification ran on ssh alias oracle using Docker Compose and oven/bun:1.3.14-slim."
  - "MongoDB writes are confined to throwaway database bun_spike_test and dropped after the check."
  - "RabbitMQ writes are confined to throwaway queue bun_spike_queue and deleted after the check."
patterns-established:
  - "Live-service spike scripts read service URLs from env and default only to local development endpoints."
requirements-completed: [CMPT-02, CMPT-03]
duration: 7 min
completed: 2026-06-04
---

# Phase 04 Plan 02: MongoDB and RabbitMQ Bun Compatibility Summary

**MongoDB and RabbitMQ client operations both completed successfully under Bun against live services on the oracle host.**

## Performance

- **Duration:** 7 min
- **Started:** 2026-06-04T16:01:30Z
- **Completed:** 2026-06-04T16:08:26Z
- **Tasks:** 3
- **Files modified:** 2

## Accomplishments

- Started live MongoDB and RabbitMQ services on `oracle` through Docker Compose in an isolated `/tmp/medsaas-phase4-04-02` bundle.
- Added a standalone MongoDB spike that connects under Bun, inserts a document, reads it back, creates an index, and drops the throwaway database.
- Added a standalone RabbitMQ spike that connects under Bun, publishes a JSON payload, consumes the same payload, acknowledges it, and deletes the throwaway queue.
- Explicitly captures amqplib `Invalid frame` errors as findings if they occur; none occurred in this run.

## Task Commits

Each file-producing task was committed atomically:

1. **Task 1: Start live services** - no commit (runtime precondition only)
2. **Task 2: MongoDB driver spike** - `4c6824c` (feat)
3. **Task 3: amqplib publish/consume spike** - `aeffce7` (feat)

## Files Created/Modified

- `spike/02-mongo.ts` - Uses the server MongoDB dependency to connect, insert, find, create an index, and drop a throwaway database under Bun.
- `spike/03-amqp.ts` - Uses the server amqplib dependency to publish and consume one payload through a throwaway queue under Bun.

## Verification

Remote verification ran on `ssh oracle` from `/tmp/medsaas-phase4-04-02`:

- `docker compose up -d mongo rabbitmq` created healthy live services under project `medsaasphase402`.
- `docker run --rm -v /tmp/medsaas-phase4-04-02:/app -w /app/server oven/bun:1.3.14-slim bun install --production` installed server dependencies for the isolated bundle.
- `docker run --rm --network medsaasphase402_default ... oven/bun:1.3.14-slim bun run spike/02-mongo.ts` passed:
  - inserted `_id: 6a21a2ce2d901f82dbaa99bd`
  - found marker `bun-mongo-1780589262920`
  - created index `marker_1`
  - dropped throwaway database `bun_spike_test`
- `docker run --rm --network medsaasphase402_default ... oven/bun:1.3.14-slim bun run spike/03-amqp.ts` passed:
  - round-tripped payload `{"ping":1780589264259,"runtime":"bun"}`

Local source checks:

- `grep -n "createIndex" spike/02-mongo.ts` found the required index operation.
- `grep -n "consume" spike/03-amqp.ts` found the required consumer operation.
- `grep -n "bun_spike" spike/02-mongo.ts spike/03-amqp.ts` confirmed throwaway database and queue names.
- No real service credentials or Stripe key literals were added. The only credential-shaped value is RabbitMQ's documented local default `guest:guest@localhost`.

## Decisions Made

Docker-dependent verification ran on `oracle` because the local machine has no Docker-compatible CLI. The remote repo at `/home/ubuntu/medsaas` is not a git checkout, so the test used a minimal `/tmp` bundle copied from the local workspace rather than relying on remote project state.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Used oracle for live services because local Docker is unavailable**
- **Found during:** Task 1 (Start live services)
- **Issue:** `npm run services:up` failed locally with `sh: docker: command not found`.
- **Fix:** Ran MongoDB and RabbitMQ on `ssh oracle` via Docker Compose, then executed both spike scripts inside `oven/bun:1.3.14-slim` on the compose network.
- **Files modified:** None beyond planned spike scripts.
- **Verification:** Both live-service scripts exited 0 under Bun on the remote compose network.
- **Committed in:** Summary metadata commit.

---

**Total deviations:** 1 auto-fixed (Rule 3).
**Impact on plan:** The proof is still live-service and Bun-based. It ran on the target oracle host instead of local Docker.

## Issues Encountered

Local Docker is unavailable in this Codex environment. This does not block `04-02` after the oracle verification, but future Docker-dependent checks should use `oracle` unless local Docker is installed.

## User Setup Required

None for the committed scripts. Re-running the exact live-service proof requires Docker on the execution host or access to `ssh oracle`.

## Next Phase Readiness

CMPT-02 and CMPT-03 are proven under Bun. Wave 2 can build on the same `oracle` Docker path for the server boot and container checks if local Docker remains unavailable.

## Self-Check: PASSED

Both planned files exist, both live-service verifications passed under Bun, MongoDB cleanup dropped the throwaway database, RabbitMQ cleanup deleted the throwaway queue, and no real secrets were committed.

---
*Phase: 04-compatibility-spike-baseline*
*Completed: 2026-06-04*
