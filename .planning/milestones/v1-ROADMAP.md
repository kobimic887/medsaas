# Milestone v1: ChemBench Cleanup

**Status:** ✅ SHIPPED 2026-06-04
**Phases:** 1–3
**Total Plans:** 3

## Overview

Removed all Pyxis Discovery branding from the codebase, cleaned up debug-era
code in the sign-in page, and established a GitHub Actions CI/CD deploy pipeline.
This milestone makes the codebase presentable for new developers and customers
who should only ever see ChemBench.

## Phases

### Phase 1: Branding Cleanup

**Goal**: No file in the codebase references "Pyxis" or Pyxis-named assets — labs and customers see only ChemBench
**Depends on**: Nothing (first phase)
**Requirements**: BRAND-01, BRAND-02, BRAND-03, BRAND-04, BRAND-05, BRAND-06

Plans:
- [x] Inline execution (freeform PLAN.md, commits d71efdf, 71e8d56, e641eaf, ee97da1)

**Details:**
- Renamed `pyxisImages.js` → `libraryImages.js`, `pyxisServicesImages.js` → `servicesImages.js`
- Updated all importers in `about-us.jsx`, `services.jsx`, `mainhome.jsx`
- Replaced Pyxis image backgrounds with CSS gradients in `about-us.jsx`
- Removed Pyxis strings from `server/index.js` email subject and JSDoc
- Updated `index.html` titles and meta tags; reviewed favicon (brand-neutral, no change)
- Added `npm run test:brand` regression guard

---

### Phase 2: Login Code Cleanup

**Goal**: The sign-in page contains no debug-specific logic, no client-side IP fetching, and no console leaks
**Depends on**: Phase 1
**Requirements**: LOGIN-01, LOGIN-02, LOGIN-03

Plans:
- [x] 02-01: Delete api.ipify.org fetches and tester123 block from sign-in.jsx (commit 38edb3e)

**Details:**
- Removed `api.ipify.org` fetch and `ip_address` from POST body (server has `req.ip`)
- Removed `if (username === "tester123")` IP-storage block
- Removed `console.log('Tester123 IP stored:', ...)` production leak
- `handleSubmit` reduced from 64 to 34 lines

---

### Phase 3: CI/CD Pipeline

**Goal**: The repository automatically builds a Docker image on merges to the main branch via GitHub Actions.
**Depends on**: Phase 2
**Requirements**: DEPLOY-01

Plans:
- [x] 03-01: Create deploy workflow (commits 7a566b0 through 04d2110)

**Details:**
- Created `.github/workflows/deploy.yml`
- Final approach: `git archive | scp | docker compose up --build` natively on Oracle arm64 VPS
- Rejected GHCR/QEMU approach (slow, registry dependency)
- Trigger: `workflow_dispatch` (manual). `push: branches: [main]` present but commented out

---

## Milestone Summary

**Key Decisions:**
- Replace Pyxis image backgrounds with CSS gradients (no new assets)
- Remove client-side IP fetch entirely (server has `req.ip`; browser fetch is spoofable)
- Leave forgot-password link as dead `href="#"` (explicitly deferred to v2)
- Native arm64 build on box over SSH vs GHCR registry approach (faster, simpler)

**Issues Resolved:**
- GSD SDK phase discovery broken (non-standard directory nesting) — worked inline for Phase 1, created standard `02-*/03-*/` dirs for Phases 2–3
- REQUIREMENTS.md checkboxes not checked off after Phase 1 — corrected at milestone close

**Issues Deferred to v2:**
- Forgot-password flow (AUTH-V2-01)
- Server-side `tester123` token-bypass guards (SEC-V2-01)
- Unauthenticated endpoint security (SEC-V2-02)
- CORS/Helmet hardening (SEC-V2-03, SEC-V2-04)
- Auto-deploy on push to main (push trigger commented out in deploy.yml)

**Technical Debt Incurred:**
- `deploy.yml` trigger is manual-only — one line uncomment to enable auto-deploy

---

*For current project status, see .planning/ROADMAP.md*
