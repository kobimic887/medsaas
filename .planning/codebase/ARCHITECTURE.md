# System Architecture

_Generated: 2026-06-03_

## Overview

ChemBench (formerly Pyxis/MedSaaS) is a multi-tenant molecular research SaaS platform. It is a Node.js + React monorepo with a single Express API server (`server/`), a Vite/React 18 client (`client/`), and optional Docker-based scientific microservices (`services/`).

In production, Express serves the built frontend as static files — a single unified process. In development, Vite dev server runs separately on port 5173 while the API runs on port 3000, connected via Vite proxy.

```
┌──────────────────────────────────────────────────────────────────┐
│              Browser / React SPA (client/)                        │
│  Layouts: Dashboard, Auth, MainPage                              │
│  Auth state: localStorage + AuthContext                          │
└──────────┬───────────────────────────────────────────────────────┘
           │ HTTP / Vite proxy (dev) or same-origin (prod)
           ▼
┌──────────────────────────────────────────────────────────────────┐
│              Express API  (server/index.js, ESM, port 3000)      │
│  Middleware chain: CORS → JSON → security headers → rate limit   │
│  Route groups: /api/*, /tanimoto/*, /create-checkout-*, /stripe/ │
│  Scientific sub-router: server/routes/scientificServices.js      │
└──────┬───────────────────┬──────────────────┬────────────────────┘
       │                   │                  │
       ▼                   ▼                  ▼
  MongoDB            RabbitMQ queue      External APIs
  (users,            (ADMET tasks)       (Stripe, NVIDIA,
  companies,                              Asinex, Tanimoto,
  audit_logs,                             DiffDock)
  billing_events,
  simulation_logs,
  projects, mol_price)
       │
       ▼ AMQP callback
┌──────────────────────┐
│  services/admet/     │  (Docker worker, Python)
│  services/gromacs-api│  (Docker, Python Flask)
│  services/glioblas.. │  (Docker, Python Flask)
└──────────────────────┘
```

---

## Components

### Frontend (`client/`)

**Entry point:** `client/src/main.jsx` bootstraps React with `BrowserRouter`, `MaterialTailwindControllerProvider`, `AuthProvider`, and mounts `<App />`.

**App router:** `client/src/App.jsx`
- `/dashboard/*` → `Dashboard` layout (requires auth via `RequireAuth`)
- `/auth/*` → `Auth` layout (redirects authenticated users to `/dashboard/controlpanel`)
- `/main/*` → `MainPage` layout (public marketing pages)
- `*` → redirects to `/main/mainHome`

**Layouts:** `client/src/layouts/`
- `dashboard.jsx` — Sidebar (`Sidenav`), sticky top navbar (`DashboardNavbar`), renders dashboard route pages
- `auth.jsx` — Minimal wrapper for sign-in / sign-up pages
- `mainpage.jsx` — Marketing site with `MainNavbar`, dark background for landing page

**Route definitions:** `client/src/routes.jsx` — single flat export `routes` array consumed by all three layouts. Each entry has `{ layout, pages: [{ path, element, icon, name, hideFromMenu?, adminOnly? }] }`.

**Pages** (`client/src/pages/`):
- `dashboard/` — controlpanel, simulation, molstar3d, dashboardhome, company-admin, generate-molecules, protein-folding, gromacs-md, glioblastoma-predict, deep-similarity, moleculeviewer, paidplans, profile, notifications
- `auth/` — sign-in, sign-up
- `main/` — mainhome, services, about-us, contact-us, insights, paidplansdescription, blog

**State management:** Two independent context layers:
1. `AuthContext` (`client/src/context/auth.jsx`) — user object, JWT token (stored in `localStorage` under keys `user_info` and `access_token`/`auth_token`), `login()`, `logout()`, `isAdmin()`, `isLoggedIn()`
2. `MaterialTailwindControllerProvider` (`client/src/context/index.jsx`) — sidenav open/close state, sidenav color/type, navbar transparency — managed via `useReducer`

**API calls:** `client/src/utils/api.js` — `getApiBaseUrl()` returns empty string (same-origin) for both dev (Vite proxy) and prod (unified server). Use `API_CONFIG.buildApiUrl(endpoint)` for `/api/*` and `API_CONFIG.buildUrl(endpoint)` for top-level routes.

**Branding hook:** `client/src/hooks/useBranding.js` calls `client/src/config/branding.js` → resolves `brandName` from company name on the user object, falling back to platform name.

---

### Backend (`server/`)

**Single file:** `server/index.js` (5821 lines, ESM). All business logic, middleware, and routes are defined here, with the exception of scientific service proxies.

**Startup sequence:**
1. Validate required env vars (`MONGODB_URI`, `JWT_SECRET` ≥32 chars, `STRIPE_SECRET_KEY`) — exits on failure
2. Register Stripe webhook handler before `express.json()` middleware (raw body required)
3. Apply global middleware: `express.json({ limit: '5mb' })`, CORS, static `/blobs`, security headers
4. Register all routes
5. `startServer()` — `initializeDatabase()` then listen (HTTPS if SSL certs configured, else HTTP)

**Middleware definitions (all in `server/index.js`):**
- `createRateLimiter()` — custom in-memory Map-based rate limiter (no external package). Instantiated as `authRateLimit` (30/15min), `publicEmailRateLimit` (5/15min), `checkoutRateLimit` (20/5min)
- `ensureMongoConnected` — reconnects on topology loss; sets collection references; must precede any DB access
- `authenticateToken` — verifies `Authorization: Bearer <jwt>`, populates `req.user` (defined at line 2318)
- `requireActiveUser` — re-fetches user + company from DB, checks `active !== false`, populates `req.user.companyId/companyName/role`
- `requireCompanyAdmin` — fetches DB user, enforces `role in ['owner', 'admin']`
- `consumeSimulationToken(feature)` — atomically `$inc: { simulationTokens: -1 }` before simulation; returns 403 if zero; records audit event
- `requireAdmetCallbackAuth` — validates `x-admet-secret` header for async ADMET callbacks

**Standard protected simulation endpoint chain:**
```
ensureMongoConnected → authenticateToken → requireActiveUser → consumeSimulationToken(feature)
```

**Scientific sub-router:** `server/routes/scientificServices.js` — mounted at `app.use('/api', router)` (line 4501). Proxies to GROMACS and Glioblastoma microservices using `proxyJson()`. Exposes `/api/platform/health`, `/api/glioblastoma/*`, `/api/gromacs/*`.

**Key utility modules** (`server/utils/`):
- `emailService.js` — `sendTitanEmail()` via Titan Mail SMTP
- `emailTemplates.js` — `generateVerificationEmailHTML()`
- `emailDebug.js` — `validateEmailCredentials()`
- `rabbitMQUtils.js` — `createAdmetTask()`, `getQueueStatus()`, `rabbitMQHealthCheck()`

**Config:** `server/config/branding.js` — `getBrandName(companyName)` returns company name or `PLATFORM_NAME` env var fallback.

**Static file serving:** Express serves `client/dist` when `FRONTEND_DIST` env var or `../client/dist` exists. SPA fallback serves `index.html` for all non-API routes (line 5810).

---

### Scientific Microservices (`services/`)

All services are optional and Docker-based. The main Express server proxies to them.

| Service | Directory | Language | Port (default) | Protocol |
|---------|-----------|----------|----------------|----------|
| ADMET prediction | `services/admet/` | Python | via RabbitMQ | AMQP async |
| GROMACS MD | `services/gromacs-api/` | Python (Flask) | 8001 | HTTP REST |
| Glioblastoma predictor | `services/glioblastoma-predictor/` | Python (Flask) | 5000 | HTTP REST |

**ADMET** uses RabbitMQ as a task queue (`amqpadmet.py`). The Express server enqueues tasks via `createAdmetTask()` (`server/utils/rabbitMQUtils.js`); the worker processes them and POSTs results back to Express via a callback URL authenticated with `ADMET_CALLBACK_SECRET`.

**GROMACS** and **Glioblastoma** are synchronous HTTP proxies via `server/routes/scientificServices.js`. No auth is required at the service level — auth is handled by Express before the proxy.

---

## Data Flow

### Authentication Flow

1. Client POSTs credentials to `POST /api/login` (`server/index.js`)
2. Server validates password (bcrypt), checks `active` and `verified` flags, fetches company record
3. Server signs JWT: `{ username, companyId, companyName, role, userId }`, returns token + user object
4. Client stores token in `localStorage` under `access_token` and `auth_token`; user object under `user_info`
5. All subsequent API calls include `Authorization: Bearer <token>` header
6. `authenticateToken` verifies signature; `requireActiveUser` validates liveness against DB

### Simulation Flow

1. Client sends `POST /api/simulate` (or feature-specific endpoint)
2. Middleware chain: `ensureMongoConnected` → `authenticateToken` → `requireActiveUser` → `consumeSimulationToken(feature)`
3. `consumeSimulationToken` atomically decrements `users.simulationTokens`; aborts with 403 if zero
4. Audit event recorded (`usage.token.consume`)
5. Handler proxies to external API (NVIDIA, Asinex, etc.) or routes to microservice
6. Result stored in `simulation_logs` collection; response returned to client

### Billing Flow

1. Client POSTs to `POST /create-checkout-session` or `/create-checkout-session-onetime`
2. Server validates plan, creates Stripe `checkout.session` with metadata (`purchaseType`, `credits`, `username`, `companyId`)
3. Pending billing event recorded in `billing_events`
4. Stripe redirects to success/cancel URL
5. Stripe sends `checkout.session.completed` webhook to `POST /stripe/webhook`
6. `fulfillCheckoutSession()` checks idempotency via `stripeSessionId`, then `$inc: { simulationTokens: credits }` on user
7. `billing_events` status updated to `fulfilled`

---

## Multi-tenancy Model

- Every user belongs to exactly one company, identified by `companyId` (a string equal to `company._id.toString()`)
- Company record stored in `companies` collection with `name`, `slug`, `companyId`, `usagePolicy`, `monthlyUsage`
- All user queries in protected routes include `companyId` filter (via `buildTenantFilter(user)`) to prevent cross-tenant access
- The first user registered for a company slug gets `role: 'owner'`; subsequent users get `role: 'member'`
- `companyName` entered at signup drives email branding (`getBrandName()` in `server/config/branding.js`), sidebar label via `useBranding` hook, and invite emails
- Company-level controls: `usagePolicy.monthlySimulationCap`, `usagePolicy.defaultSimulationTokensPerUser`, `active` flag

---

## Auth & Authorization

**JWT:** Signed with `JWT_SECRET` (HS256 implied by jsonwebtoken default). Claims: `{ username, companyId, companyName, role, userId }`. No expiry configured at login (no `expiresIn` on the login JWT); verification tokens expire in `1d`; password reset tokens expire in `30m`.

**Roles:**
- `owner` — first user in a company; full admin rights
- `admin` — granted by owner; same rights as owner in most checks
- `member` — default; cannot access `adminOnly` routes/pages

**Middleware enforcement:**
- `authenticateToken` — presence and signature
- `requireActiveUser` — user and company `active` check
- `requireCompanyAdmin` — `role in ['owner', 'admin']`
- `consumeSimulationToken` — token balance check (atomic)

**Frontend enforcement:**
- `RequireAuth` wrapper in `client/src/App.jsx` — redirects to `/auth/sign-in` if no token in localStorage
- `adminOnly: true` on route entries hides pages from members in `Sidenav`

---

## Key Design Decisions

1. **Single large server file.** All routes, middleware, and helper functions live in `server/index.js` (5821 lines). The only split is `server/routes/scientificServices.js` for microservice proxies. This makes the file a significant bottleneck for maintenance and navigation.

2. **In-memory rate limiter.** No Redis or external store. Rate limit state resets on server restart and does not scale across multiple processes.

3. **Token economy over subscriptions.** Users hold a `simulationTokens` integer. Credits are added only via Stripe webhook fulfillment — never from the frontend. This prevents manipulation while enabling flexible purchase types.

4. **Idempotent Stripe fulfillment.** `fulfillCheckoutSession()` checks `billing_events` for an existing fulfilled record before granting credits, ensuring webhook retries are safe.

5. **Unified production deployment.** Express serves the built React app as static files. One process, one port. Development uses Vite proxy to avoid CORS issues.

6. **Dual `.env` loading.** `server/index.js` loads `../.env` (root) then `cwd/.env`. Vite reads root `.env` via `envDir: '..'` in `client/vite.config.js`. This allows a single `.env` at the repo root to configure both tiers.

7. **Company slug collision handling.** New signups with the same company name (by slug) join the existing company rather than creating a duplicate. The first user in the company becomes `owner`.

8. **HTTPS with HTTP fallback.** `startServer()` attempts HTTPS using `SSL_KEY_PATH`/`SSL_CERT_PATH`; if certificates are missing, it silently falls back to HTTP for development convenience.
