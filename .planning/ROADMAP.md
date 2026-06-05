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

- [x] **Phase 4: Compatibility Spike + Baseline** - Empirically prove arm64 dep compatibility and capture Node performance baselines before committing to migration (completed 2026-06-04)
- [x] **Phase 5: Server Runtime on Bun** - Run the Express API on Bun in dev and prod, with before/after RAM measurement gating the outcome (completed 2026-06-04)
- [x] **Phase 6: Package Management** - Migrate root and client deps to bun install with Node fallback scripts preserved (completed 2026-06-05)
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
- [x] 04-02-PLAN.md — Live-service compat: MongoDB driver + amqplib publish/consume (CMPT-02, CMPT-03)
- [x] 04-03-PLAN.md — Express boot under Bun + oven/bun arm64 container + spike README (CMPT-01, CMPT-06)
- [x] 04-04-PLAN.md — Node baseline capture (median-of-N) committed to BASELINE.md (MEAS-01)

### Phase 5: Server Runtime on Bun

**Goal**: The Express API runs on the Bun runtime in both dev and production, and measured before/after RAM and startup data gates the outcome
**Depends on**: Phase 4
**Requirements**: RUN-01, RUN-02, RUN-03, RUN-04, MEAS-02, MEAS-03
**Success Criteria** (what must be TRUE):

  1. Running `bun --watch index.js` in dev serves the API with working file-watch reload
  2. The production server starts on Bun, serves the built frontend, and smoke tests pass for auth, the Stripe webhook, and one token-consuming simulation endpoint
  3. Bun RSS (idle and under load) and startup time are measured and compared to the Phase 4 baseline in a written before/after report
  4. If Bun does not reduce server RAM, the report documents it and Node remains the default; the Node run script is retained and documented as a one-command rollback

**Plans**: 3 plans
**Wave 1**

- [x] 05-01-PLAN.md — Runtime availability probe, Bun default scripts, and Node rollback docs (RUN-01, RUN-02, RUN-04)

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 05-02-PLAN.md — Async Stripe webhook migration plus Bun/Node runtime smoke coverage (RUN-01, RUN-02, RUN-03)

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 05-03-PLAN.md — Bun RSS/startup measurement report and MEAS-03 default-runtime gate (RUN-04, MEAS-02, MEAS-03)

### Phase 6: Package Management

**Goal**: All dependencies install via bun install, bun.lock is committed, and every developer-facing script has a Bun equivalent with a Node fallback path preserved
**Depends on**: Phase 5
**Requirements**: PKG-01, PKG-02, PKG-03
**Success Criteria** (what must be TRUE):

  1. `bun install` at root and in client/ succeeds and produces a committed bun.lock
  2. install:all, dev, build, and start scripts invoke Bun; corresponding Node-compatible fallback scripts are documented
  3. The client Vite build completes successfully when invoked through Bun and the output bundle is served correctly

**Plans**: 2 plans
**Wave 1**

- [x] 06-01-PLAN.md — Bun-default package scripts and dual lockfiles for root/client/server (PKG-01, PKG-02)

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 06-02-PLAN.md — Developer docs plus Bun-invoked Vite build/static-serving verification (PKG-02, PKG-03)

### Phase 7: Docker, CI/CD, and Scripts

**Goal**: The production Docker image uses oven/bun on arm64, the GitHub Actions pipeline runs on Bun, and all check/test scripts execute under Bun — with a single-change rollback path documented
**Depends on**: Phase 6
**Requirements**: OPS-01, OPS-02, OPS-03, OPS-04
**Success Criteria** (what must be TRUE):

  1. The server Dockerfile builds successfully with an oven/bun arm64 base image and the container starts correctly on the Oracle VPS
  2. The GitHub Actions deploy pipeline uses Bun for install and build steps and deploys a passing build to the arm64 VPS
  3. The check, test:brand, and test:stripe scripts run to completion under Bun
  4. A documented rollback path reverts the Docker image and scripts to Node with a single change (one-line Dockerfile swap or equivalent)

**Plans**: 3 plans
**Wave 1** *(parallel — no file overlap)*

- [ ] 07-01-PLAN.md — Convert both Dockerfile stages to oven/bun + ROLLBACK.md single-change Node revert (OPS-01, OPS-04)
- [ ] 07-02-PLAN.md — Bun-default check/test:brand/test:stripe scripts (+ async Stripe test-header fix) with :node fallbacks (OPS-03)

**Wave 2** *(blocked on 07-01; autonomous:false — on-box VPS verification)*

- [ ] 07-03-PLAN.md — Confirm/annotate deploy.yml + build & verify the oven/bun image on the Oracle arm64 VPS (/health 200) (OPS-02, OPS-01)

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Branding Cleanup | v1 | 1/1 | ✅ Complete | 2026-06-04 |
| 2. Login Code Cleanup | v1 | 1/1 | ✅ Complete | 2026-06-04 |
| 3. CI/CD Pipeline | v1 | 1/1 | ✅ Complete | 2026-06-04 |
| 4. Compatibility Spike + Baseline | v2 | 4/4 | Complete   | 2026-06-04 |
| 5. Server Runtime on Bun | v2 | 3/3 | Complete   | 2026-06-04 |
| 6. Package Management | v2 | 2/2 | Complete    | 2026-06-05 |
| 7. Docker, CI/CD, and Scripts | v2 | 0/3 | Planned | - |

---

*Roadmap updated: 2026-06-05 — Phase 7 (Docker, CI/CD, Scripts) planned: 3 plans in 2 waves*
