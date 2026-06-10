---
phase: 03-dashboard-theming-refactor
reviewed: 2026-06-10T18:29:53Z
depth: standard
files_reviewed: 12
files_reviewed_list:
  - client/tailwind.config.cjs
  - client/src/tailwind.css
  - client/src/utils/brandTheme.js
  - client/src/context/branding.jsx
  - client/src/pages/dashboard/simulation.jsx
  - client/src/pages/dashboard/molstar3d.jsx
  - client/src/pages/dashboard/deep-similarity.jsx
  - client/src/pages/dashboard/controlpanel.jsx
  - client/src/pages/dashboard/moleculeviewer.jsx
  - client/src/pages/dashboard/protein-folding.jsx
  - client/src/widgets/layout/dashboard-navbar.jsx
  - client/src/pages/main/blog.jsx
findings:
  critical: 0
  warning: 3
  info: 6
  total: 9
status: findings
warnings_fixed: 3
finding_status:
  WR-01: fixed
  WR-02: fixed
  WR-03: fixed
---

# Phase 3: Code Review Report

**Reviewed:** 2026-06-10T18:29:53Z
**Depth:** standard
**Files Reviewed:** 12
**Status:** findings

## Summary

Reviewed the runtime CSS-variable theming layer (`brand-*` Tailwind family backed by
`--brand-*` variables, JS shade derivation, variable-writer effect in
`BrandingProvider`) and the eight call-site files migrated from `green-*`/`color="green"`
to `brand-*` utilities in this phase.

Verification performed beyond reading:
- Ran the phase diff (`b622b4a..HEAD`) per file to scope review to this phase's
  className changes only.
- Executed `tailwind-merge` 1.8.1 (the version Material Tailwind 2.1.4 bundles)
  against the actual MT default classes for every migrated component shape
  (Button filled gray, Button gradient gray, IconButton text gray, Typography
  `text-inherit`, CardHeader gradient white). All `bg-/text-/shadow-/from-/to-brand-*`
  overrides resolve correctly via `twMerge` — the dropped `color="green"` props do
  not leak gray styling, with one exception (WR-01).
- Confirmed `DEFAULT_BRAND_SCALE` in `brandTheme.js` is byte-identical to the
  `:root` defaults in `tailwind.css` (all 10 shades match).
- Confirmed the writer effect never injects unsanitized values: every written
  value passes through `hexToRgb` validation or falls back to the hardcoded
  default scale, so there is no CSS-injection path (THEME-04 holds).
- Confirmed `BrandingProvider` mounts at the app root (`client/src/main.jsx:24`),
  and the logout path (`companyId` → null) resets state and removes all inline
  `--brand-*` variables. No palette data touches `localStorage`.
- Residual `green-*` references in the migrated files (molstar3d.jsx:791,800;
  controlpanel.jsx:467; simulation.jsx:1906; protein-folding.jsx:6,519,542;
  moleculeviewer.jsx:491-492) were each inspected: all are semantic
  success/status indicators or entity-type legend colors, not brand sites.
  Consistent with the phase's "brand sites only" scope; no action required.

No Critical issues. Three Warnings (one visual regression at a migrated call
site, one robustness gap in the shade-derivation math, one tenant-isolation gap
on direct company switch) and six Info items.

## Warnings

### WR-01: CardHeader migration loses the brand-tinted shadow and leaves a `bg-white` underlay [FIXED — 57c662f]

**File:** `client/src/pages/dashboard/simulation.jsx:1542-1545`
**Issue:** Removing `color="green"` from
`<CardHeader variant="gradient" className="... bg-gradient-to-tr from-brand-600 to-brand-400">`
makes MT fall back to its default `color="white"`, whose gradient variant emits
`bg-white text-gray-700` and — unlike `color="green"` — **no colored shadow**.
Verified with the bundled tailwind-merge 1.8.1: the merged class list is
`... bg-white text-gray-700 shadow-lg ... bg-gradient-to-tr from-brand-600 to-brand-400`.
Two consequences:
1. The header previously rendered `shadow-green-500/40`; now the `shadow-lg` is
   untinted black. This is the one element in the migration whose shadow does not
   follow the tenant palette (every migrated Button explicitly carries
   `shadow-brand-500/20|40`). Visual regression vs. pre-phase behavior and
   inconsistent with the rest of the migration.
2. `bg-white` remains in the class list under the gradient (background-image
   paints over background-color, so it is invisible today, but it is dead
   conflicting styling that will surface if the gradient classes are ever
   refactored away).
**Fix:**
```jsx
<CardHeader
  variant="gradient"
  className="mb-4 grid h-12 place-items-center bg-transparent bg-gradient-to-tr from-brand-600 to-brand-400 shadow-brand-500/40"
>
```
(`bg-transparent` overrides `bg-white` via twMerge; `shadow-brand-500/40`
restores the tinted shadow and re-themes it.)

### WR-02: Shade derivation guarantees neither monotonic darkness nor text contrast — `hover:bg-brand-700` can be lighter than `bg-brand-600` [FIXED — 20c62e0]

**File:** `client/src/utils/brandTheme.js:99-125` (`shadeRecipe`)
**Issue:** The recipe assumes a luminance ordering `light > primary > dark` and
`accent ≈ primary-or-darker`, but nothing enforces it: hex validation here, in
`utils/companyBranding.js`, and in the phase-2 server endpoint only checks the
6-digit hex *format*, never relative luminance. Two concrete failure modes with
format-valid tenant palettes:
1. **Non-monotonic 600 vs 700.** `700 = mix(mix(primary, accent, 0.5), dark, 0.2)`
   while `600 = mix(primary, dark, 0.18)`. If `accent` is lighter than `primary`
   (allowed), brand-700 comes out *lighter* than brand-600, inverting hover
   affordances at call sites like `protein-folding.jsx:524`
   (`bg-brand-600 ... hover:bg-brand-700`).
2. **White-on-light text.** Migrated call sites hardcode `text-white` on
   `bg-brand-500/600` (simulation.jsx Search buttons, dashboard-navbar Send
   Enquiry, blog.jsx Create Post, protein-folding download button). A tenant
   whose `primary` is light (e.g. the palette's own `light` value pasted into
   `primary`) yields unreadable white-on-near-white buttons. Similarly, a dark
   `light` value inverts the `bg-brand-50` + dark-text panels
   (simulation.jsx:1318, moleculeviewer.jsx:553).
**Fix:** Enforce the ordering invariant inside `deriveBrandScale` rather than
trusting input shape — e.g., after resolving the four tuples, sort/clamp by
relative luminance (WCAG formula): ensure `light` is the lightest and `dark`
the darkest of the four (swap or clamp lightness otherwise), and after building
the scale assert `luminance(scale[k]) >= luminance(scale[k+1])` for each step,
falling back to `mix(primary, dark, t)` for any shade that violates the order.
That keeps 600→900 strictly darkening regardless of where the accent sits.

### WR-03: Tenant palette is not reset on a direct company switch — stale `--brand-*` variables persist for the duration of the in-flight fetch [FIXED — 67cfab3]

**File:** `client/src/context/branding.jsx:97-111` (fetch effect), `119-130` (writer)
**Issue:** The reset path (`setBranding(EMPTY_BRANDING)` → writer removes inline
vars) only runs when `companyId` becomes falsy. If `companyId` transitions
directly A→B — which the auth layer permits, since `AuthProvider.login()`
(`client/src/context/auth.jsx:43-53`) replaces `user` without requiring a prior
`logout()` (e.g., signing in as a different account from an already-authenticated
session) — the effect kicks off `refreshBranding()` for company B while company
A's custom `--brand-*` inline variables remain applied to `document.documentElement`.
The version guard only prevents *state* writes from stale responses; it does not
clear the previously written variables. If company B's fetch hangs (no timeout on
this `fetch`), company A's palette stays rendered for company B indefinitely.
This is exactly the tenant-isolation property this phase was meant to guarantee
("variables must reset on logout/company change").
**Fix:** Reset to defaults at the top of the company-scoped effect before
fetching:
```jsx
useEffect(() => {
  if (authLoading) return undefined;
  setBranding(EMPTY_BRANDING);   // drop previous tenant's vars immediately
  setError(null);
  if (!companyId) {
    requestVersion.current += 1;
    setLoading(false);
    return undefined;
  }
  refreshBranding().catch(() => {});
  return () => { requestVersion.current += 1; };
}, [authLoading, companyId, refreshBranding]);
```
(The writer effect then removes the inline vars in the same commit, restoring
the `:root` defaults during the fetch window.)

## Info

### IN-01: `HEX_COLOR` / `normalizeBrandHex` duplicated verbatim from `companyBranding.js`, contradicting the file's own header comment

**File:** `client/src/utils/brandTheme.js:11, 45-48`
**Issue:** `utils/companyBranding.js:10, 35-38` already exports an identical
`normalizeBrandHex` (and the same `HEX_COLOR` regex). The brandTheme.js header
even states it uses "the same hex validation (HEX_COLOR / normalizeBrandHex)
rather than duplicating it loosely" — but it duplicates it exactly instead of
importing. If validation semantics ever change in one copy (e.g., accepting
3-digit hex), the editor's accepted palette and the theme deriver's accepted
palette silently drift.
**Fix:** `import { normalizeBrandHex } from "@/utils/companyBranding";` and
delete the local copy (re-export from brandTheme.js if the standalone-module
property matters).

### IN-02: `DEFAULT_PALETTE` and shade-key list re-declared instead of imported

**File:** `client/src/context/branding.jsx:15, 17-22`
**Issue:** `DEFAULT_PALETTE` duplicates the exported `DEFAULT_BRAND_PALETTE`
(`utils/companyBranding.js:3-8`, same four hex values, also mirrored in
`server/utils/companyBranding.js:7`). `BRAND_SHADE_KEYS` duplicates the
(unexported) `SHADE_KEYS` in brandTheme.js. Three copies of the palette and two
copies of the key list to keep in sync.
**Fix:** Import `DEFAULT_BRAND_PALETTE`; export `SHADE_KEYS` from brandTheme.js
(or derive keys via `Object.keys(DEFAULT_BRAND_SCALE)`).

### IN-03: MD-green default scale maintained in two places (tailwind.css `:root` and `DEFAULT_BRAND_SCALE`)

**File:** `client/src/tailwind.css:9-24`; `client/src/utils/brandTheme.js:30-41`
**Issue:** The 10 channel triplets are currently byte-identical (verified), and
the duplication is acknowledged in comments — but the comment claims the two
copies "share one source of truth," which is the opposite of the situation. If
one copy is edited, non-custom tenants (stylesheet path) and invalid-palette
custom tenants (JS fallback path, which *sets* inline vars from
`DEFAULT_BRAND_SCALE`) render different greens.
**Fix:** Lowest-cost guard: a comment in each file pointing at the other plus a
trivial unit check, or generate the `:root` block from `DEFAULT_BRAND_SCALE` at
build time.

### IN-04: Variable-writer effect has no unmount cleanup

**File:** `client/src/context/branding.jsx:119-130`
**Issue:** If `BrandingProvider` unmounts while custom variables are set, the
inline `--brand-*` values persist on `document.documentElement` (the effect only
removes them when `branding.isCustom` flips false). Benign today because the
provider wraps the whole app in `main.jsx` and never unmounts, but a latent leak
for tests, storybook, or any future scoping of the provider to the dashboard
layout.
**Fix:** Return a cleanup from the effect that runs the `removeProperty` loop.

### IN-05: Non-custom companies expose the olive default palette via context while the rendered theme is MD green

**File:** `client/src/context/branding.jsx:17-29`
**Issue:** When `isCustom: false`, the writer removes inline vars so the UI
renders the MD-green `:root` defaults — but `branding.palette` handed to
consumers is `DEFAULT_PALETTE` (olive `#B4B239` family). Any consumer rendering
swatches/previews from `branding.palette` (e.g., the phase-2 branding editor)
shows olive while the live dashboard around it is green. Internally consistent
choices individually, but the context lies about what is on screen.
**Fix:** Either expose a `paletteApplied: boolean`/`effectivePalette` alongside,
or document on `EMPTY_BRANDING` that `palette` is the *form default*, not the
rendered theme.

### IN-06: Stale/incorrect documentation comments and inconsistent freezing in brandTheme.js

**File:** `client/src/utils/brandTheme.js:7, 95-98, 145-149`
**Issue:** (a) Header comment says conventions include "a frozen default export"
— the module has no default export. (b) The `shadeRecipe` doc block describes a
data-table design ("Each entry: [endpoint, t] where endpoint is one of the
resolved palette tuples") that does not match the implemented switch statement.
(c) `deriveBrandScale` returns the frozen `DEFAULT_BRAND_SCALE` on fallback but
a fresh mutable object on success — a caller that mutates the result works on
the success path and throws `TypeError` (strict-mode ESM) on the fallback path.
**Fix:** Correct both comments; `Object.freeze(scale)` before returning for
consistent semantics.

---

_Reviewed: 2026-06-10T18:29:53Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
