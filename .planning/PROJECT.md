# ChemBench

## What This Is

ChemBench is a SaaS platform for chemistry laboratories to host branded digital spaces where customers can explore compound libraries, run molecular simulations, and purchase ligands. It is a multi-tenant Express + React monorepo with billing via Stripe, scientific microservices (ADMET, GROMACS, Glioblastoma), and 3D molecular visualization.

## Core Value

Labs and customers get a professional, focused tool for their chemistry work — not a rebranded demo with debug artifacts in the codebase.

## Current State

**Shipped v2 — Bun Migration on 2026-06-05.** Bun is now the default runtime, package manager,
and Docker/CI base for the app; a one-change Node fallback is retained throughout. The Express
server runs on Bun (idle RSS measured below the Node baseline — MEAS-03 gate PASS), deps install
via `bun install` with dual lockfiles, and the production `oven/bun:1.3.14-slim` arm64 image
builds and serves `/health` 200 on the Oracle VPS via the deploy pipeline.

**Next milestone (not yet started):** candidates are the **security/auth hardening** track
(AUTH-V2 / SEC-V2 below) and the deferred **Vite→Bun bundler swap**. Define via
`/gsd:new-milestone`.

**Out of the v2 milestone (shipped scope):** Python microservices (admet, gromacs-api,
glioblastoma-predictor) stayed as-is; the Vite→Bun bundler swap was deferred to a later milestone.

## Requirements

### Validated

- ✓ Multi-tenant company/user system with owner/admin/member roles — existing
- ✓ JWT auth with email verification, invite flow, password policy — existing
- ✓ Stripe billing with plan catalog and credit-based token economy — existing
- ✓ Simulation endpoints (DiffDock, ADMET, GROMACS, Glioblastoma) with token consumption — existing
- ✓ Molecule visualization with Ketcher (2D) and Molstar (3D) — existing
- ✓ Zero Pyxis branding in codebase — v1 (BRAND-01–06)
- ✓ Clean sign-in page, no debug code — v1 (LOGIN-01–03)
- ✓ GitHub Actions deploy pipeline to Oracle arm64 VPS — v1 (DEPLOY-01)
- ✓ Per-company ligand service config + admin ligand upload — shipped on feature branch
- ✓ arm64 dep compatibility proven under Bun (Mongo, amqplib, Stripe, RDKit-WASM, `oven/bun`) + Node baselines — v2 (CMPT-01–06, MEAS-01)
- ✓ Express API runs on Bun in dev + prod; before/after RAM gate PASS (Bun idle RSS < Node) — v2 (RUN-01–04, MEAS-02/03)
- ✓ Dependencies install via `bun install` with committed `bun.lock`; Bun-default scripts + `:node` fallbacks; Vite build via Bun — v2 (PKG-01–03)
- ✓ Production Docker image on `oven/bun` arm64; CI deploy builds on Bun; `check`/`test:brand`/`test:stripe` under Bun; one-change Node rollback — v2 (OPS-01–04)

### Active (next milestone — not yet defined)

None — v2 fully shipped. Run `/gsd:new-milestone` to scope the next set (see Future below).

### Future (security/auth — separate milestone)

- [ ] **AUTH-V2-01**: Forgot-password flow wired up end-to-end (currently dead `href="#"`)
- [ ] **SEC-V2-01**: `tester123` server-side token-bypass guards removed from simulation endpoints
- [ ] **SEC-V2-02**: Unauthenticated mol-price and molecules endpoints secured with `authenticateToken`
- [ ] **SEC-V2-03**: CORS fail-secure when no origins configured
- [ ] **SEC-V2-04**: Helmet middleware added for missing security headers

### Out of Scope

- **Vite→Bun bundler swap** — build-time tool, delivers ~none of the server RAM/speed win while carrying the most risk (HMR, dev proxy, Material Tailwind, `@` alias); deferred to its own milestone
- **Bun migration of Python microservices** — admet/gromacs-api/glioblastoma-predictor are Python/Docker, not Node
- Dead code removal (legacy/, packages/dashboard-template/) — bigger structural change, own milestone
- New image assets for About Us — CSS gradients are sufficient placeholders
- Video chat / offline mode — not relevant to core chemistry workflow

## Context

Shipped v1 (cleanup) on 2026-06-04 and v2 (Bun Migration) on 2026-06-05. Codebase is clean of
Pyxis branding/debug code, runs on Bun by default, and deploys an `oven/bun` arm64 image via CI.

Tech stack: Express ESM + React 18 + Vite, now running on **Bun** (Node retained as one-change
fallback). MongoDB via Atlas (prod) / local `mongo:7` container (non-prod). Deploy: Oracle VPS
151.145.91.17 (arm64), Docker Compose built **on the box** (git-archive → `docker compose --build`,
no registry), GitHub Actions (`workflow_dispatch`).

**v2 outcome:** The RAM-reduction hypothesis was validated empirically — Bun median idle RSS
(115.1 MiB) came in below the Node baseline (118.9 MiB), so Bun is confirmed as the default
server runtime (MEAS-03 gate PASS). All Bun-risk deps (MongoDB driver, `amqplib`, `@rdkit/rdkit`
WASM, Stripe async webhook crypto) run cleanly under Bun on arm64. The Stripe webhook required
the async SubtleCrypto provider (`constructEventAsync` / `generateTestHeaderStringAsync`) under
Bun. Every phase kept a `:node` fallback for fast rollback.

Currently on `main`, all v2 work committed and pushed.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| CSS gradients instead of new images | No new assets needed; placeholders sufficient | ✓ Good — no complaints |
| Remove client-side IP fetch entirely | Server has `req.ip`; browser fetch is spoofable | ✓ Good |
| Leave forgot-password link as `href="#"` | Deferred by user — build separately | — Pending (v2) |
| Native arm64 build on box via SSH/SCP | Faster than QEMU cross-compile; no registry dependency | ✓ Good |
| `tester123` server-side bypass left in place | Server-side security work is a separate milestone | ⚠ Revisit — SEC-V2-01 |
| v2 = Bun runtime, not the bundler | RAM/speed win lives in the long-running server, not build-time Vite | ✓ Done — Bun is default runtime (Phase 5); Vite stays the bundler |
| Compatibility spike before full roadmap commit | arm64 dep compatibility is the tightest constraint; prove it empirically first | ✓ Done — Phase 4 complete |
| Keep Node fallback through v2 | Fast rollback if a dep misbehaves under Bun in prod | ✓ Done — `:node` fallback scripts retained (Phases 5–6) + one-change Dockerfile revert (ROLLBACK.md, Phase 7) |
| Async Stripe crypto under Bun | Bun's SubtleCrypto is async-only; sync `constructEvent`/`generateTestHeaderString` throw | ✓ Done — `constructEventAsync` (webhook) + `generateTestHeaderStringAsync` (test), Phases 5 & 7 |
| `bun build --target=bun` as the `check` syntax gate | Bun has no `node --check` equivalent; bundling resolves the full module graph | ✓ Done — Phase 7 (Node `check:node` retained) |
| Production Docker image on `oven/bun:1.3.14-slim` (arm64), built on the box | Pinned tag proven on arm64 in spike; on-box build avoids QEMU/registry | ✓ Done — Phase 7; CI deploy + `/health` 200 verified on VPS |

## Constraints

- **Tech stack**: React 18 + Vite on client, Express ESM on server
- **Deploy target**: Oracle arm64 VPS — Docker images must be linux/arm64 (Bun base image must support arm64)
- **No new dependencies** unless justified by a specific feature milestone

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd:complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---

*Last updated: 2026-06-05 after v2 — Bun Migration milestone*
