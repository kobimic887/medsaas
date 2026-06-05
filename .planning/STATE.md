---
gsd_state_version: 1.0
milestone: v2
milestone_name: — Bun Migration
status: executing
last_updated: "2026-06-05T07:02:04.440Z"
last_activity: 2026-06-05 -- Phase 06 planning complete
progress:
  total_phases: 4
  completed_phases: 2
  total_plans: 7
  completed_plans: 7
  percent: 50
---

# Project State: ChemBench

## Project Reference

See: `.planning/PROJECT.md` (updated 2026-06-04)

**Core value:** Labs and customers get a professional, focused tool — not a rebranded demo with debug artifacts.
**Current focus:** Phase 6 — package management

---

## Current Position

Phase: 6
Plan: Not started
Status: Ready to execute
Last activity: 2026-06-05 -- Phase 06 planning complete

Progress: [██████████] 100%

## Performance Metrics

**Velocity:**

- Total plans completed: 6 (v1)
- Average duration: —
- Total execution time: —

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| v1 (1–3) | 3 | — | — |
| 05 | 3 | - | - |

*Updated after each plan completion*
| Phase 04 P01 | 12 min | 3 tasks | 3 files |
| Phase 04 P02 | 7 min | 3 tasks | 2 files |
| Phase 04 P03 | 6 min | 3 tasks | 4 files |
| Phase 04 P04 | 14 min | 3 tasks | 3 files |
| Phase 05-server-runtime-on-bun P01 | 18 | 3 tasks | 5 files |
| Phase 05-server-runtime-on-bun P02 | 35 | 3 tasks | 4 files |
| Phase 05-server-runtime-on-bun P03 | 8 | 3 tasks | 3 files |

## Accumulated Context

### Key Decisions Recorded

- Compatibility spike before full migration commit — arm64 dep compat is tightest constraint
- MEAS-01 (baseline) in spike phase; MEAS-02/03 (before/after report + gate) in runtime phase
- Node fallback retained through all v2 phases (RUN-04, PKG-02, OPS-04)
- Vite→Bun bundler swap deferred — no server RAM win, highest risk
- Docker-dependent compatibility checks can run from an isolated `/tmp` bundle on ssh alias `oracle` when local Docker is unavailable
- Bun is default server runtime via server/package.json scripts; npm remains the script runner (D-01, D-02) — Phase 05 Plan 01
- Node fallback is one-command via *:node aliases at both server and root levels (D-04) — Phase 05 Plan 01
- constructEventAsync replaces constructEvent for Bun-compatible async Stripe webhook verification (D-08, D-09) — Phase 05 Plan 02
- Smoke harness passes NVIDIA_MOLMIM_API_KEY='' as empty string: dotenv skips already-set vars; delete is insufficient when server re-reads .env — Phase 05 Plan 02
- Bun FSEvents watch requires inode change (readFile+writeFile); fs.utimes mtime-only update does not trigger reload on macOS — Phase 05 Plan 02
- Gate PASS: Bun median idle RSS 115.1 MiB < 118.9 MiB Node baseline — Bun confirmed as default server runtime (MEAS-03) — Phase 05 Plan 03
- README updated with confirmed gate outcome; both npm run start:bun and npm run start:node documented — Phase 05 Plan 03

### Active Blockers

- None

### Notes for Next Session

- `tester123` server-side bypass still exists in `server/index.js` — SEC-V2-01 (future milestone)
- deploy.yml push trigger is commented out — one line to enable auto-deploy

---

*State initialized: 2026-06-03*
*Last updated: 2026-06-04 — v2 roadmap finalized, Phase 4 ready to plan*
