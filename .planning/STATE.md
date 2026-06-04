---
gsd_state_version: 1.0
milestone: v2
milestone_name: (next milestone — not yet named)
status: Planning
last_updated: "2026-06-04T00:00:00.000Z"
progress:
  total_phases: 0
  completed_phases: 0
  total_plans: 0
  completed_plans: 0
  percent: 0
---

# Project State: ChemBench

## Project Reference

See: `.planning/PROJECT.md` (updated 2026-06-04)

**Core value:** Labs and customers get a professional, focused tool — not a rebranded demo with debug artifacts.
**Current focus:** Planning next milestone (v2)

---

## Current Position

**Milestone v1 complete.** All 3 phases shipped 2026-06-04.
Archive: `.planning/milestones/v1-ROADMAP.md`

**Next:** Start v2 with `/gsd:new-milestone`

---

## Phase Status (v1 — archived)

| Phase | Status |
|-------|--------|
| 1. Branding Cleanup | ✅ Complete |
| 2. Login Code Cleanup | ✅ Complete |
| 3. CI/CD Pipeline | ✅ Complete |

---

## Accumulated Context

### Key Decisions Recorded

- Replace Pyxis image backgrounds with CSS gradients (no new assets)
- Remove client-side IP fetch entirely (server has `req.ip`)
- Leave forgot-password link as dead `href="#"` (deferred to v2)
- Native arm64 deploy via SSH/SCP — no QEMU, no registry

### Active Blockers

None.

### Notes for Next Session

- Branch `feature/company-ligand-config` is one commit ahead of main: per-company ligand service config + admin ligand upload. Merge to main first.
- `tester123` server-side bypass still exists in `server/index.js` (lines ~2406, ~2553) — SEC-V2-01, not yet removed
- `deploy.yml` push trigger is commented out — one line to enable auto-deploy on merge to main

---

*State initialized: 2026-06-03*
*Last updated: 2026-06-04 after v1 milestone close*
