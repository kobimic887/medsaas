# Phase 3: Dashboard Theming Refactor - Pattern Map

**Mapped:** 2026-06-10
**Files analyzed:** 17 (4 infrastructure + 13 call-site files)
**Analogs found:** 15 / 17 (2 patterns have no codebase analog — see "No Analog Found")

## CRITICAL FINDINGS (read before planning)

These three facts change what "pixel-identical fallback" means and how the `brand` family must be defined:

1. **`withMT` REPLACES the Tailwind color palette — `green` is Material Design green, not Tailwind green.**
   Verified by evaluating `withMT({})` from `@material-tailwind/react@2.1.4` and by inspecting built CSS
   (`client/dist/assets/index-10f5025d.css` → `.bg-green-600 { background-color: rgb(67 160 71 / ...) }`).
   The effective green scale every migrated call-site currently renders is:

   | Shade | Hex | RGB channels |
   |-------|-----------|--------------|
   | 50  | `#e8f5e9` | `232 245 233` |
   | 100 | `#c8e6c9` | `200 230 201` |
   | 200 | `#a5d6a7` | `165 214 167` |
   | 300 | `#81c784` | `129 199 132` |
   | 400 | `#66bb6a` | `102 187 106` |
   | 500 | `#4caf50` | `76 175 80` |
   | 600 | `#43a047` | `67 160 71` |
   | 700 | `#388e3c` | `56 142 60` |
   | 800 | `#2e7d32` | `46 125 50` |
   | 900 | `#1b5e20` | `27 94 32` |

   The `:root` `--brand-*` defaults MUST use these hexes (THEME-03), not Tailwind's `#22c55e` family.

2. **Opacity modifiers are required, so brand variables must be RGB channel triplets.**
   Replicating Material Tailwind's green treatments needs classes like `shadow-brand-500/20`,
   `hover:shadow-brand-500/40`, `hover:bg-brand-500/10`, `active:bg-brand-500/30`. Tailwind can only apply
   `/opacity` to a CSS-variable color if the family is defined as
   `"rgb(var(--brand-500) / <alpha-value>)"` with the variable holding space-separated channels
   (e.g. `--brand-500: 76 175 80`). Plain hex variables would break every `/N` modifier.

3. **`text-emerald-400` (mainhome.jsx:204) is a dead class.** `withMT` sets `theme.colors` outright and
   `emerald` is not in the palette (verified: effective color keys are `inherit, current, transparent, white,
   black, blue-gray, gray, brown, deep-orange, orange, amber, yellow, lime, light-green, green, teal, cyan,
   light-blue, blue, indigo, deep-purple, purple, pink, red`; built CSS contains zero `text-emerald-400`
   rules). The checkmark on the public landing page renders in inherited color today. It is also on a public
   marketing page, which is deferred scope. **Exclude it; optionally note it as pre-existing dead code.**

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `client/tailwind.config.cjs` (modify) | config | build-time transform | itself (current config) | exact |
| `client/src/tailwind.css` (modify) | config/global-style | static declaration | its own `:root { --cb-* }` block (lines 9–18) | exact |
| `client/src/utils/brandTheme.js` (new; name at discretion) | utility | pure transform (palette → shade scale + CSS vars) | `client/src/utils/companyBranding.js` | role-match |
| `client/src/context/branding.jsx` (modify: variable-writer effect) | provider | event-driven (state → DOM side-effect) | its own fetch/reset effect (lines 93–107) | role-match |
| 13 call-site files (modify: class/prop swaps) | component/page | request-response (render) | themselves (excerpts below) | exact |

Call-site files to modify (brand-classified sites only): `client/src/pages/main/blog.jsx`,
`client/src/pages/dashboard/simulation.jsx`, `client/src/pages/dashboard/molstar3d.jsx`,
`client/src/widgets/layout/dashboard-navbar.jsx`, `client/src/pages/dashboard/deep-similarity.jsx`,
`client/src/pages/dashboard/controlpanel.jsx`, `client/src/pages/dashboard/moleculeviewer.jsx`,
`client/src/pages/dashboard/protein-folding.jsx`.

Files touched only by semantic-green sites (likely NO changes; record on exclusion list):
`client/src/pages/auth/sign-up.jsx`, `client/src/data/statistics-cards-data.js`,
`client/src/pages/dashboard/dashboardhome.jsx`, `client/src/pages/dashboard/paidplans.jsx`,
`client/src/pages/main/contact-us.jsx`, `client/src/pages/main/mainhome.jsx`.

## Pattern Assignments

### `client/tailwind.config.cjs` (config, build-time)

**Analog:** itself — current full contents (lines 1–10):

```js
/** @type {import('tailwindcss').Config} */
const withMT = require("@material-tailwind/react/utils/withMT");

module.exports = withMT({
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {},
  },
  plugins: [],
});
```

**Pattern to apply:** add the `brand` family under `theme.extend.colors` (extend merges on top of withMT's
replaced palette — verified withMT deep-merges user config, so `extend` works normally). Use the
`<alpha-value>` channel form per Critical Finding 2:

```js
theme: {
  extend: {
    colors: {
      brand: {
        50:  "rgb(var(--brand-50) / <alpha-value>)",
        100: "rgb(var(--brand-100) / <alpha-value>)",
        200: "rgb(var(--brand-200) / <alpha-value>)",
        300: "rgb(var(--brand-300) / <alpha-value>)",
        400: "rgb(var(--brand-400) / <alpha-value>)",
        500: "rgb(var(--brand-500) / <alpha-value>)",
        600: "rgb(var(--brand-600) / <alpha-value>)",
        700: "rgb(var(--brand-700) / <alpha-value>)",
        800: "rgb(var(--brand-800) / <alpha-value>)",
        900: "rgb(var(--brand-900) / <alpha-value>)",
      },
    },
  },
},
```

---

### `client/src/tailwind.css` (global stylesheet, static)

**Analog:** its own existing `:root` variable block (lines 9–18) — copy this declaration style:

```css
:root {
  --cb-bg:        #0a0a0f;
  --cb-surface:   #12121a;
  --cb-border:    rgba(255,255,255,0.06);
  --cb-purple:    #a855f7;
  ...
  --cb-gradient:  linear-gradient(135deg, #a855f7 0%, #6366f1 40%, #3b82f6 70%, #06b6d4 100%);
}
```

**Pattern to apply:** add a second `:root` block (or extend a new one near the top, clearly commented as the
brand theme defaults) with channel triplets equal to the Material Design green scale from Critical Finding 1:

```css
:root {
  /* Brand theme defaults — Material Design green (what withMT renders for green-*).
     Overridden at runtime by BrandingProvider for companies with a custom palette. */
  --brand-50:  232 245 233;
  --brand-100: 200 230 201;
  --brand-200: 165 214 167;
  --brand-300: 129 199 132;
  --brand-400: 102 187 106;
  --brand-500: 76 175 80;
  --brand-600: 67 160 71;
  --brand-700: 56 142 60;
  --brand-800: 46 125 50;
  --brand-900: 27 94 32;
}
```

Note: `client/src/tailwind.css` is the only global stylesheet (imported in `main.jsx:11`). There is no
`index.css`. The existing `--cb-*` variables style the dark public landing/auth pages and are unrelated —
do not touch them.

---

### `client/src/utils/brandTheme.js` (utility, pure transform) — NEW FILE

**Analog:** `client/src/utils/companyBranding.js` — copy its module conventions:

**Frozen default + named pure exports** (lines 1–16):

```js
export const MAX_LOGO_FILE_SIZE_BYTES = 5 * 1024 * 1024;

export const DEFAULT_BRAND_PALETTE = Object.freeze({
  primary: "#B4B239",
  accent: "#8E8C2D",
  light: "#E9E8C4",
  dark: "#484716",
});

const HEX_COLOR = /^#[0-9A-F]{6}$/;
```

**Hex validation to REUSE, not duplicate** (lines 35–42):

```js
export function normalizeBrandHex(value) {
  const normalized = typeof value === "string" ? value.trim().toUpperCase() : "";
  return HEX_COLOR.test(normalized) ? normalized : null;
}

export function isValidBrandHex(value) {
  return normalizeBrandHex(value) !== null;
}
```

**Pattern to apply:** new module exports pure functions: hex → `"r g b"` channel conversion, the
tint/shade interpolation that derives a 50–900 scale from the four-colour palette (`primary` anchors ~500/600,
`light` anchors the 50 end, `dark` anchors the 900 end, `accent` informs hover steps — exact mix ratios are
Claude's discretion per CONTEXT), plus a frozen `DEFAULT_BRAND_SCALE` whose values are the MD-green channels
(single source of truth shared with the writer's reset path; the CSS `:root` block duplicates them by design
so no-JS first paint is correct). No color-math utility exists anywhere in `client/src` — the interpolation
itself has no analog (see "No Analog Found").

---

### `client/src/context/branding.jsx` (provider, variable-writer effect) — MODIFY

**Analog:** its own existing effect + state shape. The writer is a new sibling effect that follows this
exact lifecycle pattern.

**State shape the writer consumes** (lines 13–25):

```js
const DEFAULT_PALETTE = Object.freeze({
  primary: "#B4B239",
  accent: "#8E8C2D",
  light: "#E9E8C4",
  dark: "#484716",
});

const EMPTY_BRANDING = Object.freeze({
  palette: DEFAULT_PALETTE,
  logo: null,
  isCustom: false,
  updatedAt: null,
});
```

**Effect/reset pattern to copy** (lines 93–107) — note the reset-to-`EMPTY_BRANDING` path on logout/company
change already exists; the writer keys off the same state:

```js
useEffect(() => {
  if (authLoading) return undefined;
  if (!companyId) {
    requestVersion.current += 1;
    setBranding(EMPTY_BRANDING);
    setLoading(false);
    setError(null);
    return undefined;
  }

  refreshBranding().catch(() => {});
  return () => {
    requestVersion.current += 1;
  };
}, [authLoading, companyId, refreshBranding]);
```

**Pattern to apply:** a `useEffect` (inside `BrandingProvider`, or a sibling hook/component per Claude's
discretion) depending on `branding`:
- `branding.isCustom === true` → compute scale via `brandTheme.js`, write each variable with
  `document.documentElement.style.setProperty("--brand-500", "76 175 80")`-style calls.
- `branding.isCustom === false` (covers logout/company-switch, because the provider already resets to
  `EMPTY_BRANDING`) → remove the inline properties (`style.removeProperty`) so the `:root` stylesheet
  defaults show through. Removing (vs re-writing defaults) guarantees byte-identical fallback CSS.
- Nothing is persisted to localStorage (THEME-04). The provider already keeps the palette in memory only.

Branding fetch already re-runs on auth/company change (`companyId` dep), so re-theming without reload
(success criterion 1) falls out of the dependency.

`BrandingProvider` mounts above all routes in `client/src/main.jsx` (lines 23–29:
`AuthProvider → BrandingProvider → BlogProvider → App`), so the variables cover dashboard, auth, and main
layouts alike — no extra mounting work needed.

---

### Call-site files (component swaps)

**Analog for the swap recipes:** Material Tailwind 2.1.4's own theme objects (verified in
`client/node_modules/@material-tailwind/react/theme/components/`). The 14 enum-prop sites must drop
`color="green"` and reproduce these exact class sets with `brand`:

| MT usage | Classes MT renders today | Replacement `className` |
|----------|--------------------------|--------------------------|
| `<Typography color="green">` | `text-green-500` | `text-brand-500` |
| `<Button color="green">` (filled, default) | `bg-green-500 text-white shadow-md shadow-green-500/20 hover:shadow-lg hover:shadow-green-500/40 focus:opacity-[0.85] focus:shadow-none active:opacity-[0.85] active:shadow-none` | same with `brand-500` |
| `<Button variant="gradient" color="green">` | `bg-gradient-to-tr from-green-600 to-green-400 text-white shadow-md shadow-green-500/20 hover:shadow-lg hover:shadow-green-500/40 active:opacity-[0.85]` | same with `from-brand-600 to-brand-400 shadow-brand-500/...` |
| `<IconButton variant="text" color="green">` | `text-green-500 hover:bg-green-500/10 active:bg-green-500/30` | same with `brand-500` |
| `<Alert color="green">` (filled, default) | `bg-green-500 text-white` | semantic site — keep green (see inventory) |
| `<CardHeader variant="gradient" color="green">` | `bg-gradient-to-tr from-green-600 to-green-400` | same with `brand` |

Caveat for the planner: when the enum prop is dropped, MT falls back to its default color variant, so the
replacement `className` must override background/text/shadow completely; spot-check one Button and one
CardHeader visually. (MT class strings are applied via tailwind-merge, so passing the full set in
`className` wins over the default-color classes.)

Utility-class sites are a mechanical same-shade rename: `green-N` → `brand-N` (e.g. `bg-green-600` →
`bg-brand-600`, `hover:bg-green-700` → `hover:bg-brand-700`), brand-classified sites only.

## Complete Call-Site Inventory

Classification hints: **brand** = migrate to `brand-*`; **semantic** = keep green, record on exclusion list.
Items marked *(judgment)* are recommendations — the planner makes the final call per CONTEXT.

### Material Tailwind `color="green"` props (14)

| # | File:Line | Element / context | Hint |
|---|-----------|-------------------|------|
| 1 | `client/src/pages/auth/sign-up.jsx:254` | `Typography` — "account created — you can now sign in" | **semantic** (success confirmation) |
| 2 | `client/src/pages/dashboard/deep-similarity.jsx:151` | `Typography` — similarity % readout | **brand** *(judgment: metric emphasis, not a success state)* |
| 3 | `client/src/pages/main/blog.jsx:241` | `IconButton variant="text"` — edit-post pencil (admin) | **brand** (action affordance) |
| 4 | `client/src/pages/main/blog.jsx:325` | `Button variant="gradient"` — "Create Post" | **brand** (primary CTA) |
| 5 | `client/src/pages/dashboard/molstar3d.jsx:1013` | `Typography` — "1mg: $price" | **brand** *(judgment: cart/pricing emphasis, consistent with #6–7, #12–13)* |
| 6 | `client/src/pages/dashboard/molstar3d.jsx:1077` | `Typography h6` — cart "Total: $" | **brand** |
| 7 | `client/src/pages/dashboard/molstar3d.jsx:1142` | `Typography` — cart line total | **brand** |
| 8 | `client/src/pages/dashboard/simulation.jsx:1439` | `Button size="lg"` — "Search" | **brand** (primary CTA) |
| 9 | `client/src/pages/dashboard/simulation.jsx:1545` | `CardHeader variant="gradient"` — "Search Result" header | **brand** (chrome) |
| 10 | `client/src/pages/dashboard/simulation.jsx:1596` | `Button size="lg"` — "Search" (mobile variant) | **brand** |
| 11 | `client/src/pages/dashboard/simulation.jsx:1909` | `Alert` — "Ctrl+V into Draw molecule" clipboard popup | **semantic** ("copied" confirmation — explicitly listed in CONTEXT) |
| 12 | `client/src/widgets/layout/dashboard-navbar.jsx:461` | `Typography` — cart "Total: $" | **brand** |
| 13 | `client/src/widgets/layout/dashboard-navbar.jsx:484` | `Typography` — cart item price | **brand** |
| 14 | `client/src/widgets/layout/dashboard-navbar.jsx:518` | `Button` — "Send Enquiry" | **brand** (CTA) |

### Green/emerald utility classes (46 class occurrences across 37 lines)

| File:Line | Class(es) | Context | Hint |
|-----------|-----------|---------|------|
| `client/src/data/statistics-cards-data.js:15,26,48` | `text-green-500` (×3) | "+55% than last week" delta footers (red used for negatives) | **semantic** (positive-delta indicator) |
| `client/src/pages/dashboard/dashboardhome.jsx:117,139,150,210,431` | `text-green-500` (×5) | metric deltas, activity ticks, up-arrow | **semantic** |
| `client/src/pages/dashboard/paidplans.jsx:304` | `text-green-500` | plan-feature `CheckIcon` | **semantic** (validation tick) |
| `client/src/pages/dashboard/moleculeviewer.jsx:491,492` | `text-green-500`, `text-green-600` | "RDKit ready" status check | **semantic** (status success) |
| `client/src/pages/dashboard/moleculeviewer.jsx:553` | `bg-green-50 border-green-200` | "Current molecule" highlight panel | **brand** *(judgment: tinted highlight surface, not a success state)* |
| `client/src/pages/dashboard/molstar3d.jsx:791,800` | `bg-green-50 border-green-200`, `text-green-700` | `messageType === 'success'` branch of status banner (blue=info, red=error) | **semantic** (explicit success branch) |
| `client/src/pages/dashboard/controlpanel.jsx:467` | `text-green-600` | ADMET-available `CheckIcon` (red "O" when absent) | **semantic** |
| `client/src/pages/dashboard/controlpanel.jsx:593,603,613,654,664,674,684` | `text-green-600` (×7) | add-to-cart `ShoppingCartIcon`s in price tables | **brand** (interactive cart affordance — matches simulation.jsx cart icons) |
| `client/src/pages/main/contact-us.jsx:92` | `bg-green-100 text-green-800` | "Thank you for contacting us" banner | **semantic** + public marketing page (deferred scope) |
| `client/src/pages/main/mainhome.jsx:204` | `text-emerald-400` | landing-page feature ✓ | **exclude** — public page (deferred) AND dead class (see Critical Finding 3) |
| `client/src/pages/dashboard/simulation.jsx:1318` | `bg-green-50`, `border-green-200` | molecular-weight slider container | **brand** (control chrome) |
| `client/src/pages/dashboard/simulation.jsx:1325,1336,1391` | `bg-green-600` (×3) | slider min/max value chips + active range bar | **brand** |
| `client/src/pages/dashboard/simulation.jsx:1332` | `bg-green-200` | slider background track | **brand** |
| `client/src/pages/dashboard/simulation.jsx:1846,1857,1868` | `text-green-600` (×3) | add-to-cart `ShoppingCartIcon`s (1/5/10mg) | **brand** |
| `client/src/pages/dashboard/simulation.jsx:1951` | `border-green-500 text-green-500 hover:bg-green-50` | "View Sanitized SDF Result" outlined download link | **brand** (action link) |
| `client/src/pages/dashboard/protein-folding.jsx:6` | `border-green-400`, `bg-green-50`, `bg-green-500` | `ENTITY_COLORS.dna` (protein=blue, rna=orange, ligand=purple) | **semantic/categorical** — DNA entity colour-coding must NOT follow tenant palette |
| `client/src/pages/dashboard/protein-folding.jsx:519` | `text-green-600` | "Prediction complete" status text | **semantic** |
| `client/src/pages/dashboard/protein-folding.jsx:524` | `bg-green-600 hover:bg-green-700` | "Download .pdb/.cif" button | **brand** (action button) |
| `client/src/pages/dashboard/protein-folding.jsx:542` | `text-green-300` | terminal-style `<pre>` (green-on-dark output) | **semantic/stylistic** (terminal aesthetic, keep) |

**Tallies (recommended):** MT props — 12 brand / 2 semantic. Utilities — 19 occurrences brand /
26 occurrences semantic-or-excluded. A blue-palette tenant keeps green checkmarks, success banners, positive
deltas, DNA colour-coding, and terminal output (per CONTEXT specifics).

## Shared Patterns

### Branding consumption (apply to anything needing the palette outside the provider)
**Source:** `client/src/hooks/useBranding.js` (lines 5–21) — components never touch the context directly:

```js
export function useBranding(previewCompanyName) {
  const { user } = useAuth();
  const { branding, loading, error, refreshBranding } = useBrandingContext();
  const brandName = getBrandName({ companyName: previewCompanyName, user });
  return {
    brandName,
    ...
    palette: branding.palette,
    isCustomBranding: branding.isCustom,
    ...
  };
}
```

### Import conventions (apply to all new/modified files)
**Source:** `client/src/context/branding.jsx` lines 9–11 — `@` alias to `client/src`, PropTypes on providers:

```js
import PropTypes from "prop-types";
import { useAuth } from "@/context/auth";
import { API_CONFIG, getAuthToken } from "@/utils/constants";
```

### Tenant isolation (apply to the writer effect)
The provider already resets to `EMPTY_BRANDING` when `companyId` disappears (branding.jsx lines 95–101) and
guards stale async responses with `requestVersion`. The writer must piggyback on `branding` state only —
never read/write localStorage (`AuthContext` owns localStorage for auth only; palette stays in memory).

### Verification command
No test suite exists in `client/src` (zero `*.test.*` / `*.spec.*` / `__tests__` files). The project gate is
`npm run check` (server syntax-check + `vite build`). Plans should verify via `bun run build` plus manual
visual check of default (no-palette) rendering; any new unit tests have no existing pattern to follow and
their organization is Claude's discretion per CONTEXT.

## No Analog Found

| Pattern | Role | Reason | Fallback |
|---------|------|--------|----------|
| DOM variable-writer effect (`document.documentElement.style.setProperty`) | provider side-effect | No code in `client/src` writes document-level styles (only reads `documentElement` for scroll math in simulation.jsx:892) | Standard React pattern; lifecycle copied from BrandingProvider's own effect (lines 93–107) |
| Shade-derivation color math (hex interpolation) | utility | No color-math utilities exist in `client/src` | Pure-function module style copied from `utils/companyBranding.js`; algorithm is Claude's discretion per CONTEXT |

## Metadata

**Analog search scope:** `client/src/**` (pages, widgets, layouts, context, hooks, utils, data, config),
`client/tailwind.config.cjs`, `client/src/tailwind.css`, `client/node_modules/@material-tailwind/react`
(theme verification), `client/dist/assets` (rendered-hex verification)
**Files scanned:** ~25 read in part or full; full-tree greps for `color="green"`, green/emerald utilities,
branding consumers, DOM writers
**Material Tailwind version:** `@material-tailwind/react@2.1.4`
**Pattern extraction date:** 2026-06-10
