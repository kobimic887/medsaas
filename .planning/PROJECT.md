# ChemBench — Cleanup v1

## What This Is

ChemBench is a SaaS platform for chemistry laboratories to host branded digital spaces where customers can explore compound libraries, run molecular simulations, and purchase ligands. It is a multi-tenant Express + React monorepo with billing via Stripe, scientific microservices (ADMET, GROMACS, Glioblastoma), and 3D molecular visualization.

This project tracks a focused cleanup milestone: removing all Pyxis Discovery branding remnants and tidying the login/auth code before new feature work begins.

## Core Value

Labs and their customers never see any trace of the old Pyxis branding, and the login code is clean enough that the next developer isn't confused by debug special-cases.

## Requirements

### Validated

- ✓ Multi-tenant company/user system with owner/admin/member roles — existing
- ✓ JWT auth with email verification, invite flow, password policy — existing
- ✓ Stripe billing with plan catalog and credit-based token economy — existing
- ✓ Simulation endpoints (DiffDock, ADMET, GROMACS, Glioblastoma) with token consumption — existing
- ✓ Molecule visualization with Ketcher (2D) and Molstar (3D) — existing
- ✓ ChemBench rebrand from Pyxis on landing page, sign-in, and dashboard — existing (partial — cleanup needed)

### Active

- [ ] **BRAND-01**: Remove all `pyxis` strings from client source files (`pyxisImages.js`, `pyxisServicesImages.js`, import references in `services.jsx`)
- [ ] **BRAND-02**: Rename image data files from `pyxisImages.js` / `pyxisServicesImages.js` to neutral names (`libraryImages.js` / `servicesImages.js`)
- [ ] **BRAND-03**: Replace `pyxis-hero.jpg`, `pyxis-team.jpeg`, `pyxis-lab.jpeg` background references in `about-us.jsx` with CSS gradient placeholders
- [ ] **BRAND-04**: Remove Pyxis strings from `server/index.js` (email subject line ~line 4821, JSDoc example ~line 4861)
- [ ] **LOGIN-01**: Remove the `tester123`-specific IP-storage block from `sign-in.jsx` (lines 55–67)
- [ ] **LOGIN-02**: Remove the duplicate `api.ipify.org` fetch at sign-in top (lines 22–30) — server already has `req.ip`
- [ ] **LOGIN-03**: Remove `console.log('Tester123 IP stored:', ...)` production leak

### Out of Scope

- Forgot password flow — not being built in this cleanup; dead link stays as-is
- Security hardening (CORS, JWT revocation, helmet, ReDoS) — real security work, separate milestone
- `tester123` server-side token-bypass (lines 2406, 2553) — critical but server-side; separate security pass
- Dead code removal (legacy/, packages/dashboard-template/) — bigger change, separate milestone

## Context

The app was originally built as "Pyxis Discovery" and partially rebranded to ChemBench. The landing page, sign-in, and dashboard were updated in a prior commit (84b8c86), but several files were missed:

- `client/src/data/pyxisImages.js` and `pyxisServicesImages.js` — data files with Pyxis in filename and internal comments
- `client/src/pages/main/about-us.jsx` — references `/img/pyxis-hero.jpg`, `/img/pyxis-team.jpeg`, `/img/pyxis-lab.jpeg`
- `client/src/pages/main/services.jsx` — imports from `pyxisServicesImages`
- `server/index.js` — "Test Email from Pyxis Discovery" subject, "Welcome to Pyxis Discovery" JSDoc example

The login page fetches the user's IP from `api.ipify.org` twice on the `tester123` path — once at the top of `handleSubmit` and again in the success block. The server already receives `req.ip`, making browser-side IP collection unnecessary and misleading.

## Constraints

- **Tech stack**: React 18 + Vite on client, Express ESM on server — no new dependencies for this cleanup
- **Scope**: File edits only — no new routes, no schema changes, no dependency bumps
- **Images**: Replace Pyxis image references with CSS gradients; do not add new image assets

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Replace Pyxis image backgrounds with CSS gradients | User wants generic placeholders; no new assets needed | — Pending |
| Remove client-side IP fetch entirely | Server has `req.ip`; browser fetch is spoofable and doubles as a privacy concern | — Pending |
| Leave forgot-password link as dead `href="#"` | Explicitly deferred by user | — Pending |

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
*Last updated: 2026-06-03 after initialization*
