---
phase: 03-dashboard-theming-refactor
plan: 02
subsystem: ui
tags: [tailwind, theming, brand, dashboard, call-site-migration]

# Dependency graph
requires:
  - phase: 03-dashboard-theming-refactor
    plan: 01
    provides: "brand-* Tailwind family resolving to runtime --brand-* CSS variables (MD-green default, re-themed from tenant palette)"
provides:
  - "Feature-page brand chrome (CTAs, cart icons, search header, MW slider, price/cart-total emphasis, similarity readout, highlight panel, download button) migrated to brand-* so it re-tints with the company palette"
  - "Documented semantic-green exclusion list for the six feature pages (success indicators / categorical / terminal kept green)"
affects: [03-03, wave-3-remaining-call-sites]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "MT color=\"green\" enum drop + full brand-* className override (Button/CardHeader/Typography) via tailwind-merge"
    - "Same-shade green-N -> brand-N utility rename for brand-classified chrome only"

key-files:
  created: []
  modified:
    - client/src/pages/dashboard/simulation.jsx
    - client/src/pages/dashboard/molstar3d.jsx
    - client/src/pages/dashboard/deep-similarity.jsx
    - client/src/pages/dashboard/controlpanel.jsx
    - client/src/pages/dashboard/moleculeviewer.jsx
    - client/src/pages/dashboard/protein-folding.jsx

key-decisions:
  - "MT props dropped color=\"green\" and added the full MT-rendered class set in brand-* form (tailwind-merge lets the full className win over the default-color fallback)"
  - "Brand/semantic split followed 03-PATTERNS.md authoritative inventory exactly; every kept-green site is on the exclusion list (T-03-03 mitigation)"
  - "ENTITY_COLORS.dna kept green deliberately — categorical entity colour-coding must NOT follow the tenant palette"

requirements-completed: [THEME-02]

# Metrics
duration: 4min
completed: 2026-06-10
---

# Phase 3 Plan 02: Feature-Page Brand-Site Migration Summary

**Migrated every brand-classified green call-site on the six dashboard feature pages onto the `brand-*` utilities from Plan 01, so feature-page chrome (CTAs, cart icons, search header, sliders, price/cart emphasis, similarity readout, highlight panel, download button) re-tints with the company palette while all semantic-success, categorical, and terminal greens stay green by design.**

## Performance

- **Duration:** ~4 min
- **Started:** 2026-06-10T15:34:14Z
- **Completed:** 2026-06-10T15:38:23Z
- **Tasks:** 3 completed
- **Files modified:** 6

## Accomplishments
- **simulation.jsx:** Search buttons (filled recipe) and the "Search Result" CardHeader (gradient recipe) drop `color="green"` for full brand-* className overrides; MW slider container/track/chips/active range bar, add-to-cart cart icons, and the "View Sanitized SDF Result" action link renamed green-N → brand-N. Clipboard Alert kept green.
- **molstar3d.jsx:** Price (`1mg: $`) and cart-total Typography sites drop `color="green"` for `text-brand-500`. The `messageType==='success'` status-banner branch kept its green utilities.
- **deep-similarity.jsx:** Similarity % readout Typography → `text-brand-500`.
- **controlpanel.jsx:** All seven add-to-cart ShoppingCartIcon sites `text-green-600` → `text-brand-600`. ADMET-available CheckIcon kept green.
- **moleculeviewer.jsx:** Current-molecule highlight panel `bg-green-50 border-green-200` → `bg-brand-50 border-brand-200`. RDKit-ready status kept green.
- **protein-folding.jsx:** Download .pdb/.cif button `bg-green-600 hover:bg-green-700` → `bg-brand-600 hover:bg-brand-700`. ENTITY_COLORS.dna, prediction-complete status, and terminal-style output all kept green.

## Task Commits

Each task was committed atomically:

1. **Task 1: simulation.jsx brand sites** - `efe908b` (feat)
2. **Task 2: molstar3d.jsx + deep-similarity.jsx brand sites** - `8845e9b` (feat)
3. **Task 3: controlpanel.jsx + moleculeviewer.jsx + protein-folding.jsx brand sites** - `bfccf6c` (feat)

**Plan metadata:** (see final docs commit)

## Files Created/Modified
- `client/src/pages/dashboard/simulation.jsx` - Search Buttons + CardHeader brand className recipes; MW slider, cart icons, SDF link green-N → brand-N.
- `client/src/pages/dashboard/molstar3d.jsx` - Price/cart-total Typography → text-brand-500; success banner kept green.
- `client/src/pages/dashboard/deep-similarity.jsx` - Similarity % Typography → text-brand-500.
- `client/src/pages/dashboard/controlpanel.jsx` - Add-to-cart cart icons → text-brand-600; ADMET CheckIcon kept green.
- `client/src/pages/dashboard/moleculeviewer.jsx` - Highlight panel → bg-brand-50 border-brand-200; RDKit-ready kept green.
- `client/src/pages/dashboard/protein-folding.jsx` - Download button → bg-brand-600 hover:bg-brand-700; DNA/status/terminal kept green.

## Decisions Made
See `key-decisions` in frontmatter. The brand/semantic split from 03-PATTERNS.md was authoritative; dropped MT enum props were replaced with the full MT-rendered class set in brand-* form so tailwind-merge overrides the default-color fallback.

## Deviations from Plan

None - plan executed exactly as written.

Two non-substantive notes:
- The single remaining `color="green"` in simulation.jsx is the semantic clipboard Alert; because removing the migrated props shifted line numbers, it now sits at line ~1906 (plan referenced ~1909). Identity confirmed by `Alert color="green"` match, not line number.
- controlpanel's seven cart-icon sites share an identical className string (distinct from the `h-3 w-3` ADMET CheckIcon at line 467), so a single `replace_all` migrated all seven without touching the semantic CheckIcon.

## Issues Encountered
None.

## Threat Surface
No new threat surface. Pure client-side className changes; no new input or data flow. T-03-03 (semantic/brand misclassification) mitigated by following the authoritative 03-PATTERNS.md split — every kept-green site is enumerated on the exclusion list below. T-03-SC: no package installs.

## Documented Semantic-Green Exclusions (kept green by design)
- `simulation.jsx` ~1906 — Alert "copied to clipboard" confirmation (semantic success).
- `molstar3d.jsx` ~791,800 — `messageType==='success'` status banner branch (semantic success).
- `controlpanel.jsx` ~467 — ADMET-available CheckIcon (semantic success).
- `moleculeviewer.jsx` ~491,492 — "RDKit ready" status (semantic status success).
- `protein-folding.jsx` ~6 — ENTITY_COLORS.dna (categorical entity colour-coding; must not follow tenant palette).
- `protein-folding.jsx` ~519 — "Prediction complete" status text (semantic success).
- `protein-folding.jsx` ~542 — terminal-style green-on-dark output (stylistic).

## Known Stubs
None. Every migrated class resolves to the live `brand-*` family wired in Plan 01.

## Verification
- `bun run build` exits 0 after each task (vite build succeeds; brand-* compiles).
- simulation.jsx: only the semantic Alert retains `color="green"`; migrated lines use brand-*.
- molstar3d.jsx: zero `color="green"` on price/cart Typography; success banner branch keeps green.
- deep-similarity.jsx: zero `color="green"`, uses `text-brand-500`.
- controlpanel.jsx: cart icons use `text-brand-600`; line 467 CheckIcon keeps green.
- moleculeviewer.jsx: highlight panel `bg-brand-50`; RDKit-ready keeps green.
- protein-folding.jsx: download button `bg-brand-600 hover:bg-brand-700`; DNA/status/terminal greens preserved.

## Self-Check: PASSED

All six modified files exist on disk and all three task commits (efe908b, 8845e9b, bfccf6c) are present in git history.
