---
last_mapped_commit: 1a703a98234dd0b9b66866ec31d4d9a1a6455b55
---
<!-- refreshed: 2026-06-05 -->
# Architecture

**Analysis Date:** 2026-06-05

## System Overview

```text
┌─────────────────────────────────────────────────────────────┐
│                    React/Vite Web Client                    │
│  `client/src/main.jsx` -> `client/src/App.jsx`              │
├──────────────────┬──────────────────┬───────────────────────┤
│ Public Site      │ Auth Pages        │ Dashboard             │
│ `client/src/pages/main` │ `client/src/pages/auth` │ `client/src/pages/dashboard` │
└────────┬─────────┴────────┬─────────┴──────────┬────────────┘
         │ same-origin `/api`, `/tanimoto`, checkout, `/health`
         ▼
┌─────────────────────────────────────────────────────────────┐
│                 Express API / Static Host                   │
│                 `server/index.js`                           │
├──────────────────────┬──────────────────────┬───────────────┤
│ Auth/Billing/Tenant  │ Chemistry Proxies    │ Scientific API │
│ Mongo + Stripe + JWT │ Asinex/Tanimoto/NVIDIA│ `server/routes/scientificServices.js` │
└──────────┬───────────┴──────────┬───────────┴───────┬───────┘
           │                      │                   │
           ▼                      ▼                   ▼
┌──────────────────────┐ ┌──────────────────────┐ ┌──────────────────────┐
│ MongoDB + RabbitMQ   │ │ External Services    │ │ Python Microservices │
│ `docker-compose.yml` │ │ env-configured URLs  │ │ `services/*`         │
└──────────────────────┘ └──────────────────────┘ └──────────────────────┘
```

## Component Responsibilities

| Component | Responsibility | File |
|-----------|----------------|------|
| Root workspace scripts | Coordinate install, dev, build, start, Docker service profiles, and Bun/npm fallback commands across package roots. | `package.json` |
| Web entry point | Mount React under `BrowserRouter`, Material Tailwind, auth context, blog context, and Molstar styles. | `client/src/main.jsx` |
| Top-level route gate | Route `/dashboard/*`, `/main/*`, `/auth/*`, and redirect unknown paths; protect dashboard by local auth token presence. | `client/src/App.jsx` |
| Route registry | Define navigable page metadata for main, auth, and dashboard layouts, including admin-only and hidden pages. | `client/src/routes.jsx` |
| Layout shells | Render route groups and shared navigation for public, auth, and dashboard experiences. | `client/src/layouts/dashboard.jsx`, `client/src/layouts/mainpage.jsx`, `client/src/layouts/auth.jsx` |
| API URL utility | Keep browser API calls same-origin by default; allow split hosting via `VITE_API_BASE_URL`. | `client/src/utils/api.js`, `client/src/utils/constants.js` |
| Express API server | Own HTTP middleware, auth, MongoDB access, billing, tenant administration, chemistry proxies, ADMET task endpoints, static hosting, and server startup. | `server/index.js` |
| Scientific service router | Proxy GROMACS and glioblastoma API calls and aggregate scientific-service health. | `server/routes/scientificServices.js` |
| RabbitMQ utility | Publish ADMET work to RabbitMQ and expose queue health/status helpers. | `server/utils/rabbitMQUtils.js` |
| Email utility | Send and test Titan SMTP emails. | `server/utils/emailService.js` |
| Branding config | Resolve platform/company label helpers used by server-side emails and UI-oriented responses. | `server/config/branding.js` |
| ADMET worker | Consume RabbitMQ ADMET tasks and call back into the API. | `services/admet/amqpadmet.py`, `services/admet/admet_sender.py`, `services/admet/admentpred.py` |
| GROMACS API | Provide a FastAPI service for file handling, GROMACS commands, jobs, templates, and workflows. | `services/gromacs-api/app.py` |
| Glioblastoma predictor | Provide a Flask service for SMILES testing, single prediction, and batch prediction. | `services/glioblastoma-predictor/app.py` |
| Dashboard template | Preserve upstream dashboard reference code separate from the active client. | `packages/dashboard-template/` |
| Legacy API | Preserve archived standalone Chem API code separate from active server code. | `legacy/chem-beo-api/` |

## Pattern Overview

**Overall:** Monorepo with a Vite React SPA, a monolithic Express API/static host, and optional Dockerized Python scientific workers/services.

**Key Characteristics:**
- Use three JavaScript package roots: root orchestration in `package.json`, client app in `client/package.json`, and API app in `server/package.json`.
- Use Bun as the default package runner and API runtime while keeping npm/Node fallback commands and lockfiles in root, `client/`, and `server/`.
- Keep frontend API calls same-origin: Vite proxies development requests from `client/vite.config.js`; production serves `client/dist` from `server/index.js`.
- Keep most backend business logic in `server/index.js`; extract only focused helper modules in `server/utils/`, `server/config/`, and `server/routes/`.
- Treat optional scientific capabilities as services behind the Express API, not as direct frontend integrations.

## Layers

**Root Orchestration:**
- Purpose: Run install/dev/build/start/check commands and Docker Compose service profiles from a single place.
- Location: `package.json`
- Contains: Bun default scripts, npm/Node rollback scripts, lockfile refresh, Docker service profile commands.
- Depends on: `bun.lock`, `package-lock.json`, `client/bun.lock`, `client/package-lock.json`, `server/bun.lock`, `server/package-lock.json`.
- Used by: Developers, CI/deploy scripts, Phase 7 package-management/runtime migration work.

**Frontend Application:**
- Purpose: Render public pages, auth pages, dashboard tools, molecular visualization, checkout triggers, and admin controls.
- Location: `client/src/`
- Contains: React pages in `client/src/pages/`, layouts in `client/src/layouts/`, route definitions in `client/src/routes.jsx`, shared widgets in `client/src/widgets/`, contexts in `client/src/context/`, API helpers in `client/src/utils/`.
- Depends on: React, React Router, Material Tailwind, Heroicons, Molstar, Ketcher, Vite alias `@ -> /src`.
- Used by: Vite dev server and production static host.

**API Application:**
- Purpose: Authenticate users, manage companies/usage/billing, proxy external chemistry APIs, record simulation data, publish ADMET jobs, and serve built frontend assets.
- Location: `server/index.js`
- Contains: Express middleware, route handlers, MongoDB connection/index setup, JWT auth middleware, rate limiters, Stripe webhook/checkout handlers, Swagger setup, static SPA fallback.
- Depends on: MongoDB, Stripe, JWT, Nodemailer, RabbitMQ utility, scientific router, environment variables loaded from root `.env`.
- Used by: Vite dev proxy, production unified server, ADMET callback worker, Docker deployment.

**Backend Helper Modules:**
- Purpose: Keep repeated integrations and configuration helpers out of the main route file.
- Location: `server/utils/`, `server/config/`, `server/routes/`
- Contains: `server/utils/rabbitMQUtils.js`, `server/utils/emailService.js`, `server/utils/emailTemplates.js`, `server/utils/emailDebug.js`, `server/config/branding.js`, `server/routes/scientificServices.js`.
- Depends on: Environment variables and third-party SDKs.
- Used by: `server/index.js`.

**Scientific Services:**
- Purpose: Provide heavier scientific compute capabilities outside the Node/Bun API process.
- Location: `services/admet/`, `services/gromacs-api/`, `services/glioblastoma-predictor/`
- Contains: Python services/workers, service Dockerfiles, service requirements, standalone READMEs.
- Depends on: RabbitMQ for ADMET, FastAPI/GROMACS stack for GROMACS, Flask/scientific Python stack for glioblastoma prediction.
- Used by: Docker Compose profiles and `server/routes/scientificServices.js`.

**Reference and Archive Code:**
- Purpose: Preserve upstream UI template and legacy API implementation without making them active runtime code.
- Location: `packages/dashboard-template/`, `legacy/chem-beo-api/`
- Contains: Dashboard template source/static assets and archived Chem API files.
- Depends on: Their own historical package manifests.
- Used by: Manual reference only unless explicitly copied or diffed.

## Data Flow

### Primary Web Request Path

1. Browser loads `client/src/main.jsx` through Vite in development or `client/dist/index.html` through Express static hosting in production (`client/src/main.jsx`, `server/index.js`).
2. `client/src/App.jsx` routes `/main/*`, `/auth/*`, and `/dashboard/*`; dashboard access checks `getAuthToken()` before rendering protected layouts.
3. Dashboard pages call same-origin API paths using `fetch`, `API_CONFIG`, or `apiRequest()` (`client/src/utils/constants.js`, `client/src/utils/api.js`).
4. In development, `client/vite.config.js` proxies `/api`, `/tanimoto`, checkout endpoints, and `/health` to `http://127.0.0.1:3000`.
5. `server/index.js` applies JSON parsing, CORS, security headers, Mongo connection middleware, JWT middleware, and route-specific guards.
6. Route handlers read/write MongoDB collections, call external APIs, publish RabbitMQ tasks, or return static files.
7. Responses return JSON to the React page, which stores selected client state in React state and localStorage.

### Unified Production Path

1. Root `bun run start` runs `bun run build:bun` and then `bun --cwd=server run start:unified:bun` (`package.json`).
2. `client/package.json` runs `vite build`, producing `client/dist`.
3. `server/package.json` starts `FRONTEND_DIST=../client/dist bun index.js`.
4. `server/index.js` serves static assets from `FRONTEND_DIST_PATH` and sends `index.html` for non-API SPA routes.

### Authentication and Tenant Path

1. Auth pages submit signup/signin requests to `/api/signup` and `/api/signin` (`client/src/pages/auth/sign-up.jsx`, `client/src/pages/auth/sign-in.jsx`).
2. `server/index.js` validates input, hashes passwords with bcrypt, writes users/companies to MongoDB, and issues JWTs.
3. Client auth helpers store tokens and user info in localStorage (`client/src/context/auth.jsx`, `client/src/utils/constants.js`).
4. Protected API routes call `authenticateToken`, then optional `requireActiveUser` or `requireCompanyAdmin` in `server/index.js`.
5. Tenant filtering uses `companyId` when present, otherwise falls back to username-scoped records.

### Billing Path

1. Paid-plan UI calls checkout endpoints (`client/src/pages/dashboard/paidplans.jsx`, `client/src/widgets/layout/dashboard-navbar.jsx`).
2. `server/index.js` creates Stripe Checkout sessions from the server-side `PLAN_CATALOG`.
3. Stripe posts `checkout.session.completed` to `/stripe/webhook`, which uses raw body parsing before JSON middleware.
4. `fulfillCheckoutSession()` records billing events and increments user simulation tokens in MongoDB.

### Simulation and Scientific Service Path

1. Dashboard simulation pages call endpoints such as `/api/simulation`, `/api/diffdock/generate`, `/api/generate-molecules`, `/api/openfold3/predict`, `/api/gromacs/*`, and `/api/glioblastoma/*` (`client/src/pages/dashboard/simulation.jsx`, `client/src/pages/dashboard/gromacs-md.jsx`, `client/src/pages/dashboard/glioblastoma-predict.jsx`).
2. `server/index.js` validates auth, tenant status, and simulation-token availability for token-consuming routes.
3. `server/index.js` proxies NVIDIA, Asinex, Tanimoto, DiffDock, RCSB, ligand, and SDF-converter calls directly from route handlers.
4. `server/routes/scientificServices.js` proxies GROMACS and glioblastoma calls to `GROMACS_API_BASE` and `GLIOBLASTOMA_API_BASE`.
5. Result URLs and viewer state are passed to Molstar/Molecule viewer pages through localStorage and API result records.

### ADMET Queue Path

1. API routes under `/api/simulation/:simulationKey/admet` and `/api/admet/create-task` create ADMET work (`server/index.js`).
2. `server/utils/rabbitMQUtils.js` publishes JSON messages to `ADMET_QUEUE_NAME`.
3. `services/admet/amqpadmet.py` consumes RabbitMQ messages and invokes ADMET prediction code.
4. `services/admet/admet_sender.py` calls back to the API using `API_BASE_URL` and `ADMET_CALLBACK_SECRET`.

**State Management:**
- Frontend auth, viewer, cart, blog, and simulation-navigation state is stored in React context plus localStorage (`client/src/context/auth.jsx`, `client/src/context/blog.jsx`, `client/src/pages/dashboard/molstar3d.jsx`, `client/src/pages/dashboard/simulation.jsx`).
- Server application state uses module-level MongoDB client/collection variables, in-memory rate limiter maps, Stripe client singleton, and RabbitMQ singleton (`server/index.js`, `server/utils/rabbitMQUtils.js`).
- Durable state lives in MongoDB collections: `users`, `companies`, `audit_logs`, `billing_events`, `simulation_logs`, `projects`, and `mol_price`.

## Key Abstractions

**Route Registry:**
- Purpose: Single metadata source for layout-specific navigation and route rendering.
- Examples: `client/src/routes.jsx`, `client/src/layouts/dashboard.jsx`, `client/src/layouts/mainpage.jsx`, `client/src/layouts/auth.jsx`.
- Pattern: Array of route groups with `layout`, `pages`, `path`, `element`, `hideFromMenu`, and `adminOnly` fields.

**Auth Token Helpers:**
- Purpose: Standardize token lookup and route protection on the client.
- Examples: `client/src/utils/constants.js`, `client/src/context/auth.jsx`, `client/src/App.jsx`.
- Pattern: LocalStorage token read/write, with backward-compatible `access_token` and `auth_token` keys.

**API Configuration:**
- Purpose: Keep frontend calls portable between Vite proxy, unified production, and split hosting.
- Examples: `client/src/utils/api.js`, `client/src/utils/constants.js`, `client/vite.config.js`.
- Pattern: Same-origin by default; `VITE_API_BASE_URL` only for split hosting.

**Route Middleware:**
- Purpose: Compose per-route requirements for Mongo availability, JWT identity, active-user status, admin role, rate limits, and token consumption.
- Examples: `ensureMongoConnected`, `authenticateToken`, `requireActiveUser`, `requireCompanyAdmin`, `consumeSimulationToken` in `server/index.js`.
- Pattern: Express middleware functions chained directly in route definitions.

**Tenant and Usage Helpers:**
- Purpose: Normalize company records, tenant filters, ligand service overrides, monthly usage, and simulation token accounting.
- Examples: `buildTenantFilter`, `getCompanyRecord`, `normalizeUsagePolicy`, `getRequestLigandServiceConfig`, `incrementCompanyMonthlyUsage` in `server/index.js`.
- Pattern: Helper functions near route handlers, backed by MongoDB collections.

**External Service Proxy Routes:**
- Purpose: Hide third-party service URLs/API keys from the browser and centralize per-company service overrides.
- Examples: Asinex/Tanimoto/NVIDIA/DiffDock routes in `server/index.js`, GROMACS/glioblastoma routes in `server/routes/scientificServices.js`.
- Pattern: Express handler receives frontend request, builds upstream request, returns upstream status/payload.

**Package Root Boundary:**
- Purpose: Keep root orchestration, client dependencies, and server dependencies independently installable.
- Examples: `package.json`, `client/package.json`, `server/package.json`.
- Pattern: Each package root has a Bun lockfile and npm lockfile; root scripts call `bun --cwd=client`, `bun --cwd=server`, `npm --prefix client`, and `npm --prefix server`.

## Entry Points

**Root dev command:**
- Location: `package.json`
- Triggers: `bun run dev`
- Responsibilities: Run `server` with `bun --watch index.js` and `client` with Vite concurrently.

**Root production command:**
- Location: `package.json`
- Triggers: `bun run start`
- Responsibilities: Build the client and start the unified Bun API/static host.

**Frontend application:**
- Location: `client/src/main.jsx`
- Triggers: Vite development server or built `client/dist/index.html`.
- Responsibilities: Mount React providers and render `App`.

**Frontend route tree:**
- Location: `client/src/App.jsx`, `client/src/routes.jsx`
- Triggers: Browser navigation.
- Responsibilities: Choose layout/page and enforce dashboard token presence.

**API server:**
- Location: `server/index.js`
- Triggers: `bun index.js`, `bun --watch index.js`, `node index.js`, Docker `CMD ["node", "index.js"]`.
- Responsibilities: Validate required env, initialize MongoDB, register middleware/routes, serve API docs/static assets, start HTTP/HTTPS listener.

**Scientific service proxy:**
- Location: `server/routes/scientificServices.js`
- Triggers: API requests mounted under `/api`.
- Responsibilities: Proxy `/api/platform/health`, `/api/gromacs/*`, and `/api/glioblastoma/*`.

**GROMACS service:**
- Location: `services/gromacs-api/app.py`
- Triggers: Docker Compose `gromacs-api` profile.
- Responsibilities: Serve FastAPI endpoints for GROMACS commands, jobs, files, workspaces, and templates.

**Glioblastoma service:**
- Location: `services/glioblastoma-predictor/app.py`
- Triggers: Docker Compose `glioblastoma-predictor` profile.
- Responsibilities: Serve Flask health, SMILES validation, prediction, and batch-prediction endpoints.

**ADMET worker:**
- Location: `services/admet/amqpadmet.py`
- Triggers: Docker Compose `admet-worker` profile.
- Responsibilities: Consume RabbitMQ tasks and produce ADMET callbacks.

**Deploy workflow:**
- Location: `.github/workflows/deploy.yml`
- Triggers: Manual GitHub Actions workflow dispatch.
- Responsibilities: Archive source, copy to the non-prod box, and run `docker compose -f docker-compose.box.yml up -d --build`.

## Architectural Constraints

- **Runtime model:** The active API is a single Express process running on Bun by default, with Node fallback scripts retained in `server/package.json` and root `package.json`.
- **Package management:** Phase 6 establishes Bun as default package runner. Maintain `bun.lock` and `package-lock.json` together at root, `client/`, and `server/`. Docker, CI, `check`, and test script migration remain Phase 7 scope per `README.md`.
- **Threading:** JavaScript code runs on the single-threaded event loop. GROMACS execution and ADMET processing are delegated to Python services/worker containers.
- **Global state:** `server/index.js` uses module-level `MongoClient`, collection variables, Stripe client, plan constants, default service config, and in-memory rate-limit maps. `server/utils/rabbitMQUtils.js` uses a singleton RabbitMQ service instance.
- **Environment loading:** `server/index.js` loads root `.env` via `configDotenv({ path: path.resolve(__dirname, '../.env') })` and process cwd `.env`; never place secrets in package-specific files.
- **Static hosting:** Production-style unified serving depends on `FRONTEND_DIST` or default `../client/dist`; non-API routes fall back to `client/dist/index.html`.
- **Route namespace:** Mount new API endpoints under `/api/*` unless they must match existing external contracts such as `/stripe/webhook`, `/create-checkout-session*`, `/tanimoto/*`, or `/health`.
- **Circular imports:** Not detected in the inspected active code; keep `server/index.js` depending on helpers, and avoid helpers importing `server/index.js`.

## Anti-Patterns

### Bypassing Same-Origin API Helpers

**What happens:** Frontend code hardcodes hosts or bypasses same-origin helpers for backend calls.
**Why it's wrong:** It breaks the Vite proxy/unified production model and reintroduces split-host configuration drift.
**Do this instead:** Use same-origin paths with `API_CONFIG.buildApiUrl()` or `apiRequest()` from `client/src/utils/constants.js` and `client/src/utils/api.js`; keep proxy paths in `client/vite.config.js` aligned.

### Adding More Business Logic to Template or Legacy Trees

**What happens:** Active changes are made in `packages/dashboard-template/` or `legacy/chem-beo-api/`.
**Why it's wrong:** Those trees are reference/archive code and are not the active runtime.
**Do this instead:** Put active frontend code under `client/src/` and active backend code under `server/`; use template/legacy files only as reference.

### Introducing a Fourth JavaScript Package Root

**What happens:** New app code gets a separate package manifest outside root, `client/`, or `server/`.
**Why it's wrong:** Phase 6 package-management workflow tracks exactly the root/client/server package roots and paired Bun/npm lockfiles.
**Do this instead:** Add dependencies to the relevant existing root and refresh all lockfiles with `bun run lockfiles:refresh`.

### Direct Browser Calls to Secret-Bearing Services

**What happens:** React pages call NVIDIA, Stripe, Asinex, SMTP, or other key-bearing services directly.
**Why it's wrong:** Browser calls expose secrets and bypass tenant/service override policy.
**Do this instead:** Add an authenticated proxy route in `server/index.js` or `server/routes/scientificServices.js` and call it from `client/src/pages/...`.

## Error Handling

**Strategy:** Route handlers use local `try/catch` blocks and return JSON errors with upstream status when available; process startup fails fast for missing required environment and failed Mongo initialization.

**Patterns:**
- Required env validation happens before server startup in `server/index.js`.
- Startup Mongo connection/index creation happens in `initializeDatabase()` before `startServer()` listens.
- Protected routes return `401` for missing token, `403` for invalid token/inactive role or depleted simulation tokens, and `500` for server errors.
- Proxy routes generally pass upstream status codes when `error.response?.status` exists.
- Scientific proxy failures return `502` from `server/routes/scientificServices.js`.
- Stripe webhook signature failures return `400`; fulfillment failures return `500`.

## Cross-Cutting Concerns

**Logging:** Use `console.log`, `console.warn`, and `console.error` in `server/index.js`, `server/utils/*`, and Python services. File logging is limited to DiffDock helper logging in `server/index.js`.
**Validation:** Use explicit route-level checks in `server/index.js`, including env validation, password policy, URL validation, tenant/role checks, upload size validation, and object ID parsing.
**Authentication:** Use JWT bearer tokens in `server/index.js`; client stores tokens in localStorage through `client/src/context/auth.jsx` and `client/src/utils/constants.js`.
**Authorization:** Use `requireActiveUser` for active account/company checks and `requireCompanyAdmin` for company administration routes in `server/index.js`.
**Billing:** Use Stripe Checkout sessions and webhook fulfillment in `server/index.js`; never grant paid credits from frontend-only success redirects.
**Observability:** Swagger UI is mounted at `/api-docs` and `/api/docs`; raw OpenAPI JSON is served at `/api/openapi.json`.

---

*Architecture analysis: 2026-06-05*
