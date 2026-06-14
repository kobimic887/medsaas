# Coding Conventions

**Analysis Date:** 2026-06-14

## Naming Patterns

**Files:**
- Server: `index.js` (monolithic), `*.js` with ESM imports
- Client: PascalCase for components (`MoleculeDrawer.jsx`, `SimpleMoleculeViewer.jsx`), kebab-case for page files (`sign-in.jsx`, `deep-similarity.jsx`)
- Utilities: camelCase (`api.js`, `constants.js`, `companyBranding.js`)
- Tests: `*.test.mjs` (e.g., `stripe-webhook.test.mjs`)

**Functions:**
- camelCase throughout (`recordAuditEvent`, `createRateLimiter`, `requireActiveUser`, `consumeSimulationToken`)
- Middleware prefixed with `require` or `ensure` (e.g., `requireActiveUser`, `ensureMongoConnected`)
- Handler factories return async middleware (e.g., `consumeSimulationToken(feature)` returns `async (req, res, next)`)
- Helper utilities prefixed with verb/action (`toCompanySlug`, `buildTenantFilter`, `normalizeLigandServiceConfig`)

**Variables:**
- camelCase: `simulationTokens`, `companyId`, `brandPalette`
- Constants: SCREAMING_SNAKE_CASE frozen at module level (`PLAN_CATALOG`, `PASSWORD_POLICY`, `JWT_SECRET`)
- Query/filter objects: bare lowercase keys matching MongoDB field names (`{ username, companyId, active: true }`)

**Types:**
- PropTypes validation in client components (e.g., `AuthProvider.propTypes` at `client/src/context/auth.jsx:93`)
- Context-based state + hooks pattern (`AuthContext`, `useAuth()`)
- No TypeScript; `@types/react` present but unused; typing enforcement via PropTypes and JSDoc comments

**React Components:**
- PascalCase exports: `export function SignIn()` (`client/src/pages/auth/sign-in.jsx:6`)
- Hooks follow `use*` pattern: `useBranding()`, `useAuth()`
- Context imports use barrel/index exports: `import { AuthProvider, useAuth } from "@/context/auth"`
- Router integration via `routes` array with structured `{ title, layout, pages: [...{ name, path, element, icon, hideFromMenu, adminOnly }] }` (`client/src/routes.jsx:48`)

## Code Style

**Formatting:**
- Prettier 3.0.3 installed (`client/package.json:37`) but **no config file** — formatting is conventional/unenforced
- Plugin `prettier-plugin-tailwindcss` present but unconfigured
- Quote style is **mixed**: single quotes dominate `server/index.js`, double quotes used in routes (`:279` OpenFold3) and client auth (`client/src/pages/auth/sign-in.jsx:24`)
- Indentation: 2 spaces (observed across server and client)

**Linting:**
- No ESLint or Biome config in project root or `server/`/`client/` dirs (only nested in `node_modules/` from dependencies)
- No linting enforcement; conventions are observed but not enforced by tooling

**Line Length:**
- Server routes and async functions use long lines (no hard limit observed)
- Client JSX uses standard multi-line nesting for readability

## Import Organization

**Order (observed pattern):**
1. Node.js built-in modules (`https`, `fs`, `path`, `crypto`)
2. Third-party packages (`express`, `axios`, `mongodb`, `jsonwebtoken`)
3. Local imports (relative and `@` alias)
4. Side-effect imports (`dotenv/config`, style sheets)

**Path Aliases:**
- Client: `@` → `client/src/` (configured in `client/vite.config.js:27`, import examples: `@/context/auth`, `@/pages/dashboard`)
- Server: No aliases; all relative paths
- Vite reads root `.env` via `envDir: '..'` (`client/vite.config.js:6`)

**Import Style:**
- Named imports preferred: `import { MongoClient, ObjectId } from 'mongodb'`
- Default imports for modules: `import express from 'express'`
- ESM throughout (monorepo uses `"type": "module"` at root and per-workspace)

## Error Handling

**Patterns:**
- Try-catch wrapping async route handlers and middleware (e.g., `server/index.js:250-255`)
- Error responses use consistent shape: `res.status(statusCode).json({ error: 'message' })`
- HTTP status semantics enforced:
  - **401**: authentication missing/invalid/expired (dead session — client logs out on same-origin 401)
  - **403**: authorization failure, validation failure, disabled account, no tokens left (client does NOT log out)
  - **400**: bad request/validation (e.g., missing query params)
  - **500**: server error
  - **429**: rate limit exceeded (with `Retry-After` header in seconds)
- Catch blocks log with `console.error()` before returning error response
- No custom error classes; errors are plain objects or Error instances

**Middleware Error Handling:**
- Middleware returns early on error: `if (!condition) return res.status(403).json({ error: '...' })`
- Next middleware only called on success: `next()`
- Errors in async middleware caught and returned as JSON, not thrown upward

## Logging

**Framework:** `console.log()` and `console.error()`

**Patterns:**
- Startup logs prefixed with emoji + status: `✓ Connected to MongoDB successfully` (`:728`)
- Error logs use `❌` for critical startup failures: `❌ Error generating Swagger spec` (`:689`)
- Sensitive data masked: MongoDB URIs hide credentials via `.replace(/\/\/([^:]+):([^@]+)@/, '//***:***@/')` (`:723`)
- Rate limiting stores `{ count, resetAt }` per key in memory Map, no persistent logging of limits
- Stripe webhook verification failures logged with error message before returning 400
- Audit logging: `recordAuditEvent(req, action, details, status)` writes to `audit_logs` collection with actor/target/IP/timestamp (`:1143-1164`)

**When to Log:**
- Server startup/shutdown transitions
- Database connection state changes
- Configuration validation failures
- Webhook signature verification failures (error message only, not payload)
- Audit-relevant actions via `recordAuditEvent()` (auth, admin actions, usage tracking)
- Do NOT log request/response bodies in middleware (except audit event details)

## Comments

**When to Comment:**
- Swagger/JSDoc blocks above routes (e.g., `server/index.js:195-225` for `/api/generate-molecules`)
- Non-obvious business logic (e.g., JWT token expiry default, rate limit window calculations)
- Workarounds and TODOs (e.g., email verification disabled in non-prod, Stripe webhook secret placeholder check)
- Security decisions (e.g., 401 vs 403 invariant at `:2596-2599`)

**JSDoc/TSDoc:**
- Swagger JSDoc blocks use standard OpenAPI 3.0 format above route definitions
- Inline comments explain non-obvious decisions (e.g., `SAMEORIGIN` frame policy at `:159-160`)
- Function comments are minimal; signature is preferred to verbose documentation

## Function Design

**Size:** No hard limit observed; server handlers range from 10 lines (proxy routes) to 100+ lines (user signup, checkout fulfillment)

**Parameters:**
- Express middleware signature: `(req, res, next)`
- Route handlers receive `req.user` (from `authenticateToken` middleware), `req.body`, `req.query`, `req.params`
- Factory functions take config objects: `createRateLimiter({ windowMs, max, name })`
- Async functions use `await` throughout; no callback chains

**Return Values:**
- Route handlers return via `res.json()`, `res.status().json()`, or `res.send()`
- Middleware returns early on error, calls `next()` on success
- Utility functions return normalized data (e.g., `normalizeCompanyName(value)` returns string)
- Async functions implicitly return Promises; no Promise wrapping

**Destructuring:**
- Destructure from request: `const { username, password } = req.body`
- Destructure from objects: `const { companyId, role } = req.user`
- Do not destructure in function signature for optional config; use inline defaults instead

## Module Design

**Exports:**
- Server: monolithic `server/index.js` with app setup and all routes inline; no named exports (uses side effects via `app.post()`, `app.get()`, etc.)
- Client: named exports for components and utilities; contexts export `Context`, `Provider`, `useContext` hook
- Utilities: single-responsibility modules (e.g., `emailService.js` exports `sendTitanEmail()`, `emailTemplates.js` exports `generatePasswordResetEmailHTML()`)

**Barrel Files:**
- Client pages: `import { DashboardHome, Profile, ... } from "@/pages/dashboard"` (barrel export from `client/src/pages/dashboard/index.js`)
- Contexts: `import { AuthProvider, useAuth } from "@/context/auth"` (both exported from `auth.jsx`)

**Module Organization:**
- Server entry point (`index.js`) groups code by concern: env/config top, middleware definitions, route definitions (grouped by feature), then listener
- Client organizes by layer: `pages/`, `components/`, `context/`, `hooks/`, `utils/`, `layouts/`, `config/`
- Test files live in `server/test/` with `.test.mjs` suffix; no co-located tests

## Custom Utilities

**Rate Limiting:**
- Custom in-memory implementation via `createRateLimiter({ windowMs, max, name })` (`:166-189`)
- Three instances: `authRateLimit` (30 req/15min), `publicEmailRateLimit` (5 req/15min), `checkoutRateLimit` (20 req/5min)
- Tracks hits per IP in a Map; resets window on expiry
- Returns 429 with `Retry-After` header on limit exceed

**API Configuration (Client):**
- `API_CONFIG.buildApiUrl(endpoint)` → `/api${endpoint}` with automatic base URL detection (`:62-65` in `client/src/utils/constants.js`)
- `API_CONFIG.buildUrl(endpoint)` → `${endpoint}` for non-API routes (Stripe checkout, Tanimoto)
- Automatic protocol detection from window or explicit `VITE_API_BASE_URL` env var
- Default: same-origin (empty base) so Vite proxy in dev and unified deploy in production work without config

**Authentication:**
- JWT tokens signed with `JWT_SECRET` (≥32 chars enforced at startup)
- Token payload includes `username`, `email`, `userId`, `companyId`, `companyName`, `role`
- Client stores in `localStorage` as `access_token` (+ legacy `auth_token` for compatibility)
- Server validates on every protected request via `authenticateToken` middleware

**Audit Logging:**
- Signature: `recordAuditEvent(req, action, details = {}, status = 'success')`
- Records to `audit_logs` collection: `{ action, status, actorUsername, actorRole, companyId, companyName, targetType, targetId, details, ipAddress, userAgent, timestamp }`
- Called for auth actions, admin actions, and token usage (`:1797`, `:2132`, `:1255`)
- Silently fails if collection unavailable (logs error but doesn't break request)

## Bun vs Node Script Conventions

**Script Naming:**
- Default: Bun (no suffix) — e.g., `npm run dev`, `npm run build`
- Node fallback: `:node` suffix — e.g., `npm run dev:node`, `npm run build:node`
- Test scripts: `:bun` / `:node` explicit (e.g., `npm --prefix server run test:stripe:bun`, `npm --prefix server run test:stripe:node`)

**Test Runtime Detection:**
- Env var `SERVER_RUNTIME` controls which binary spawns server: `bun` or `node`
- Default varies: `stripe-webhook.test.mjs` defaults to `node` (`:93`), `runtime-smoke.test.mjs` defaults to `bun` (`:29`)
- Bun path: `process.env.BUN_PATH || ~/.bun/bin/bun`

**Lockfile Management:**
- Both `bun.lock` and `package-lock.json` committed in root, `server/`, and `client/`
- Script `npm run lockfiles:refresh` keeps both in sync after dependency changes

## Password Policy

Enforced regex at server startup and on password changes/resets:

```javascript
/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]).{8,}$/
```

Requirements:
- Minimum 8 characters
- At least one lowercase letter
- At least one uppercase letter
- At least one digit
- At least one special character from the set: `!@#$%^&*()_+-=[]{}';:"\\|,.<>/?`

Applied at: `/api/signup`, `/api/invite/:token/accept`, `/api/change-password`

---

*Convention analysis: 2026-06-14*
