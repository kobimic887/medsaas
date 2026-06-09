# Phase 2: Branding Management - Pattern Map

## Backend Branding Contract

### Closest analogs
- `server/index.js` `parseLigandUpload` / `/api/company/ligand-upload`:
  validates base64 JSON uploads, enforces a byte cap, stores company-scoped data,
  records an audit event, and returns sanitized metadata.
- `server/index.js` `getCompanyRecord`:
  normalizes nested company configuration and performs lazy backfill.
- `server/index.js` `requireCompanyAdmin` / `requireActiveUser`:
  re-checks the current database role and tenant before protected operations.
- `server/test/runtime-smoke.test.mjs`:
  boots the real server against `mongodb-memory-server`, seeds records, signs in,
  calls live HTTP routes, and inspects persisted MongoDB state.

### Concrete pattern
- Put image/palette normalization in a focused helper module and keep route
  composition in `server/index.js`.
- Accept a JSON upload payload shaped like the existing ligand upload:
  `{ fileName, contentType, sizeBytes, contentBase64 }`.
- Normalize accepted PNG/JPG/SVG input through `sharp` to bounded PNG bytes
  before palette extraction or persistence.
- Store normalized bytes as BSON binary on the company document; never store
  `contentBase64` as the durable representation.
- Return a company-safe serialized branding object to authenticated company
  users; enforce all mutations and extraction through `requireCompanyAdmin`.

## Shared Client Branding State

### Closest analogs
- `client/src/context/auth.jsx`: provider state initialized from authenticated
  user data and shared across the app.
- `client/src/hooks/useBranding.js`: current single access point for company
  brand naming, already used by sign-up and dashboard layout.
- `client/src/widgets/layout/dashboard-navbar.jsx` token validation:
  refreshes server-derived user state and localStorage.
- `client/src/layouts/dashboard.jsx` -> `Sidenav`:
  existing dashboard brand-name and logo prop integration point.

### Concrete pattern
- Add a `BrandingProvider` inside `AuthProvider`, fetch same-origin
  `/api/company/branding` with the bearer token, and expose
  `{ branding, loading, error, refreshBranding }`.
- Keep `useBranding(previewCompanyName)` backward-compatible for auth pages while
  returning shared palette/logo data for authenticated dashboard consumers.
- Render a data URL from the authenticated branding response in `Sidenav`, with
  an image-error fallback to the company-name text.

## Company Admin Branding UI

### Closest analogs
- `client/src/pages/dashboard/company-admin.jsx` tab registry, loading state,
  temporary alerts, save-state keys, card layout, and `companyRequest`.
- The same file's ligand upload flow:
  immediate client byte check, file-to-base64 conversion, explicit submit, and
  server error display.
- Material Tailwind `Card`, `Input`, `Button`, `Alert`, and `Spinner` plus
  Heroicons already used throughout the page.

### Concrete pattern
- Insert Branding after Members using local `activeTab` state.
- Keep selected logo and four palette values local until `Save branding`.
- Call extraction after a valid file selection; extraction proposes values but
  does not persist them.
- Use a dedicated pure client utility for file conversion and hex
  normalization, and a focused `BrandingPreview` component for the compact
  sidebar preview.
- After save, reload Company Admin data and call shared `refreshBranding()` so
  dashboard chrome updates without logout.

## Verification Pattern

- Add `server/test/branding.test.mjs` for real HTTP + Mongo behavior, including
  owner/admin success, member denial, invalid upload rejection, BSON binary
  persistence, manual palette save, tenant isolation, and logo retrieval.
- Add Bun-default and Node-fallback package scripts for the branding integration
  test.
- Use `bun run check` as the full server-resolution and client-build gate.

