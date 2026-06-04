---
phase: 04-compatibility-spike-baseline
plan: 04
subsystem: api
tags: [baseline, node, performance, rss, ci]
requires:
  - phase: 04-03
    provides: oracle Docker/Mongo execution path
provides:
  - Reusable fixed-concurrency load generator
  - Node baseline metrics with median-of-N methodology
  - BASELINE.md for Phase 5 before/after comparison
affects: [phase-05-runtime-migration, performance, ci]
tech-stack:
  added: []
  patterns:
    - Median-of-N baseline capture with VmRSS boundary
    - Deterministic /health and /health/db endpoint mix for runtime comparison
key-files:
  created:
    - spike/load-gen.mjs
    - spike/baseline-capture.mjs
    - .planning/phases/04-compatibility-spike-baseline/BASELINE.md
  modified: []
key-decisions:
  - "Baseline capture ran in an isolated oracle /tmp bundle so cold npm install timing did not mutate the local checkout."
  - "CI wall-clock baseline uses latest successful workflow_dispatch deploy.yml run 26954138891: 68 seconds."
  - "Human verification checkpoint auto-approved under workflow.auto_advance/yolo after automated completeness and no-secret checks passed."
patterns-established:
  - "Phase 5 should reuse the same load generator, N=5, /health + /health/db endpoint mix, and VmRSS boundary."
requirements-completed: [MEAS-01]
duration: 14 min
completed: 2026-06-04
---

# Phase 04 Plan 04: Node Baseline Summary

**Node runtime baselines were captured on oracle with median-of-N metrics and committed to BASELINE.md for Phase 5 comparison.**

## Performance

- **Duration:** 14 min
- **Started:** 2026-06-04T16:08:30Z
- **Completed:** 2026-06-04T16:22:04Z
- **Tasks:** 3
- **Files modified:** 3

## Accomplishments

- Added `spike/load-gen.mjs`, a dependency-free fixed-concurrency load generator targeting only `/health` and `/health/db`.
- Added `spike/baseline-capture.mjs`, which captures median-of-N install, cold-start, idle RSS, and under-load RSS metrics.
- Generated `.planning/phases/04-compatibility-spike-baseline/BASELINE.md` with numeric Node baseline values and methodology.
- Auto-approved the human verification checkpoint after the baseline completeness and secret checks passed.

## Baseline Medians

| Metric | Median |
|--------|--------|
| Idle RSS | 118.9 MiB |
| RSS Under Load | 219.7 MiB |
| Cold Start | 764 ms |
| Cold npm Install | 4.38 s |
| CI Wall-Clock | 68 s |

## Task Commits

Each file-producing task was committed atomically:

1. **Task 1: Shared fixed-concurrency load generator** - `a8a0fef` (feat)
2. **Task 2: Node baseline capture to BASELINE.md** - `bf60c3a` (feat)
3. **Task 3: Verify baseline completeness and methodology** - auto-approved checkpoint, no commit

## Files Created/Modified

- `spike/load-gen.mjs` - Runtime-agnostic load generator with configurable base URL, duration, and concurrency.
- `spike/baseline-capture.mjs` - Node baseline capture script using `/proc/<pid>/status` VmRSS and median-of-N.
- `.planning/phases/04-compatibility-spike-baseline/BASELINE.md` - Committed Node baseline metrics and reusable methodology.

## Verification

Local source checks:

- `node --check spike/load-gen.mjs` passed.
- `node --check spike/baseline-capture.mjs` passed.
- `node spike/load-gen.mjs --help` printed the expected command usage.
- Grep confirmed `spike/load-gen.mjs` contains no external science routes.

Remote baseline capture ran on `ssh oracle` from `/tmp/medsaas-phase4-04-04` inside `node:22-slim` on the `medsaasphase403_default` compose network:

- `BASELINE_RUNS=5`
- `LOAD_DURATION_SECONDS=30`
- `LOAD_CONCURRENCY=20`
- `MONGODB_URI=mongodb://mongo:27017/node_baseline`
- `CI_WALL_CLOCK_SECONDS=68`

Generated medians:

- idle RSS: `118.9 MiB`
- under-load RSS: `219.7 MiB`
- cold start: `764 ms`
- cold npm install: `4.38 s`
- CI wall-clock: `68 s`

Baseline artifact checks:

- `BASELINE.md` contains numeric values for idle RSS, under-load RSS, cold start, cold npm install, and CI wall-clock.
- Methodology states machine, OS, N=5, median rule, `/health` + `/health/db`, and VmRSS boundary.
- Grep found no TODO/placeholder or secret-looking Stripe/webhook literals.

## Decisions Made

The baseline ran inside an isolated remote bundle because the install timing step removes `server/node_modules` repeatedly. That keeps the local checkout and its dependencies intact while still measuring the target arm64 oracle environment.

## Deviations from Plan

None - plan executed exactly as written, with the planned destructive install timing isolated to `/tmp` on oracle.

---

**Total deviations:** 0 auto-fixed.
**Impact on plan:** No scope change.

## Issues Encountered

None.

## User Setup Required

None.

## Next Phase Readiness

MEAS-01 is complete. Phase 5 can reuse `spike/load-gen.mjs`, the same N=5 methodology, and the same VmRSS boundary to capture Bun metrics and produce MEAS-02/03 before/after comparison.

## Self-Check: PASSED

All key files exist, all automated checks passed, BASELINE.md has numeric metrics and methodology, and no secrets were committed.

---
*Phase: 04-compatibility-spike-baseline*
*Completed: 2026-06-04*
