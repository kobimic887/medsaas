# ChemBench

## What This Is

ChemBench is a SaaS platform for chemistry laboratories to host branded digital spaces where customers can explore compound libraries, run molecular simulations, and purchase ligands. It is a multi-tenant Express + React monorepo with billing via Stripe, scientific microservices (ADMET, GROMACS, Glioblastoma), and 3D molecular visualization.

## Core Value

Labs and customers get a professional, focused tool for their chemistry work — not a rebranded demo with debug artifacts in the codebase.

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

### Active (v2 candidates)

- [ ] **AUTH-V2-01**: Forgot-password flow wired up end-to-end (currently dead `href="#"`)
- [ ] **SEC-V2-01**: `tester123` server-side token-bypass guards removed from simulation endpoints
- [ ] **SEC-V2-02**: Unauthenticated mol-price and molecules endpoints secured with `authenticateToken`
- [ ] **SEC-V2-03**: CORS fail-secure when no origins configured
- [ ] **SEC-V2-04**: Helmet middleware added for missing security headers

### Out of Scope

- Dead code removal (legacy/, packages/dashboard-template/) — bigger structural change, own milestone
- New image assets for About Us — CSS gradients are sufficient placeholders
- Video chat / offline mode — not relevant to core chemistry workflow

## Context

Shipped v1 milestone on 2026-06-04. Codebase is now clean of Pyxis branding,
debug code, and has a working CI/CD pipeline.

Tech stack: Express ESM + React 18 + Vite. MongoDB via Atlas (prod) / local container (non-prod).
Deploy: Oracle VPS 151.145.91.17 (arm64), Docker Compose, GitHub Actions.

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

## Constraints

- **Tech stack**: React 18 + Vite on client, Express ESM on server
- **Deploy target**: Oracle arm64 VPS — Docker images must be linux/arm64
- **No new dependencies** unless justified by a specific feature milestone

---

*Last updated: 2026-06-04 after v1 milestone close*
