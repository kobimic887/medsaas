# design-sync notes — ChemBench Design System

Repo-specific gotchas for `/design-sync`. Append a bullet whenever a sync teaches us something.

## Shape & build
- This is a **Vite app**, not a component library. There is no library `dist/` and no `.d.ts`. We run the package shape in **synth-entry mode**: `--entry ./client/.ds-entry.jsx` (a hand-written barrel) makes the converter resolve `PKG_DIR=client/`, and `componentSrcMap` pins all 10 components by source path.
- `client/.ds-entry.jsx` is a **sync input** (committed): it re-exports the 10 components AND defines `DsPreviewProvider` (MemoryRouter + the app's controller/auth/theme providers) used as `cfg.provider`.
- Components are `.jsx` with PropTypes — ts-morph extracts nothing, so `.d.ts` bodies come entirely from `cfg.dtsPropsFor` (hand-written from each file's PropTypes). Keep those in sync if props change. `DashboardNavbar` and `MainNavbar` take no props.
- The `@/` alias (`@/* -> src/*`) resolves via `cfg.tsconfig: "jsconfig.json"` (JSONC with trailing commas; baseUrl `client/`).

## Brand tokens (the v3 feature — fidelity-critical)
- `cfg.cssEntry` = the **compiled** app CSS `dist/assets/index-<hash>.css`. It contains both the `--brand-*` `:root` defaults (from `src/tailwind.css`) AND every `bg-brand-*`/`text-brand-*` utility class. Pointing at the raw `src/tailwind.css` would NOT work (it's `@tailwind` directives, uncompiled).
- After any build, confirm `--brand-500` is present in `ds-bundle/_ds_bundle.css` and reachable from `styles.css` — otherwise all brand colors render transparent/black.

## Fonts
- App loads **Roboto** via a Google Fonts `<link>` in `client/index.html` (Material Tailwind default). Previews render in system sans (no link injected) — visually close; acceptable.
- **Inter** / **Outfit** are referenced only in `src/tailwind.css` landing-page classes (`.cb-*`) with `system-ui` fallbacks; they are never bundled or loaded by the app. The synced **dashboard** components do not use them. Suppressed via `cfg.runtimeFontPrefixes: ["Inter","Outfit"]`. If a future maintainer wants the brand display fonts in previews, ship woff2 via `cfg.extraFonts`.

## Layout widgets (user chose force-include all)
- `Sidenav`, `DashboardNavbar`, `MainNavbar` read router + app contexts → only render inside `DsPreviewProvider`. `Navbar` needs router only. `Footer` is clean.
- `DashboardNavbar` fires `fetch(/validate-token)` and other network calls in `useEffect` — these fail harmlessly offline in headless capture; the chrome still renders. If it can't render at all it falls to the floor card.

## Preview decisions (carry forward)
- **Previews render in LIGHT mode by design.** The app defaults to DARK (`DEFAULT_THEME="dark"` in `context/theme.jsx`, which sets `<html class="dark">`). `DsPreviewProvider` in `client/.ds-entry.jsx` deliberately swaps `ThemeModeProvider` for a fixed light `ThemeModeContext` value (no-op `toggleTheme`) so the canonical, light-first showcase renders. Documented for the agent in `conventions.md`.
- **`StatisticsChart` previews must disable ApexCharts animations** (`chart.animations.enabled:false`) or the static screenshot captures bars/line at zero. See `previews/StatisticsChart.tsx`.
- **Layout viewports**: `Sidenav` needs ≥1280px (`cfg.overrides.Sidenav.viewport`), navbars/footer use fixed-position-friendly single-mode viewports. `StatisticsCard` uses `cardMode:column` (its 4-color grid overflows a grid cell).
- `conventions.md` is the design-agent header (`readmeHeader`); re-validate its named classes/components against the build on re-sync.

## Re-sync risks (watch-list)
- **`client/.ds-entry.jsx` is a committed sync input** (barrel + `DsPreviewProvider`) living outside `.design-sync/`. Don't delete it; keep its exports in sync with `componentSrcMap`.
- **`cfg.cssEntry` hash is pinned.** If the client app is rebuilt (`bun --cwd=client run build`), the `dist/assets/index-<hash>.css` filename changes and `cssEntry` must be updated to the new hash, or the build fails `[CSS_IMPORT_MISSING]`.
- `cfg.dtsPropsFor` is hand-derived from PropTypes; it silently goes stale if a component's props change. Re-verify against source on re-sync.
- The bundle pulls `@material-tailwind/react`, `@heroicons/react`, `apexcharts`/`react-apexcharts` from `client/node_modules` — a fresh clone needs `bun --cwd=client install` first.
