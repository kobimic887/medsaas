# Roadmap: ChemBench

## Milestones

- ✅ **v1 — ChemBench Cleanup** — Phases 1–3 (shipped 2026-06-04)
- 🚧 **v2 — Bun Migration** — Phases 4–7 (in progress)

## Phases

<details>
<summary>✅ v1 — ChemBench Cleanup (Phases 1–3) — SHIPPED 2026-06-04</summary>

- [x] Phase 1: Branding Cleanup — completed 2026-06-04
- [x] Phase 2: Login Code Cleanup — completed 2026-06-04
- [x] Phase 3: CI/CD Pipeline — completed 2026-06-04

Full archive: `.planning/milestones/v1-ROADMAP.md`

</details>

### 🚧 v2 — Bun Migration (In Progress)

**Milestone Goal:** Migrate the Node/npm toolchain to Bun, verified by before/after measurements, with a Node-compatible fallback retained for fast rollback.

- [ ] **Phase 4: Compatibility Spike + Baseline** - Empirically prove arm64 dep compatibility and capture Node performance baselines before committing to migration
- [ ] **Phase 5: Server Runtime on Bun** - Run the Express API on Bun in dev and prod, with before/after RAM measurement gating the outcome
- [ ] **Phase 6: Package Management** - Migrate root and client deps to bun install with Node fallback scripts preserved
- [ ] **Phase 7: Docker, CI/CD, and Scripts** - Ship oven/bun Docker image, Bun-powered Actions pipeline, and Bun test/check scripts

## Phase Details

### Phase 4: Compatibility Spike + Baseline

**Goal**: An empirical proof-of-concept confirms all critical dependencies run under Bun on arm64, and Node performance baselines are recorded before any production change
**Depends on**: Phase 3 (v1 shipped)
**Requirements**: CMPT-01, CMPT-02, CMPT-03, CMPT-04, CMPT-05, CMPT-06, MEAS-01
**Success Criteria** (what must be TRUE):

  1. The Express server boots under Bun on arm64 (inside `oven/bun` container) and `/health` returns 200
  2. MongoDB driver, amqplib, Stripe SDK, and @rdkit/rdkit (WASM) each complete a real operation under Bun without error
  3. Baseline Node metrics are committed to the repo: server RSS at idle and under load, cold-start time, npm install time (cold), and CI wall-clock time

**Plans**: 4 plans

- [x] 04-01-PLAN.md — Docker-free compat: Stripe constructEventAsync (positive+negative) + RDKit WASM (CMPT-04, CMPT-05)
- [ ] 04-02-PLAN.md — Live-service compat: MongoDB driver + amqplib publish/consume (CMPT-02, CMPT-03)
- [ ] 04-03-PLAN.md — Express boot under Bun + oven/bun arm64 container + spike README (CMPT-01, CMPT-06)
- [ ] 04-04-PLAN.md — Node baseline capture (median-of-N) committed to BASELINE.md (MEAS-01)

### Phase 5: Server Runtime on Bun

**Goal**: The Express API runs on the Bun runtime in both dev and production, and measured before/after RAM and startup data gates the outcome
**Depends on**: Phase 4
**Requirements**: RUN-01, RUN-02, RUN-03, RUN-04, MEAS-02, MEAS-03
**Success Criteria** (what must be TRUE):

  1. Running `bun --watch index.js` in dev serves the API with working file-watch reload
  2. The production server starts on Bun, serves the built frontend, and smoke tests pass for auth, the Stripe webhook, and one token-consuming simulation endpoint
  3. Bun RSS (idle and under load) and startup time are measured and compared to the Phase 4 baseline in a written before/after report
  4. If Bun does not reduce server RAM, the report documents it and Node remains the default; the Node run script is retained and documented as a one-command rollback

**Plans**: TBD

### Phase 6: Package Management

**Goal**: All dependencies install via bun install, bun.lock is committed, and every developer-facing script has a Bun equivalent with a Node fallback path preserved
**Depends on**: Phase 5
**Requirements**: PKG-01, PKG-02, PKG-03
**Success Criteria** (what must be TRUE):

  1. `bun install` at root and in client/ succeeds and produces a committed bun.lock
  2. install:all, dev, build, and start scripts invoke Bun; corresponding Node-compatible fallback scripts are documented
  3. The client Vite build completes successfully when invoked through Bun and the output bundle is served correctly

**Plans**: TBD

### Phase 7: Docker, CI/CD, and Scripts

**Goal**: The production Docker image uses oven/bun on arm64, the GitHub Actions pipeline runs on Bun, and all check/test scripts execute under Bun — with a single-change rollback path documented
**Depends on**: Phase 6
**Requirements**: OPS-01, OPS-02, OPS-03, OPS-04
**Success Criteria** (what must be TRUE):

  1. The server Dockerfile builds successfully with an oven/bun arm64 base image and the container starts correctly on the Oracle VPS
  2. The GitHub Actions deploy pipeline uses Bun for install and build steps and deploys a passing build to the arm64 VPS
  3. The check, test:brand, and test:stripe scripts run to completion under Bun
  4. A documented rollback path reverts the Docker image and scripts to Node with a single change (one-line Dockerfile swap or equivalent)

**Plans**: TBD

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Branding Cleanup | v1 | 1/1 | ✅ Complete | 2026-06-04 |
| 2. Login Code Cleanup | v1 | 1/1 | ✅ Complete | 2026-06-04 |
| 3. CI/CD Pipeline | v1 | 1/1 | ✅ Complete | 2026-06-04 |
| 4. Compatibility Spike + Baseline | v2 | 1/4 | In Progress|  |
| 5. Server Runtime on Bun | v2 | 0/? | Not started | - |
| 6. Package Management | v2 | 0/? | Not started | - |
| 7. Docker, CI/CD, and Scripts | v2 | 0/? | Not started | - |

---

*Roadmap updated: 2026-06-04 — Phase 4 planned (4 plans, 3 waves)*
