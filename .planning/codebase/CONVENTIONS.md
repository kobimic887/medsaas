---
last_mapped_commit: 1a703a98234dd0b9b66866ec31d4d9a1a6455b55
---

# Coding Conventions

**Analysis Date:** 2026-06-05

## Naming Patterns

**Files:**
- Use lowercase route/page filenames with hyphens for multi-word React pages and widgets: `client/src/pages/dashboard/generate-molecules.jsx`, `client/src/pages/dashboard/protein-folding.jsx`, `client/src/widgets/layout/dashboard-navbar.jsx`.
- Use PascalCase filenames for React component modules that export named visual components: `client/src/components/MoleculeDrawer.jsx`, `client/src/components/ProfessionalMoleculeViewer.jsx`, `client/src/components/DisabledOCLViewer.jsx`.
- Use camelCase `.js` utility/config files for shared frontend helpers: `client/src/utils/api.js`, `client/src/config/branding.js`, `server/utils/emailTemplates.js`.
- Use `.mjs` for executable Node smoke harnesses and scripts that run directly with `node`: `server/test/runtime-smoke.test.mjs`, `server/test/stripe-webhook.test.mjs`, `scripts/check-brand.mjs`.
- Treat committed Ketcher bundle files as generated/static assets, not style exemplars: `client/public/ketcher/static/js/main.7d7d7a03.js`, `packages/dashboard-template/public/ketcher/static/js/main.7d7d7a03.js`.

**Functions:**
- Use camelCase for regular functions and helpers: `getApiBaseUrl` in `client/src/utils/api.js`, `getStoredUser` in `client/src/context/auth.jsx`, `createRateLimiter` in `server/index.js`, `waitForHealth` in `server/test/runtime-smoke.test.mjs`.
- Use PascalCase only for React function components: `App` in `client/src/App.jsx`, `AuthProvider` in `client/src/context/auth.jsx`, `GenerateMolecules` in `client/src/pages/dashboard/generate-molecules.jsx`.
- Use `handle*` names for component event handlers: `handleSubmit` in `client/src/pages/dashboard/generate-molecules.jsx`.
- Use action-oriented names for server helpers and middleware factories: `consumeSimulationToken`, `authenticateToken`, `requireActiveUser`, and `fulfillCheckoutSession` in `server/index.js`.

**Variables:**
- Use camelCase for local mutable values and request payload fields in JavaScript: `explicitApiBase`, `baseUrl`, `authToken`, `serverRuntime`, `runtimeBin`.
- Use UPPER_SNAKE_CASE for module constants and environment-derived configuration: `REQUIRED_ENV`, `JWT_SECRET`, `STRIPE_WEBHOOK_SECRET`, `MONGODB_URI`, `PLAN_CATALOG` in `server/index.js`; `USER_STORAGE_KEY` and `ACCESS_TOKEN_KEY` in `client/src/context/auth.jsx`.
- Preserve API-specific snake_case where the external service contract requires it: `num_molecules`, `property_name`, `min_similarity`, and `smi` in `server/index.js`.
- Use boolean names with `is*` or `has*` for predicates: `isLoading` in `client/src/context/auth.jsx`, `isAuthenticated` in `client/src/App.jsx`, `hasFrontendBuild` in `server/index.js`.

**Types:**
- Not applicable: this repo is JavaScript/JSX, not TypeScript. Do not introduce TypeScript-specific type declarations unless a future migration phase adds TypeScript config and build support.
- Use PropTypes for React component prop contracts where present: `AuthProvider.propTypes` in `client/src/context/auth.jsx`.

## Code Style

**Formatting:**
- Frontend formatting is configured through Prettier 3 with Tailwind class sorting: `client/prettier.config.cjs`.
- The Prettier config points at `client/tailwind.config.cjs` and loads `prettier-plugin-tailwindcss`; use it for client JSX/class formatting.
- No root Prettier config is detected. Server files such as `server/index.js` and scripts such as `scripts/check-brand.mjs` rely on the existing local style rather than an enforced formatter.
- Quote style is mixed by area: client files commonly use double quotes in `client/src/main.jsx` and `client/src/context/auth.jsx`; server and test files commonly use single quotes in `server/index.js` and `server/test/runtime-smoke.test.mjs`. Match the file being edited.
- Semicolons are used across active source files; keep them in new JavaScript and JSX.

**Linting:**
- No ESLint, Biome, Jest, Vitest, or Playwright config is detected in tracked project files.
- The current automated static check is root `npm run check`, which runs `node --check server/index.js` plus `npm --prefix client run build` from `package.json`.
- Bun is the default package runner after Phase 6, but `check` and test-script migration to Bun remains Phase 7 scope. Do not silently rewrite `check`, `test:brand`, or server test commands to Bun until Phase 7.
- The brand regression guard is `npm run test:brand`, implemented in `scripts/check-brand.mjs`.

## Import Organization

**Order:**
1. Runtime/framework imports first: `react`, `react-dom/client`, `express`, `cors`, Node built-ins such as `node:child_process`.
2. Third-party package imports next: `mongodb`, `stripe`, `bcryptjs`, `@material-tailwind/react`.
3. Local app imports last, using either relative server paths or frontend aliases: `./utils/emailTemplates.js` in `server/index.js`, `@/context/auth` in `client/src/main.jsx`.
4. Side-effect style imports stay near the entry point setup: `import 'dotenv/config'` in `server/index.js`, stylesheet imports in `client/src/main.jsx`.

**Path Aliases:**
- Use `@` for frontend imports under `client/src` as configured in `client/vite.config.js`: `@/layouts`, `@/context`, `@/utils/constants`.
- Server code uses relative ESM imports with explicit `.js` extensions: `./utils/emailService.js`, `./routes/scientificServices.js`.
- Do not use the frontend `@` alias in server files; it is a Vite-only alias.

## Error Handling

**Patterns:**
- Server startup validates required environment before binding the API and exits with explicit console errors for fatal config failures: `server/index.js`.
- Express route handlers should wrap external calls in `try/catch`, log server-side detail, and return JSON errors with explicit status codes: `server/index.js`, `server/routes/scientificServices.js`.
- Stripe webhook handling must use `stripe.webhooks.constructEventAsync(...)` and catch signature failures before fulfillment: `server/index.js`. This is required for Bun compatibility from Phase 5.
- Frontend context helpers catch browser storage parse errors, log a concise message, and return a safe fallback: `client/src/context/auth.jsx`.
- Frontend request handlers should surface user-facing error state with `setError(err.message)` or equivalent after failed fetches: `client/src/pages/dashboard/generate-molecules.jsx`.
- CLI/smoke scripts exit nonzero on failure with `process.exit(1)` or `process.exit(failed === 0 ? 0 : 1)`: `scripts/check-brand.mjs`, `server/test/runtime-smoke.test.mjs`.

## Logging

**Framework:** console

**Patterns:**
- Use `console.error` for server failures, webhook verification failures, startup failures, and harness errors: `server/index.js`, `server/test/stripe-webhook.test.mjs`.
- Use `console.warn` for degraded-but-runnable configuration states: missing Stripe webhook secret in `server/index.js`, local dev environment tips in `scripts/ensure-dev.mjs`.
- Use `console.log` for smoke-harness progress and pass/fail output: `server/test/runtime-smoke.test.mjs`, `server/test/runtime-watch-smoke.mjs`.
- Avoid logging secret values. Redaction is expected when inspecting env-derived values, as shown by `server/utils/emailDebug.js`.

## Comments

**When to Comment:**
- Add comments for runtime, security, or integration behavior that is not obvious from code: Stripe placeholder handling and security headers in `server/index.js`; Bun watch reload behavior in `server/test/runtime-watch-smoke.mjs`.
- Add comments to smoke harnesses that explain what production path is being proven: `server/test/runtime-smoke.test.mjs`, `server/test/stripe-webhook.test.mjs`.
- Avoid comments that narrate obvious local state declarations. For example, new React `useState` declarations in files like `client/src/pages/dashboard/generate-molecules.jsx` do not need comments unless the state has non-obvious domain behavior.

**JSDoc/TSDoc:**
- Swagger JSDoc blocks document server API endpoints inside `server/index.js`; keep endpoint documentation adjacent to the route handler when adding or changing public API routes.
- Regular frontend helpers use short block comments only when explaining behavior, such as `getApiBaseUrl` in `client/src/utils/api.js`.
- TSDoc is not applicable because the repo is not TypeScript.

## Function Design

**Size:** Keep new functions focused and smaller than the large existing `server/index.js` route bodies where practical. Extract shared logic into server utility modules such as `server/utils/emailService.js` or frontend utility modules such as `client/src/utils/api.js` when code is reused across routes/components.

**Parameters:** Prefer object parameters for middleware factories and helpers with multiple configuration values, matching `createRateLimiter({ windowMs, max, name })` in `server/index.js`. Preserve external API payload names when assembling third-party requests.

**Return Values:** Express handlers return through `res.status(...).json(...)` or `res.send(...)`. Frontend context actions return small result objects when callers need success/error state, matching `login` in `client/src/context/auth.jsx`. Smoke helper functions return booleans or structured `{ status, body }` objects for assertions, matching `waitForHealth` and `postEvent` in `server/test/stripe-webhook.test.mjs`.

## Module Design

**Exports:** Use named exports for reusable helpers and providers: `getBrandName` in `server/config/branding.js`, `apiRequest` in `client/src/utils/api.js`, `AuthProvider` and `useAuth` in `client/src/context/auth.jsx`. Use default exports for single React page/component modules, such as `client/src/App.jsx`.

**Barrel Files:** Existing barrel files re-export frontend groups: `client/src/context/index.jsx`, `client/src/layouts/index.js`, `client/src/widgets/cards/index.js`, `client/src/pages/dashboard/index.js`. Add to the relevant barrel when a new module is part of an existing imported group.

**Runtime Scripts:** Root scripts in `package.json` default to Bun for install/dev/build/start after Phase 6: `install:all`, `dev`, `build`, `start`. Keep npm/Node fallbacks parallel and explicit: `install:all:node`, `dev:node`, `build:node`, `start:node`. Server scripts in `server/package.json` default to Bun runtime (`start:bun`, `dev:bun`, `start:unified:bun`) while keeping Node fallbacks (`start:node`, `dev:node`, `start:unified:node`).

---

*Convention analysis: 2026-06-05*
