# ChemBench

## What This Is

ChemBench is a SaaS platform for chemistry laboratories to host branded digital spaces where customers can explore compound libraries, run molecular simulations, and purchase ligands. It is a multi-tenant Express + React monorepo with billing via Stripe, scientific microservices (ADMET, GROMACS, Glioblastoma), and 3D molecular visualization.

## Core Value

Labs and customers get a professional, focused tool for their chemistry work — not a rebranded demo with debug artifacts in the codebase.

## Current Milestone: v2 Bun Migration

**Goal:** Migrate the Node/npm toolchain to Bun to reduce server RAM and improve startup/install/CI speed — verified by before/after measurements, with a Node-compatible fallback retained for fast rollback.

**Target features:**
- Compatibility spike + performance baselines (PoC: server on Bun on arm64; validate MongoDB driver, amqplib, Stripe, RDKit-WASM, `oven/bun` image)
- Express server running on the Bun runtime with a retained Node fallback
- Package management migrated from npm to `bun install` / `bun.lock` (root + client)
- Docker images on `oven/bun` (arm64) + GitHub Actions CI/CD + test/check scripts on Bun

**Out of this milestone:** Python microservices (admet, gromacs-api, glioblastoma-predictor) stay as-is; the Vite→Bun bundler swap is deferred to a later milestone.

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

### Active (v2 — Bun Migration)

See `.planning/REQUIREMENTS.md` for the full scoped list (BUN-*, PKG-*, OPS-* REQ-IDs).

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

Shipped v1 milestone on 2026-06-04. Codebase is now clean of Pyxis branding,
debug code, and has a working CI/CD pipeline.

Tech stack: Express ESM + React 18 + Vite. MongoDB via Atlas (prod) / local container (non-prod).
Deploy: Oracle VPS 151.145.91.17 (arm64), Docker Compose, GitHub Actions.

**v2 (Bun Migration) context:** Server deps are all pure-JS or WASM (no node-gyp/native
addons) — the highest-risk runtime deps to validate under Bun are the MongoDB driver,
`amqplib`, and the `oven/bun` arm64 base image. `@rdkit/rdkit` is the WASM build (Bun runs
WASM). The RAM-reduction goal is a hypothesis, not a guarantee — the milestone captures
baseline Node metrics (RSS, startup, install/CI time) and re-measures after migrating so
"done" is observable. Every phase keeps a Node-compatible fallback for fast rollback.

Current branch `feature/company-ligand-config` has one uncommitted-to-main feature:
per-company ligand service config + admin ligand upload. Ready to merge.

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
| Keep Node fallback through v2 | Fast rollback if a dep misbehaves under Bun in prod | ✓ Done — `:node` fallback scripts retained (Phases 5–6) |

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

*Last updated: 2026-06-04 — started v2 Bun Migration milestone*
