# Codebase Structure

**Analysis Date:** 2026-06-14

## Directory Layout

```
medsaas/
├── .planning/                          # GSD project planning docs
│   ├── codebase/                       # Architecture/structure/testing docs (this dir)
│   ├── STATE.md                        # Current milestone state
│   └── ROADMAP.md                      # Future phases
├── .github/workflows/                  # CI/CD — ci.yml (check+test gate) + deploy.yml
├── .claude/                            # Claude Code memory files
├── client/                             # Vite + React 18 dashboard
│   ├── src/
│   │   ├── pages/                      # Route-level components (dashboard, auth, main)
│   │   ├── components/                 # Reusable UI components (molecule viewers, forms)
│   │   ├── context/                    # React Context (auth, branding, cart)
│   │   ├── config/                     # Static config (branding)
│   │   ├── configs/                    # Chart/UI configs
│   │   ├── hooks/                      # Custom React hooks
│   │   ├── layouts/                    # Layout wrappers (DashboardLayout, MainLayout)
│   │   ├── utils/                      # Helpers (API constants, auth token decode)
│   │   ├── data/                       # Static data (sidebar items)
│   │   ├── styles/                     # Global CSS
│   │   ├── widgets/                    # Heroicons + Material Tailwind wrappers
│   │   ├── routes.jsx                  # Route definitions + menu structure
│   │   ├── index.jsx                   # React entry point
│   │   └── App.jsx                     # Root component
│   ├── public/                         # Static assets (images, Ketcher, Molstar)
│   ├── dist/                           # Built output (Vite)
│   ├── package.json                    # Client dependencies (React, Vite, Tailwind)
│   └── vite.config.js                  # Vite config (dev proxy to :3000, @ alias)
├── server/                             # Express API server
│   ├── index.js                        # ENTIRE app (routes, middleware, data models)
│   ├── config/
│   │   └── branding.js                 # Platform/company name helpers
│   ├── routes/
│   │   └── scientificServices.js       # GROMACS, Glioblastoma proxies
│   ├── utils/
│   │   ├── emailTemplates.js           # HTML templates (invite, password reset)
│   │   ├── emailService.js             # Titan email sender
│   │   ├── emailDebug.js               # Email config validation
│   │   ├── companyBranding.js          # Logo/palette utilities
│   │   ├── rabbitMQUtils.js            # RabbitMQ task queue (ADMET)
│   │   └── *.js                        # Other helpers (auth, validation)
│   ├── test/                           # Test files (mocha, chai, test data)
│   ├── package.json                    # Server dependencies (Express, MongoDB, Stripe)
│   ├── blobs/                          # Uploaded logos/branding assets
│   └── diff_dock.sh                    # DiffDock docking script
├── services/                           # Optional Docker microservices
│   ├── admet/                          # ADMET prediction worker (Python)
│   ├── gromacs-api/                    # MD simulation API
│   └── glioblastoma-predictor/         # Cancer prediction API
├── packages/
│   └── dashboard-template/             # Upstream UI reference (not used in app)
├── legacy/
│   └── chem-beo-api/                   # Archived standalone API (not used)
├── spike/
│   └── fixtures/                       # Test data
├── scripts/
│   ├── ensure-dev.mjs                  # Pre-dev validation
│   └── check-brand.mjs                 # Branding config check
├── docs/                               # Documentation
├── package.json                        # Monorepo scripts (install, dev, build, start)
├── docker-compose.yml                  # MongoDB, RabbitMQ, optional science services
├── Dockerfile                          # Production image (single unified server)
├── .env.example                        # Required env vars template
└── README.md                           # Project overview
```

## Directory Purposes

**client/src/pages/:**
- Purpose: Route-level page components, each maps to a frontend route
- Contains: Dashboard pages (Simulation, ProteinFolding, GromacsMd, etc.), Auth pages (SignIn, SignUp), Main pages (MainHome, Services, About)
- Key files: `dashboard/` (feature pages), `auth/` (login/signup), `main/` (marketing)

**client/src/components/:**
- Purpose: Reusable UI components used across pages
- Contains: Molecule viewers (Ketcher, Molstar, OCL, RDKit wrappers), form inputs, BrandingPreview
- Key files: `MoleculeDrawer.jsx`, `OCLMoleculeViewer.jsx`, `SimpleMoleculeViewer.jsx`

**client/src/context/:**
- Purpose: React Context for global state (auth, branding, shopping cart)
- Contains: AuthProvider (user, token, login/logout), BrandingContext, CartContext, BlogContext
- Key files: `auth.jsx` (user session), `branding.jsx` (company/platform branding)

**client/src/utils/:**
- Purpose: Helper functions for API calls, token decoding, constants
- Contains: API_CONFIG (buildApiUrl, buildUrl), token decode, auth helpers
- Key files: `constants.js` (API_CONFIG), `api.js` (getApiBaseUrl), `localStorage` wrappers

**client/src/layouts/:**
- Purpose: Wrapper components that structure pages (navbar, sidebar, footer)
- Contains: DashboardLayout (with sidenav), MainLayout (marketing site)

**server/index.js:**
- Purpose: **Entire backend application** — monolithic Express file
- Contains: 
  - Lines 1–107: Imports, config loading, env validation
  - Lines 109–164: Middleware setup (CORS, security headers, body parser)
  - Lines 166–193: Rate limiters (auth, email, checkout)
  - Lines 226–1500: API endpoints (molecules, openfold, shop, simulation, etc.)
  - Lines 1500–5000: Admin, auth, user endpoints (signup, login, profile, invites)
  - Lines 2591–2603: `authenticateToken()` middleware
  - Lines 5000–5100: Server startup, health check
  - Lines 5100+: Additional endpoints, utility functions

**server/config/branding.js:**
- Purpose: Company branding logic — maps company names to display labels, email from addresses
- Contains: `getBrandName()`, `getPlatformName()`, `getPlatformWebsiteUrl()`

**server/routes/scientificServices.js:**
- Purpose: Proxy routes to internal microservices (GROMACS, Glioblastoma)
- Contains: `proxyJson()` helper, health checks, workflow routes
- Note: Remaps upstream 401 → 502 to avoid triggering client logout on service auth failure

**server/utils/emailTemplates.js:**
- Purpose: HTML email templates (password reset, invite acceptance)
- Contains: `generatePasswordResetEmailHTML()`, `generateInviteEmailHTML()`
- Note: Must escape user input (caller text) to prevent email injection

**server/utils/companyBranding.js:**
- Purpose: Parse/validate/serialize company branding (colors, logos)
- Contains: `DEFAULT_BRAND_PALETTE`, palette extraction, logo upload parsing

**services/admet/**, **services/gromacs-api/**, **services/glioblastoma-predictor/:**
- Purpose: Optional microservices for async/intensive computing
- Docker-only; not part of core app but referenced in docker-compose.yml

## Key File Locations

**Entry Points:**

- `client/src/index.jsx` or `client/src/App.jsx`: React entry point (compiled by Vite to `client/dist/index.html`)
- `server/index.js`: Express entry point (runs on :3000)
- `client/vite.config.js`: Vite build/dev config
- `server/package.json` scripts: `dev:bun`, `start:unified:bun`, `dev:node`

**Configuration:**

- `.env`, `.env.example`: Environment variables (MONGODB_URI, JWT_SECRET, STRIPE keys, API keys)
- `server/index.js` (top 100 lines): Env var loading and validation
- `client/vite.config.js`: Vite dev proxy (maps /api, /health, etc. to :3000)
- `docker-compose.yml`: Service definitions (MongoDB, RabbitMQ, science services)

**Core Logic:**

- `server/index.js`: All API endpoints, auth, middleware, business logic
- `client/src/routes.jsx`: Route definitions, menu items, admin-only gating
- `client/src/context/auth.jsx`: User session management, token persistence
- `server/utils/emailService.js`: Email sending via Titan API
- `server/utils/rabbitMQUtils.js`: Async ADMET task queue integration

**Testing:**

- `server/test/`: Test files (mocha, chai, fixtures)
- `spike/fixtures/`: Sample test data (molecules, proteins)

## Naming Conventions

**Files:**

- **React components:** PascalCase + .jsx (e.g., `DashboardHome.jsx`, `ProteinFolding.jsx`)
- **JavaScript utilities:** camelCase + .js (e.g., `emailService.js`, `companyBranding.js`)
- **Config files:** kebab-case or descriptive (e.g., `vite.config.js`, `.env.example`)

**Directories:**

- **Feature folders:** kebab-case, plural or descriptive (e.g., `pages`, `components`, `utils`)
- **Service/domain folders:** lowercase (e.g., `server`, `client`, `services`)

**Variables & Functions:**

- **Functions:** camelCase, action-verb prefix (e.g., `buildTenantFilter()`, `generateTemporaryPassword()`)
- **Constants:** SCREAMING_SNAKE_CASE (e.g., `JWT_SECRET`, `PLAN_CATALOG`, `PASSWORD_POLICY`)
- **Classes/Contexts:** PascalCase (e.g., `AuthProvider`, `AuthContext`)
- **Enums/options:** camelCase keys in objects (e.g., `{ displayName: '...', credits: ... }`)

**MongoDB collections:**
- lowercase, snake_case if multi-word (e.g., `users`, `companies`, `audit_logs`, `billing_events`, `simulation_logs`)

## Where to Add New Code

**New Feature (e.g., New Simulation Type):**

1. **Backend:**
   - Add endpoint to `server/index.js` → `/api/new-feature`
   - Wrap with middleware chain: `ensureMongoConnected → authenticateToken → requireActiveUser → consumeSimulationToken('new-feature')`
   - Proxy to external API or internal microservice as needed
   - Example: `server/index.js:226–256` (MolMIM endpoint)

2. **Frontend:**
   - Create page component in `client/src/pages/dashboard/new-feature.jsx` (export from `client/src/pages/dashboard/index.js`)
   - Add route entry to `client/src/routes.jsx` (include icon, path, name, adminOnly flag if needed)
   - Call API via `API_CONFIG.buildApiUrl('/new-feature')`
   - Handle loading, error, success states; display results

**New Component (Reusable UI):**
- Add to `client/src/components/` with descriptive PascalCase name
- Export from `client/src/components/index.js` (if index exists) or import directly
- Use Heroicons for icons, Material Tailwind for styling

**New Admin-Only Feature:**
- Create page in `client/src/pages/dashboard/`
- In `client/src/routes.jsx`, set `adminOnly: true` on the route entry
- Backend: wrap with `requireCompanyAdmin` after `authenticateToken`
- Example: CompanyAdmin page at `client/src/pages/dashboard/company-admin.jsx`

**New Utility/Helper:**
- If for client: add to `client/src/utils/` (e.g., `utils/validators.js`)
- If for server: add to `server/utils/` (e.g., `server/utils/mongoHelpers.js`)
- If cross-cutting (constants): use `client/src/utils/constants.js` or `server/config/`

**New Context/Global State:**
- Create file in `client/src/context/` (e.g., `context/NotificationContext.jsx`)
- Export Provider + custom hook (`useNotifications()`)
- Wrap root component in Provider (in `client/src/App.jsx` or layout)

**New Middleware:**
- Add function to `server/index.js` (or new file in `server/middleware/` if refactoring)
- Pattern: `async (req, res, next) { /* validation */ next() or res.status(...).json(...) }`
- Add to middleware chain in endpoint definitions

**New Route Proxy (to External Service):**
- If simple: add endpoint to `server/index.js` with fetch/axios call
- If complex/shared: add to `server/routes/scientificServices.js` and mount at `app.use('/api/scientific', scientificServicesRouter)`
- Use `proxyJson()` helper from scientificServices.js for consistent error handling

**Database Collection:**
- Create via MongoDB directly or add initialization to `initializeDatabase()` in `server/index.js` (~line 720)
- Add unique indexes as needed (see existing indexes at ~lines 738–746)
- Wrap collection access with multi-tenancy filter (use `buildTenantFilter()`)

## Special Directories

**client/dist/:**
- Purpose: Built frontend output from Vite
- Generated: Yes (by `bun run build` or `npm run build`)
- Committed: No (in .gitignore)
- Contains: Bundled JS, CSS, static assets

**server/blobs/:**
- Purpose: Uploaded company logos and branding assets
- Generated: Yes (by logo upload endpoint)
- Committed: No (in .gitignore)
- Contains: PNG/JPG files, organized by companyId

**spike/fixtures/:**
- Purpose: Sample molecules, proteins, test data for development
- Generated: No (manually curated)
- Committed: Yes
- Contains: PDB files, SMILES strings, test datasets

**.planning/:**
- Purpose: GSD project planning, phase docs, codebase analysis
- Generated: Yes (by `/gsd:*` commands)
- Committed: Yes (tracks project state)
- Contains: ROADMAP.md, STATE.md, codebase map docs, phase checklists

**legacy/chem-beo-api/:**
- Purpose: Archive of previous standalone chemistry API
- Status: Not used in current app
- Note: Do not remove; historical reference

---

*Structure analysis: 2026-06-14*
