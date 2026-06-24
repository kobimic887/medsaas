# ChemBench Design System — how to build with it

These components are React, built on **Material Tailwind** (`@material-tailwind/react`) and **Tailwind CSS**. Style with Tailwind utility classes and Material Tailwind component props — do not hand-write CSS.

## Wrapping & setup

- **Cards & charts need no wrapper** — `MessageCard`, `ProfileInfoCard`, `StatisticsCard`, `StatisticsChart`, `BrandingPreview` render standalone from props.
- **Layout/navigation components need context.** `Sidenav`, `Navbar`, `DashboardNavbar`, `MainNavbar`, `Footer` read React Router and app contexts. Wrap any screen that uses them in a router (`BrowserRouter`/`MemoryRouter`) plus the controller, auth, and theme providers.
- `DsPreviewProvider` (exported by the bundle) composes all of those for convenience, but it **pins light theme and stubs the theme toggle (no-op)** — use it for static layout, but for a real working theme (the app's own default is **dark**), wire the actual providers instead.
- **Layout chrome is positioned, not in-flow.** `Sidenav` is `fixed` (full-height left rail), `Footer` is `fixed bottom-0`, the navbars are `sticky`/`fixed` top — they overlay the page, so leave space for them rather than treating them as block elements.
- **`Sidenav` is hidden below 1280px** (`xl:` breakpoint): it only shows on `xl`+ viewports unless its sidenav controller is opened. Design dashboards at `xl` width, or it appears off-screen.
- `StatisticsChart` takes a full ApexCharts config via its `chart` prop (`{ type, height, series, options }`).

## Styling idiom

**1. Material Tailwind props** carry the design language — style via `variant`, `color`, `size`, not classes:
- `<Button variant="gradient" color="green" size="sm">`, `<Typography variant="h6" color="blue-gray">`, `<Card>`, `<CardHeader variant="gradient" color="blue">`.
- `color` accepts Material Tailwind palette names: `blue-gray`, `gray`, `green`, `blue`, `pink`, `orange`, `purple`, `red`, etc. Body text uses the `blue-gray` family (`text-blue-gray-500`, `text-blue-gray-900`).

**2. The brand color family** is this system's signature. Use `*-brand-{50..900}` Tailwind utilities for anything that should follow the company's palette — they resolve to `rgb(var(--brand-NNN))` CSS variables that `BrandingProvider` overrides per company at runtime (default = Material green). Opacity modifiers work (e.g. `bg-brand-500/20`). Real classes in the bundle:
`bg-brand-{50,200,500,600}` · `text-brand-{500,600}` · `border-brand-{200,500}` · `from-brand-600` · `to-brand-400` · `shadow-brand-500` · `hover:bg-brand-{50,500,700}`. The full `--brand-50` … `--brand-900` scale is defined in the stylesheet. **Prefer `brand-*` over hard-coded colors** so designs stay on-brand.

**3. Dark mode** uses Tailwind's class strategy: components ship `dark:` variants (e.g. `dark:bg-slate-900`, `dark:text-slate-100`). Toggle by adding `class="dark"` to `<html>`.

## Where the truth lives

- **Styles**: `styles.css` → `_ds_bundle.css` (the compiled Tailwind + brand-token CSS, including the `--brand-*` defaults). Read it before styling.
- **Per component**: `components/<group>/<Name>/<Name>.d.ts` (the props contract) and `<Name>.prompt.md` (usage). Groups: `cards`, `charts`, `layout`, `general`.

## Example

Components are loaded onto `window.ChemBench` from the root `_ds_bundle.js` (see README for mounting). Pull them off the global:

```jsx
const { StatisticsCard } = window.ChemBench;

<StatisticsCard
  color="green"
  icon={<BeakerIcon className="h-6 w-6 text-white" />}
  title="Simulations"
  value="3,610"
  footer={<p className="text-sm text-blue-gray-600"><span className="text-brand-600 font-bold">+5%</span> than yesterday</p>}
/>
```
