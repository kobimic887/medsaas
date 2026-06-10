---
gsd_state_version: 1.0
milestone: v3
milestone_name: Company Brand Colour
status: executing
last_updated: "2026-06-10T15:39:31.152Z"
last_activity: 2026-06-10
progress:
  total_phases: 4
  completed_phases: 2
  total_plans: 7
  completed_plans: 6
  percent: 50
---

# Project State: ChemBench

## Project Reference

See: `.planning/PROJECT.md` (updated 2026-06-06)

**Core value:** Labs and customers get a professional, focused tool — each company's space reflects its own brand, not a shared hardcoded green.
**Current focus:** Phase 3 — Dashboard Theming Refactor

---

## Current Position

Phase: 3 (Dashboard Theming Refactor) — EXECUTING
Plan: 3 of 3
Status: Ready to execute
Last activity: 2026-06-10 -- Completed 03-02 (feature-page brand-site migration)

Progress: [█████████░] 86%

## Performance Metrics

**Velocity:**

- v3 plans completed: 4
- Average duration: ~8 min
- Total execution time: ~29 min

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01 | 1 | ~20 min | ~20 min |
| 02 | 3/3 | ~9 min | ~3 min |
| 03 | 1/3 | ~5 min | ~5 min (P03-01: 3 tasks, 4 files) |

*Updated after each plan completion*
| Phase 03 P02 | 4min | 3 tasks | 6 files |

## Accumulated Context

### Key Decisions

- v3 theming is a runtime CSS-variable refactor, not a config swap — ~51 hardcoded green sites require migration
- ADMIN-01/03 co-located with Phase 2 (logo upload requires the admin page to exist)
- LOGO-04 in Phase 2 ("see the logo you just uploaded" completes the branding capability)
- Email colour inlined per-send (separate mechanism from CSS variables — email clients strip variables)
- Logo stored in MongoDB binary field on company doc — no GridFS, no object storage
- `node-vibrant`/`sharp` spike in Phase 1 mirrors v2 arm64 spike-before-commit precedent
- Material Tailwind `color="green"` is a fixed enum and cannot take arbitrary hex — those sites must move to CSS-variable-driven styling
- Company branding is stored as a four-color palette plus normalized PNG bytes on the Mongo company document
- Branding management is the second local-state Company Admin tab; member direct access redirects to dashboardHome
- Brand theming uses a Tailwind `brand-*` family in `rgb(var(--brand-N) / <alpha-value>)` channel form so opacity modifiers work; `:root` defaults are MD-green channels (76 175 80...) overridden at runtime by BrandingProvider (Phase 3 Plan 1)
- Tenant palette is written to `document.documentElement` and removed on logout/company-switch; never persisted to localStorage (THEME-04) (Phase 3 Plan 1)
- Feature-page brand chrome (CTAs, cart icons, search header, MW slider, price/cart-total, similarity readout, highlight panel, download button) migrated to `brand-*`; semantic-success/categorical/terminal greens kept green per documented exclusion list (Phase 3 Plan 2)

### Active Blockers

- None. Phase 2 passed verification and Phase 3 is unblocked.

### Notes for Next Session

- Plan Phase 03 Dashboard Theming Refactor against the shared branding provider and saved four-color palette
- Phase 1 proved `node-vibrant@4.0.4` + `sharp@0.34.5` under Bun in the native arm64 production container
- Phase 2 completed all 11 LOGO, PALETTE, and ADMIN requirements
- Phase 3 should migrate the remaining hardcoded dashboard brand colors onto runtime CSS variables

---

*State initialized: 2026-06-06 — v3 Company Brand Colour roadmap created (4 phases, 18 requirements)*
