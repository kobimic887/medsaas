---
gsd_state_version: 1.0
milestone: v2
milestone_name: — Bun Migration
status: ready_to_plan
last_updated: "2026-06-05T08:30:00.000Z"
last_activity: 2026-06-05
progress:
  total_phases: 4
  completed_phases: 3
  total_plans: 9
  completed_plans: 9
  percent: 75
---

# Project State: ChemBench

## Project Reference

See: `.planning/PROJECT.md` (updated 2026-06-04)

**Core value:** Labs and customers get a professional, focused tool — not a rebranded demo with debug artifacts.
**Current focus:** Phase 7 — Docker, CI/CD, and Scripts (not yet started)

**Bun status:** Bun is the default server runtime (Phase 5) and the default package manager (Phase 6). npm/Node fallbacks are retained via `:node`-suffixed scripts.

---

## Current Position

Milestone: v2 — Bun Migration (3 of 4 phases complete, 75%)
Completed phases: 4 (Compatibility Spike + Baseline), 5 (Server Runtime on Bun), 6 (Package Management)
Next phase: 7 — Docker, CI/CD, and Scripts
Plan: Not started
Status: Phase 6 complete and verified — Phase 7 not yet started
Last activity: 2026-06-05

Milestone progress: [███████░░░] 75%

## Performance Metrics

**Velocity:**

- Total v2 plans completed: 9 (Phase 4: 4, Phase 5: 3, Phase 6: 2)
- Average duration: —
- Total execution time: —

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| v1 (1–3) | 3 | — | — |
| 05 | 3 | - | - |
| 06 | 2 | - | - |

*Updated after each plan completion*
| Phase 04 P01 | 12 min | 3 tasks | 3 files |
| Phase 04 P02 | 7 min | 3 tasks | 2 files |
| Phase 04 P03 | 6 min | 3 tasks | 4 files |
| Phase 04 P04 | 14 min | 3 tasks | 3 files |
| Phase 05-server-runtime-on-bun P01 | 18 | 3 tasks | 5 files |
| Phase 05-server-runtime-on-bun P02 | 35 | 3 tasks | 4 files |
| Phase 05-server-runtime-on-bun P03 | 8 | 3 tasks | 3 files |
| Phase 06-package-management P01 | 10 | 2 tasks | 5 files |
| Phase 06-package-management P02 | 23 | 2 tasks | 3 files |

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
- Promoted concurrently to root devDependency at ^9.2.0 for root package orchestration — Phase 06 Plan 01
- Bun package-root scripts use --cwd=<dir> because Bun 1.3.14 requires executable cwd spelling for install — Phase 06 Plan 01

### Active Blockers

- None

### Notes for Next Session

- **Next up: Phase 7 — Docker, CI/CD, and Scripts** (OPS-01..04). Plan with `/gsd:plan-phase 7`.
  - OPS-01: server Dockerfile → `oven/bun` arm64 base. Reference prototype: `spike/Dockerfile.bun` + `spike/run-container-check.sh`.
  - OPS-02: GitHub Actions deploy pipeline on Bun (`deploy.yml` push trigger is commented out — one line to enable auto-deploy).
  - OPS-03: `check`, `test:brand`, `test:stripe` scripts run under Bun.
  - OPS-04: one-change Node rollback path documented.
- `spike/` is kept as Phase-4 compatibility evidence and a Docker prototype for Phase 7; revisit deleting it after Phase 7 ships.
- `tester123` server-side bypass still exists in `server/index.js` — SEC-V2-01 (future milestone)

---

*State initialized: 2026-06-03*
*Last updated: 2026-06-05 — Phase 06 complete and verified; Phase 7 (Docker, CI/CD, Scripts) is next*

## Decisions

- [Phase 06-package-management]: Bun defaults are documented as the first command path for install, dev, build, and start; npm/Node fallback commands remain documented beside them — Phase 06 Plan 02
- [Phase 06-package-management]: Vite remains the client bundler for PKG-03; bun run build invokes the existing Vite build through Bun's package runner — Phase 06 Plan 02
