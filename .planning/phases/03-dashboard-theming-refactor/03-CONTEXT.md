# Phase 3: Dashboard Theming Refactor - Context

**Gathered:** 2026-06-10
**Status:** Ready for planning
**Mode:** Autonomous smart discuss — recommended answers accepted per user directive (no checkpoints)

<domain>
## Phase Boundary

Migrate the dashboard's hardcoded brand colour (the ~14 Material Tailwind
`color="green"` props and ~37 `green/emerald` Tailwind utility classes) onto a
runtime CSS-variable layer fed by the logged-in user's saved company palette
(Phase 2's four-colour `primary`/`accent`/`light`/`dark` palette). A company
with no custom palette must look pixel-identical to the current app, and
tenants must be visually isolated from each other.

Out of scope: email theming (Phase 4), any new UI surface, palette editing
(done in Phase 2), and contrast/accessibility calculations (explicitly deferred
in Phase 2 D-09).

</domain>

<decisions>
## Implementation Decisions

### CSS variable mechanism
- Tailwind config gains a `brand` colour family whose shades resolve to CSS
  variables (e.g. `brand-600` → `var(--brand-600)`), so `bg-green-600` →
  `bg-brand-600` is a mechanical, reviewable swap that keeps hover/focus
  variants working.
- Default values for every `--brand-*` variable are declared in global CSS on
  `:root` and equal the **exact green/emerald hexes currently rendered** at the
  migrated call-sites (Tailwind green scale + Material Tailwind green), so the
  no-palette fallback is visually identical to pre-v3 (THEME-03).
- For a company with a custom palette, a shade scale is computed at runtime in
  JS from the four saved colours (tint/shade interpolation anchored on
  `primary`, with `light`/`dark`/`accent` informing the extremes and hover
  steps).
- A small effect (in or next to `BrandingProvider`) writes the variables to
  `document.documentElement` whenever branding state changes — palette applies
  without a page reload (success criterion 1) and reuses the Phase 2
  fetch/refresh flow.

### Material Tailwind `color="green"` props
- Material Tailwind's `color` prop is a fixed enum and cannot take hex (locked
  in STATE.md). The 14 prop sites drop the enum prop and are styled via
  brand-variable `className` utilities instead.
- Hover/focus/active treatments replicate the visual weight MT generated
  (e.g. darker shade on hover) using `hover:`/`focus:` brand utilities.
- No global Material Tailwind ThemeProvider override — too blunt; it would
  re-theme unrelated component defaults.

### Brand vs semantic green classification
- Not every green call-site is brand chrome. During planning, every site from
  the inventory is classified as either **brand** (buttons, nav highlights,
  links, brand accents → migrate to `brand-*`) or **semantic success**
  (success alerts, validation ticks, "copied" confirmations → keep green and
  list as a documented exclusion).
- Success criterion 4 ("no hardcoded green remains") applies to the migrated
  brand call-sites; the exclusion list is recorded in the plan/summary so the
  classification is auditable.

### Tenant isolation & lifecycle
- CSS variables derive exclusively from the in-memory branding context of the
  authenticated user. On logout or company change the variables reset to the
  green defaults. The palette is never written to localStorage — no
  cross-account leakage on shared machines (THEME-04).
- Auth/branding context changes drive re-theming; no reload, no flash of the
  wrong tenant's colour (defaults render until the palette fetch resolves).

### Claude's Discretion
- Exact shade-derivation algorithm (mix ratios, which anchor maps to which
  shade), file layout/naming for the theme module, and whether `emerald-400`
  maps onto the same brand scale or its own variable.
- Whether the variable writer lives inside BrandingProvider or a sibling
  component/hook.
- Test organization, following existing project patterns.

### UI-SPEC
- Skipped deliberately: this phase introduces no new UI surface — the design
  contract is "today's dashboard, with the brand hue swapped at runtime".

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `client/src/context/branding.jsx` — Phase 2 BrandingProvider: exposes
  `branding.palette` (`primary`/`accent`/`light`/`dark`), `isCustom`,
  `refreshBranding()`; already refetches on auth/company change. DEFAULT_PALETTE
  is the olive `#B4B239` family.
- `client/src/hooks/useBranding.js` — company-name branding hook.
- Tailwind config at `client/tailwind.config.cjs` (verify exact filename) —
  extension point for the `brand` colour family.

### Established Patterns
- Vite + React 18, Material Tailwind components, Heroicons; `@` → `client/src`.
- Phase 2 verified branding fetch + sidebar logo display.

### Call-site inventory (2026-06-10 grep)
- 14 `color="green"` props: sign-up.jsx (1), deep-similarity.jsx (1),
  molstar3d.jsx (3), simulation.jsx (4), blog.jsx (2), dashboard-navbar.jsx (3).
- 37 green/emerald utility usages, dominated by `text-green-600` (13),
  `text-green-500` (8), `bg-green-600` (4), `bg-green-50` (4),
  `border-green-200` (3), plus singletons incl. `text-emerald-400`,
  `hover:bg-green-700`.

### Integration Points
- `client/src/layouts/dashboard.jsx` and `client/src/widgets/layout/sidenav.jsx`
  consume branding today; the variable-writer effect must cover all routes the
  migrated call-sites render under (including auth/main pages if their sites
  are classified as brand).

</code_context>

<specifics>
## Specific Ideas

- The swap should be mechanical and reviewable: same shade number, `green` →
  `brand`, with defaults guaranteeing pixel-identical fallback.
- A blue-palette tenant must not get blue success checkmarks — classification
  matters more than raw count.

</specifics>

<deferred>
## Deferred Ideas

- Contrast/accessibility validation of admin-chosen palettes (explicitly out of
  scope per Phase 2 D-09).
- Per-company theming of the public marketing pages for anonymous visitors
  (branding requires a logged-in tenant).

</deferred>
