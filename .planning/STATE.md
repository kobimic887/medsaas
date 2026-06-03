---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: Not started
last_updated: "2026-06-03T19:29:20.603Z"
progress:
  total_phases: 2
  completed_phases: 0
  total_plans: 0
  completed_plans: 0
  percent: 0
---

# Project State: ChemBench Cleanup v1

## Project Reference

**Core Value:** Labs and their customers never see any trace of the old Pyxis branding, and the login code is clean enough that the next developer isn't confused by debug special-cases.
**Current Focus:** Phase 1 — Branding Cleanup

---

## Current Position

**Phase:** 1 — Branding Cleanup
**Plan:** TBD (not yet planned)
**Status:** Not started

**Progress:**

```
[░░░░░░░░░░] 0% — Phase 1 of 2 not started
```

**Requirement Progress:** 0/7 complete

---

## Phase Status

| Phase | Status | Plans |
|-------|--------|-------|
| 1. Branding Cleanup | Not started | TBD |
| 2. Login Code Cleanup | Not started | TBD |

---

## Accumulated Context

### Key Decisions Recorded

- Replace Pyxis image backgrounds with CSS gradients (no new assets)
- Remove client-side IP fetch entirely (server has `req.ip`; browser fetch is spoofable)
- Leave forgot-password link as dead `href="#"` (explicitly deferred)

### Active Blockers

None.

### Notes for Next Session

- Phase 1 scope: `client/src/data/pyxisImages.js`, `pyxisServicesImages.js`, `client/src/pages/main/about-us.jsx`, `client/src/pages/main/services.jsx`, `server/index.js` (~lines 4821, 4861)
- Phase 2 scope: `client/src/pages/auth/sign-in.jsx` (~lines 22–30, 55–67)

---

## Performance Metrics

- Requirements defined: 7
- Requirements complete: 0
- Phases complete: 0/2

---

*State initialized: 2026-06-03*
*Last updated: 2026-06-03 after roadmap creation*
