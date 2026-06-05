# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## GSD Project

This project uses GSD for planning. See `.planning/` for context.

- **Current milestone:** v2 Bun Migration
- **Roadmap:** `.planning/ROADMAP.md`
- **State:** `.planning/STATE.md`
- **Active phase:** Phase 4 — Compatibility Spike + Baseline (not yet started)

When starting work: read `.planning/STATE.md` for current context.
When done with a phase: run `/gsd:verify-work` before moving on.

## Commands

```bash
# Install all dependencies (run once after clone)
bun run install:all

# npm/Node fallback install
npm run install:all:node

# Development (runs API on :3000 + Vite on :5173 concurrently)
bun run dev

# Node fallback development
npm run dev:node

# Production build + unified server
bun run build
bun run start

# npm/Node fallback build + unified server
npm run build:node
npm run start:node

# Syntax-check server JS + build client (no test suite)
npm run check

# Infrastructure (requires Docker)
npm run services:up          # MongoDB + RabbitMQ
npm run services:science     # GROMACS API + Glioblastoma predictor
npm run services:workers     # ADMET worker
npm run services:all         # All optional services

# Import molecule pricing data
npm --prefix server run import:mol-price -- /path/to/mol_price.xlsx
```

Bun is the default package runner for install, dev, build, and start. npm/Node fallback
aliases are retained with `:node` suffixes. Vite remains the client bundler:
`bun run build` invokes `bun --cwd=client run build`, which runs `vite build` from
`client/package.json`. Docker, CI, `check`, and test script migration remain Phase 7 scope.

Lockfile rule: root, `client/`, and `server/` keep both `bun.lock` and `package-lock.json`.
When dependencies change, run `bun run lockfiles:refresh` and commit both lockfile families
together so Bun defaults and npm fallbacks stay reproducible.

Dev URLs: frontend at **http://localhost:5173**, API at http://localhost:3000, API docs at http://localhost:3000/api-docs.

## Architecture

### Monorepo layout
- `server/` — Express API server. All routes live in `server/index.js` (one large ESM file) plus `server/routes/scientificServices.js` for microservice proxies.
- `client/` — Vite + React 18 dashboard using Material Tailwind and Heroicons. `@` aliases to `client/src/`.
- `services/admet/`, `services/gromacs-api/`, `services/glioblastoma-predictor/` — Scientific microservices (Docker, optional).
- `packages/dashboard-template/` — Upstream UI reference only, not imported directly by the app.
- `legacy/chem-beo-api/` — Archived standalone chemistry API, not used.

### Server
The server is a single Express app (`server/index.js`, ESM). It starts with `node --watch index.js` in dev. Required env vars are validated at startup: `MONGODB_URI`, `JWT_SECRET` (≥32 chars), `STRIPE_SECRET_KEY`.

**Middleware chain for protected simulation endpoints:**
```
ensureMongoConnected → authenticateToken → requireActiveUser → consumeSimulationToken(feature)
```

**Multi-tenancy:** Every user belongs to a company. The company name entered at signup drives sidebar labels, email branding (`getBrandName(companyName)` in `server/config/branding.js`), and invite emails. `PLATFORM_NAME` is only a fallback when no company name exists.

**Roles:** `owner` (first user in a company), `admin`, `member`. `requireCompanyAdmin` enforces owner/admin. The `adminOnly: true` flag on dashboard routes hides pages from members.

**Token economy:** Users have `simulationTokens`. `consumeSimulationToken(feature)` middleware atomically decrements the count before executing a simulation. Credits are granted only via Stripe `checkout.session.completed` webhook — never from the frontend.

**Billing:** `PLAN_CATALOG` (frozen at server top) defines Trial/Standard/Academic/Professional plans with `credits` and `priceCents`. Stripe checkout sessions embed `purchaseType`, `credits`, and `username` in metadata; `fulfillCheckoutSession` applies the credit grant idempotently via `billingEventsCollection`.

**Audit logging:** `recordAuditEvent(req, action, details, status)` writes to `audit_logs` collection for auth and admin actions.

**Rate limiting:** Custom in-memory rate limiter (no external package). Three limiters: `authRateLimit` (30/15min), `publicEmailRateLimit` (5/15min), `checkoutRateLimit` (20/5min).

**Password policy:** `/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+...]).{8,}$/` — enforced at signup, invite accept, and password change.

**Static serving:** When `FRONTEND_DIST` env var is set (or `../client/dist` exists), Express serves the built frontend. Otherwise `/` redirects to `/api-docs`.

### Client
Routes are defined in `client/src/routes.jsx` and consumed by the dashboard layout. Each route entry has an `icon`, `name`, `path`, and `element`. Set `hideFromMenu: true` to exclude from the sidenav. Set `adminOnly: true` for owner/admin-only pages.

**Auth state** is managed by `AuthContext` (`client/src/context/auth.jsx`). It stores `user_info` and `access_token` in `localStorage`. Use `useAuth()` to access `user`, `login`, `logout`, `isAdmin()`, `isLoggedIn()`.

**API calls:** Use `API_CONFIG.buildApiUrl(endpoint)` for `/api/*` routes and `API_CONFIG.buildUrl(endpoint)` for top-level routes (Stripe checkout, Tanimoto). In dev, Vite proxies `/api`, `/tanimoto`, `/create-checkout-session*`, and `/health` to port 3000 — no `VITE_API_BASE_URL` needed.

**Molecule visualization libraries:** Ketcher (2D structure editor), Molstar (3D viewer), smiles-drawer, molecule-2d-for-react, RDKit (`@rdkit/rdkit` also installed server-side).

### Scientific feature backends
| Feature | Route prefix | Backend |
|---------|-------------|---------|
| Molecule generation | `/api/generate-molecules` | NVIDIA MolMIM |
| Protein folding | `/api/openfold3/predict` | NVIDIA OpenFold3 |
| Tanimoto search | `/tanimoto/v1/*` | External Tanimoto service |
| Asinex catalog | `/api/asinex/*` | Asinex APIs |
| DiffDock docking | via `server/diff_dock.sh` | DiffDock API |
| ADMET prediction | RabbitMQ queue | `services/admet/` worker |
| GROMACS MD | `server/routes/scientificServices.js` | `services/gromacs-api/` |
| Glioblastoma | `server/routes/scientificServices.js` | `services/glioblastoma-predictor/` |

### MongoDB collections
Core: `users`, `companies`, `audit_logs`, `billing_events`  
Feature: `simulation_logs`, `projects`, `mol_price`

Indexes are created/verified at startup. `companies` uses both `_id` and a stable `companyId` string field (set to `_id.toString()` on creation).

## Environment
Copy `.env.example` to `.env` at the repo root. Vite reads the root `.env` via `envDir: '..'` in `client/vite.config.js`. `server/index.js` loads both `../. env` and the cwd `.env`.

For Stripe webhook testing locally:
```bash
stripe listen --forward-to localhost:3000/stripe/webhook
```
