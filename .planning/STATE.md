---
gsd_state_version: 1.0
milestone: v3
milestone_name: Company Brand Colour
status: planning
last_updated: "2026-06-06T08:33:26.770Z"
last_activity: 2026-06-06 — Roadmap created for v3
progress:
  total_phases: 4
  completed_phases: 0
  total_plans: 0
  completed_plans: 0
  percent: 0
---

# Project State: ChemBench

## Project Reference

See: `.planning/PROJECT.md` (updated 2026-06-06)

**Core value:** Labs and customers get a professional, focused tool — each company's space reflects its own brand, not a shared hardcoded green.
**Current focus:** v3 — Company Brand Colour. Phase 1: Compatibility Spike (not yet started)

---

## Current Position

Phase: 1 of 4 (Compatibility Spike)
Plan: —
Status: Ready to plan
Last activity: 2026-06-06 — Roadmap created for v3

Progress: [░░░░░░░░░░] 0%

## Performance Metrics

**Velocity:**

- v3 plans completed: 0
- Average duration: —
- Total execution time: —

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| v3 phases | TBD | - | - |

*Updated after each plan completion*

## Accumulated Context

### Key Decisions

- v3 theming is a runtime CSS-variable refactor, not a config swap — ~51 hardcoded green sites require migration
- ADMIN-01/03 co-located with Phase 2 (logo upload requires the admin page to exist)
- LOGO-04 in Phase 2 ("see the logo you just uploaded" completes the branding capability)
- Email colour inlined per-send (separate mechanism from CSS variables — email clients strip variables)
- Logo stored in MongoDB binary field on company doc — no GridFS, no object storage
- `node-vibrant`/`sharp` spike in Phase 1 mirrors v2 arm64 spike-before-commit precedent
- Material Tailwind `color="green"` is a fixed enum and cannot take arbitrary hex — those sites must move to CSS-variable-driven styling

### Active Blockers

- None. Phase 1 spike must pass before feature phases begin.

### Notes for Next Session

- Start with `/gsd:plan-phase 1` (Compatibility Spike)
- Phase 1 is COMPAT-01 only: prove `node-vibrant`/`sharp` under Bun in `oven/bun` arm64 container
- Phase 2 is the largest slice (11 requirements: all LOGO, PALETTE, ADMIN)
- Phase 3 (THEME) and Phase 4 (EMAIL) both depend on Phase 2's palette being saved

---

*State initialized: 2026-06-06 — v3 Company Brand Colour roadmap created (4 phases, 18 requirements)*
