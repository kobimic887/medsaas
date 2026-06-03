# Coding Conventions

_Generated: 2026-06-03_

## Module System

**Client (ESM):** `client/package.json` declares `"type": "module"`. All client files use ES module `import`/`export` syntax. Path alias `@` resolves to `client/src/` via Vite config (`resolve.alias`). Example:

```js
import { API_CONFIG } from "@/utils/constants";
import { useAuth } from "@/context/auth";
```

**Server (ESM):** `server/package.json` also declares `"type": "module"`. All server code uses top-level `import` statements. CommonJS constructs (`require`, `module.exports`) do not appear in `server/index.js`.

**Exception:** `client/prettier.config.cjs` and `client/tailwind.config.cjs` use CommonJS (`module.exports`) because those config tools require it.

## Naming Conventions

**Files:**
- React component files: `kebab-case.jsx` (e.g., `sign-in.jsx`, `generate-molecules.jsx`, `dashboard-navbar.jsx`)
- JS utility files: `camelCase.js` (e.g., `constants.js`, `api.js`, `useBranding.js`)
- Context files: `camelCase.jsx` (e.g., `auth.jsx`, `blog.jsx`, `CartContext.jsx` — inconsistent, `CartContext` is PascalCase)
- Data files: `kebab-case-data.js` (e.g., `statistics-cards-data.js`, `projects-table-data.js`)
- Index barrel files: `index.js` or `index.jsx`

**Components (exported names):** PascalCase named exports — `DashboardHome`, `SignIn`, `StatisticsCard`, `Sidenav`. Most pages export both a named export and a `default` export pointing to the same function.

**Functions (non-component):** camelCase — `fetchActivities`, `handleSubmit`, `buildTenantFilter`, `normalizeCompanyName`, `createRateLimiter`.

**React hooks:** `use` prefix camelCase — `useAuth`, `useBranding`, `useMaterialTailwindController`.

**Variables/constants:**
- Local variables: camelCase (`activityData`, `molPriceStats`)
- Module-level constants: SCREAMING_SNAKE_CASE (`JWT_SECRET`, `PLAN_CATALOG`, `MONGODB_URI`, `TANIMOTO_API_BASE`)
- Environment-derived configs: SCREAMING_SNAKE_CASE on server, `VITE_` prefix vars on client

**Server route handlers:** Inline async arrow functions or named `async function` declarations at module scope (not classes).

## Component Patterns

All React components are **function components**. No class components exist in the codebase.

**Page components** (in `client/src/pages/`):
- Declare local state with `React.useState` (or destructured `useState`) at the top
- Define async fetch functions inside the component body
- Trigger data fetch via `React.useEffect(fetchFn, [])` on mount
- Export pattern: named export + default export (e.g., `export function DashboardHome() { ... }` then `export default DashboardHome;`)

**Widget/UI components** (in `client/src/widgets/`):
- Accept props explicitly, validated with `prop-types`
- Use `PropTypes` for runtime type checking and `defaultProps` for defaults
- Set `displayName` on the component for React DevTools (e.g., `StatisticsCard.displayName = "/src/widgets/cards/statistics-card.jsx"`)

Example widget pattern:
```jsx
export function StatisticsCard({ color, icon, title, value, footer }) {
  return ( /* JSX */ );
}

StatisticsCard.defaultProps = { color: "blue", footer: null };
StatisticsCard.propTypes = { color: PropTypes.oneOf([...]), icon: PropTypes.node.isRequired, ... };
StatisticsCard.displayName = "/src/widgets/cards/statistics-card.jsx";
export default StatisticsCard;
```

**React import style:** Most files import React as a namespace (`import React from "react"`) and call `React.useState`, `React.useEffect` etc. Some files destructure hooks at import: `import React, { useState, useEffect } from "react"`. Both styles coexist; there is no enforced standard.

## State Management

**Auth state:** Managed via `AuthContext` (`client/src/context/auth.jsx`). Provides `user`, `login()`, `logout()`, `isAdmin()`, `isLoggedIn()` to all consumers via `useAuth()`. State is hydrated from `localStorage` on mount.

**UI/layout state:** Managed via `MaterialTailwindControllerProvider` + `useReducer` (`client/src/context/index.jsx`). Handles sidenav open/close, sidenav color/type, navbar transparency, fixed navbar.

**Feature/page state:** Entirely local `useState` inside individual page components. No global store (no Redux, Zustand, Recoil, or similar). Each page independently manages `loading`, `error`, and data state variables.

**Typical local state pattern:**
```jsx
const [data, setData] = React.useState(null);
const [loading, setLoading] = React.useState(false);
const [error, setError] = React.useState(null);
```

## API Call Patterns

**URL construction:** Always use `API_CONFIG.buildApiUrl(endpoint)` for `/api/*` routes, or `API_CONFIG.buildUrl(endpoint)` for top-level routes (Stripe checkout, Tanimoto). Defined in `client/src/utils/constants.js`. Never hardcode `localhost:3000` in component files.

**Transport:** Native `fetch()` used throughout (no axios on the client). Axios is present on the server side only (`server/index.js`).

**Auth header:** Token retrieved directly from `localStorage` in most pages:
```js
const token = localStorage.getItem('auth_token');
// then passed as:
headers: { 'Authorization': `Bearer ${token}` }
```
A helper `getAuthToken()` exists in `client/src/utils/constants.js` that tries both `access_token` and `auth_token` keys, but most pages bypass it and call `localStorage.getItem('auth_token')` directly — this is inconsistent.

**Request pattern:**
```js
const response = await fetch(API_CONFIG.buildApiUrl('/endpoint'), {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
  body: JSON.stringify(payload),
});
if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
const data = await response.json();
```

**Vite dev proxy** (`client/vite.config.js`): `/api`, `/tanimoto`, `/create-checkout-session`, `/create-checkout-session-onetime`, and `/health` are proxied to `http://127.0.0.1:3000` in development. No base URL changes needed between dev and prod.

## Error Handling

**Client:**
- Async fetch calls are wrapped in `try/catch` blocks inside component event handlers and `useEffect` callbacks
- Errors are stored in local `error` state: `setError(err.message)`
- Displayed via Material Tailwind `<Alert>` component or inline conditional rendering
- `console.error(...)` is used for logging caught errors (no structured error tracking library)

**Server:**
- All route handlers use `try/catch` wrapping the main logic
- Errors returned as JSON: `res.status(4xx/5xx).json({ error: error.message })`
- Detailed internal errors exposed in development only: `process.env.NODE_ENV === 'development' ? err.message : undefined`
- HTTP status codes: 400 (bad request), 401 (no token), 403 (forbidden/invalid token), 404 (not found), 429 (rate limit), 500 (server error)
- `console.error(...)` is the logging mechanism — no structured logger (Winston, Pino, etc.)
- Middleware errors call `next()` on success, `res.status(...).json(...)` on failure (no `next(err)` error-forwarding pattern)

## Styling Approach

**Utility-first CSS:** Tailwind CSS 3.3 is the primary styling mechanism. All layout, spacing, color, and typography uses Tailwind utility classes directly in JSX.

**Component library:** `@material-tailwind/react` 2.1.4 provides pre-styled UI components (Card, Button, Typography, Avatar, Menu, etc.). Tailwind config wraps Material Tailwind via `withMT()` in `client/tailwind.config.cjs`.

**No custom CSS modules or styled-components.** Two custom CSS files exist for third-party libs:
- `client/src/styles/molecule2d.css` — molecule 2D viewer styles
- `client/src/styles/molstar.css` — Molstar 3D viewer styles

**Prettier with Tailwind plugin:** `prettier-plugin-tailwindcss` is installed and configured via `client/prettier.config.cjs` to auto-sort Tailwind class names. However, there is no Prettier format enforcement in CI/pre-commit hooks.

**Icons:** `@heroicons/react` 2.0.18 — both `24/outline` and `24/solid` variants are used. Always destructured: `import { HomeIcon } from "@heroicons/react/24/solid"`.

## File Organization

```
client/src/
├── App.jsx                  # Root router, RequireAuth guard
├── main.jsx                 # React entry point
├── routes.jsx               # All app routes defined as data (icon, name, path, element)
├── components/              # One-off non-widget components (MoleculeDrawer, molecule viewers)
├── config/                  # Client-side config (branding.js)
├── configs/                 # Chart config, branding re-exports (charts-config.js, branding.js, index.js)
├── context/                 # React contexts (auth.jsx, index.jsx, blog.jsx, CartContext.jsx)
├── data/                    # Static data arrays for charts/tables (statistics-cards-data.js, etc.)
├── hooks/                   # Custom React hooks (useBranding.js — only one hook exists)
├── layouts/                 # Layout wrappers (dashboard.jsx, auth.jsx, mainpage.jsx)
├── pages/
│   ├── auth/                # SignIn, SignUp pages
│   ├── dashboard/           # All dashboard feature pages + index.js barrel
│   └── main/                # Public marketing pages
├── styles/                  # Global/third-party CSS overrides
├── utils/                   # Shared utilities (api.js, constants.js)
└── widgets/
    ├── cards/               # Card UI components (index.js barrel)
    ├── charts/              # Chart wrapper components
    └── layout/              # Layout widgets: Sidenav, DashboardNavbar, Footer (index.js barrel)
```

Each subdirectory with multiple files exports via an `index.js` barrel file.

**Server:** Single-file architecture — `server/index.js` (5,821 lines) contains all Express routes, middleware, and business logic. Supporting modules:
- `server/config/branding.js` — brand name logic
- `server/routes/scientificServices.js` — GROMACS and Glioblastoma route proxies
- `server/utils/` — email templates, email service, RabbitMQ utils, etc.

## Notable Patterns

**Barrel index files:** Every page group and widget group uses `index.js` (or `index.jsx`) to re-export all members, enabling clean named imports at the import site.

**Dual export per component:** Page components export both `export function Foo()` and `export default Foo` — the named export is used internally within the module group, the default export is used by the barrel `index.js` when renaming is needed.

**Routes as data:** All application routes are defined as a plain JS array in `client/src/routes.jsx`. Layout components iterate this array to render both the sidebar navigation and the actual `<Route>` elements. Adding a new route requires only adding an entry to `routes.jsx`.

**Multi-tenant filtering:** On the server, `buildTenantFilter(req.user)` produces a MongoDB query filter scoped to the user's `companyId`. All multi-tenant queries must apply this filter.

**Branding abstraction:** Company name is used as the brand label throughout the UI via `useBranding()` hook (client) and `getBrandName()` (server `config/branding.js`). `PLATFORM_NAME` env var is the fallback. Do not hardcode "ChemBench" or "MedSaaS" directly in UI components.

**Simulation token consumption:** Protected science endpoints use the middleware chain `ensureMongoConnected → authenticateToken → requireActiveUser → consumeSimulationToken(feature)`. New simulation endpoints must follow this chain.

**`displayName` on widgets:** Widget components set `ComponentName.displayName` to their file path string for easier React DevTools debugging.
