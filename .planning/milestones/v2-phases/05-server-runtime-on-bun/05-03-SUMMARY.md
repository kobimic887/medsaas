---
phase: 05-server-runtime-on-bun
plan: "03"
subsystem: server-runtime
tags: [bun, measurement, gate, rss, before-after]
dependency_graph:
  requires:
    - 05-01
    - 05-02
  provides:
    - BUN-BEFORE-AFTER.md
    - MEAS-03 gate result
  affects:
    - server/package.json
    - README.md
tech_stack:
  added: []
  patterns:
    - "Linux /proc/<pid>/status VmRSS measurement for RSS sampling"
    - "N=5 median methodology for runtime comparison"
    - "Default-runtime gate: Bun default iff median idle RSS < 118.9 MiB"
key_files:
  created:
    - spike/runtime-capture.mjs
    - .planning/phases/05-server-runtime-on-bun/BUN-BEFORE-AFTER.md
  modified:
    - README.md
decisions:
  - "Gate PASS: Bun median idle RSS 115.1 MiB < 118.9 MiB Node baseline — Bun stays default"
  - "README updated with confirmed gate outcome; both npm run start:bun and npm run start:node documented"
metrics:
  duration_min: 8
  completed_date: "2026-06-04"
  tasks_completed: 3
  files_changed: 3
---

# Phase 5 Plan 03: Bun Before/After Report and MEAS-03 Gate Summary

Bun RSS/startup measured on oracle aarch64 Linux host (N=5, `/proc/<pid>/status` VmRSS, same method as Phase 4 baseline). Gate PASS: Bun median idle RSS 115.1 MiB beats the 118.9 MiB Node baseline; Bun remains the shipped default.

## What Was Built

**Task 1 (completed prior):** Created `spike/runtime-capture.mjs` — a dependency-free ESM runtime-parametric capture script adapted from `spike/baseline-capture.mjs`. Supports `--runtime bun`, `--compare-runtime node`, N=5 runs, `/proc/<pid>/status` VmRSS, 30s load via `spike/load-gen.mjs`.

**Task 2:** Committed `.planning/phases/05-server-runtime-on-bun/BUN-BEFORE-AFTER.md` — the full Bun before/after report produced by the orchestrator on the oracle arm64 Linux host (bun 1.3.14 + node v22.22.3, ephemeral MongoDB, N=5, 30s @ 20 concurrency). Contains per-sample distributions, back-to-back Node sanity run, median deltas, and gate result.

**Task 3:** Applied MEAS-03 gate. Gate PASS — `server/package.json` default scripts remain `bun index.js` (already set by Plan 05-01). Updated README to state confirmed gate result, Bun as final default, and both command families.

## Key Results

| Metric | Node Baseline (Ph4) | Bun Measured | Delta |
|--------|---------------------|--------------|-------|
| Idle RSS | 118.9 MiB | 115.1 MiB | −3.8 MiB |
| RSS Under Load | 219.7 MiB | 225.6 MiB | +5.9 MiB |
| Cold Start | 764 ms | 763 ms | −1 ms |

Gate: **PASS** — Bun idle RSS (115.1 MiB) < Node baseline (118.9 MiB). Bun remains the default server runtime.

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| Task 1 (prior) | e6e5ac2 | feat(05-03): create runtime-parametric capture script |
| Task 2 | 6933734 | docs(05-03): capture Bun before/after runtime report |
| Task 3 | 3224cc0 | feat(05-03): apply MEAS-03 gate — Bun confirmed default, update README |

## Verification

- `node --check spike/runtime-capture.mjs` — PASS
- Task 2 automated verify block (grep 118.9, 219.7, 764, /proc/<pid>/status, spike/load-gen.mjs) — PASS
- Task 3 automated verify block (gate result, all aliases, start script agreement, README grep) — PASS
- `npm run check` (server/index.js syntax + Vite build) — PASS

## Deviations from Plan

**1. [Rule 3 - Blocking] macOS host cannot produce Linux /proc VmRSS measurements**

- **Found during:** Task 2 planning
- **Issue:** Task 2 required running `spike/runtime-capture.mjs` on a Linux host to read `/proc/<pid>/status` VmRSS. The dev host is macOS (Darwin 25.5.0), which does not have `/proc`.
- **Resolution:** Orchestrator ran the capture on the `oracle` aarch64 Linux host inside a `node:22-slim` Docker container. The produced `BUN-BEFORE-AFTER.md` was pulled back and committed as the authoritative measurement. No numbers were changed.
- **Files modified:** .planning/phases/05-server-runtime-on-bun/BUN-BEFORE-AFTER.md
- **Commit:** 6933734

## Requirements Satisfied

- **MEAS-02**: Bun before/after report captured with Phase 4 method and committed — SATISFIED
- **MEAS-03**: Default runtime gated by measured idle RSS; gate PASS documented; Bun default confirmed — SATISFIED
- **RUN-04**: Node one-command rollback retained and documented in README — CONFIRMED (retained from 05-01)

## Known Stubs

None — report contains real measurements; `server/package.json` scripts are live production commands.

## Threat Flags

None — no new network endpoints, auth paths, file access patterns, or schema changes introduced.

## Self-Check: PASSED

- `.planning/phases/05-server-runtime-on-bun/BUN-BEFORE-AFTER.md` — present
- `e6e5ac2` (Task 1 commit) — present in git log
- `6933734` (Task 2 commit) — present in git log
- `3224cc0` (Task 3 commit) — present in git log
- All Task 2 and Task 3 verify blocks — PASS
- `npm run check` — PASS
