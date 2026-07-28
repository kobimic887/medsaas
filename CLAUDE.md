# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Planning

Before non-trivial work, write a short plan and get it agreed.

**There is no plugin-provided planning workflow enabled right now.** The `superpowers` plugin
is cached on disk at `~/.claude/plugins/cache/claude-plugins-official/superpowers/6.1.1/`
with all fourteen of its skills present — but it is **not in `enabledPlugins`** in
`~/.claude/settings.json` (only `frontend-design`, `codex` and `caveman` are). So
`writing-plans`, `using-superpowers`, `test-driven-development`, `systematic-debugging`,
`dispatching-parallel-agents`, `verification-before-completion` and the rest do **not
resolve**. Do not reference them as though they do.

It is one setting away, not gone: enable it with `/plugin` or by adding
`"superpowers@claude-plugins-official": true` to `enabledPlugins`. If that happens, update
this section rather than leaving it contradicting reality.

The skill that does apply here is **`medsaas-dev`** (user-scoped, `~/.claude/skills/medsaas-dev/`).
`graphify` is also installed.

Historical plans were in `.planning/` (97 files: GSD milestones, roadmaps, phase plans and
codebase maps). **That directory has been deleted from the working tree but is still tracked
in git** — the deletion is uncommitted. Recover any of it with
`git show HEAD:.planning/<file>`. Do not write new `.planning/` files or reference `/gsd:*`
commands; that workflow is retired.

- **Milestone history (reference):** v1 ChemBench Cleanup · v2 Bun Migration — incl. **Phase 7 (Docker, CI/CD, Scripts), shipped 2026-06-05** · v3 Company Brand Colour (per-company logo-driven palette across dashboard + emails), complete.
- **CI now gates deploys:** `.github/workflows/ci.yml` runs Bun and Node fallback checks on push/PR, and `deploy.yml` won't ship unless the reusable CI gate passes (`needs: test`).
- **CI/CD source of truth:** repo-owned workflows are only `.github/workflows/ci.yml` and `.github/workflows/deploy.yml`. Dynamic GitHub Actions entries such as CodeQL, Dependency Graph, Copilot, Claude, and Codex come from GitHub settings/integrations. Current deploy builds on the box from `docker-compose.box.yml`; GHCR/GitHub Packages is legacy and unused. See `docs/CI-CD.md`.
- **Planned: backend moves to a dedicated GPU box** (Amsterdam, x86_64). `docs/COMPUTE-BOX-MIGRATION.md` is the full trace of every machine, API, and compute dependency plus the move plan, CUDA matrix, and storage layout. Nothing is applied yet — read it before touching Dockerfiles, compose files, or `docs/CI-CD.md`.
- **The box is for docking, not for everything.** `docs/BOX-SPEC.md` supersedes the hardware spec and science-stack scope in the migration doc: folding (`/api/openfold3/predict`) and molecule generation (`/api/generate-molecules`) **stay on NVIDIA's hosted NIM permanently** — NVIDIA runs them on datacenter GPUs we will not beat per job. The box exists for **AutoDock-GPU, Vina and DiffDock**, the capability that cannot be bought. No MSA pipeline, no ColabFold databases, no OSS OpenFold3, no MolMIM replacement. GROMACS/ADMET/glioblastoma get faster incidentally and get no budget spent on them. Hardware is being re-quoted (many-cores over big-VRAM); the "2× RTX PRO 5000" config is the old one.
- **Planned: this stops being a SaaS.** For now and for a long time it is one product for one company, Pyxis Discovery. The marketing site, public signup and paid-plans surface are to be retired; multi-tenancy plumbing and the credit system stay. `docs/PYXIS-ONLY.md`. Nothing applied yet — do not add new tenant-facing or billing features.
- **Docs index:** `docs/README.md`. Claude for Life Sciences / MCP: `docs/CLAUDE-LIFE-SCIENCES.md`.

Bun is the default runtime and package manager for this repo. npm/Node fallbacks
are retained via `:node`-suffixed scripts. See the Commands section below.

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
`client/package.json`. Docker, CI, `check`, and test scripts use the Bun-default
paths, with Node fallbacks retained for runtime parity checks.

Lockfile rule: root, `client/`, and `server/` keep both `bun.lock` and `package-lock.json`.
When dependencies change, run `bun run lockfiles:refresh` and commit both lockfile families
together so Bun defaults and npm fallbacks stay reproducible.

Dev URLs: frontend at **http://localhost:5173**, API at http://localhost:3000, API docs at http://localhost:3000/api-docs.

## Architecture

### Monorepo layout
- `server/` — Express API server. All routes live in `server/index.js` (one large ESM file) plus `server/routes/scientificServices.js` for microservice proxies.
- `client/` — Vite + React 18 dashboard using Material Tailwind and Heroicons. `@` aliases to `client/src/`.
- `services/admet/`, `services/gromacs-api/`, `services/glioblastoma-predictor/` — Scientific microservices (Docker, optional).
- `services/mcp-server/` — ChemBench MCP server (Bun + `@modelcontextprotocol/sdk`). Exposes 14 platform tools to **Claude for Life Sciences** over stateless Streamable HTTP on `:8080/mcp`, proxying to the platform API. See `docs/CLAUDE-LIFE-SCIENCES.md`.

### Where things actually run

| Machine | What it runs |
|---|---|
| `83.229.87.94` (shared VPS, nginx + TLS) | **the production frontend** — `app.pyxis-discovery.com` — plus the `/convertSTR` SMILES→SDF service on `:8001`. Shared with an unrelated project; **do not modify nginx, TLS, DNS, or the firewall there.** |
| Oracle VPS `151.145.91.17` (Ampere arm64) | the **non-prod** full-stack copy that `deploy.yml` ships (`medsaas-app-1` + Mongo + MCP server), plus the tonomitosql stack. Ops notes in the separate `~/projects/oracle` repo. |
| Amsterdam GPU box | **does not exist yet.** All backend and compute is planned to consolidate here — `docs/COMPUTE-BOX-MIGRATION.md`. |

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

**Molecule visualization:** Ketcher is served from `client/public/ketcher`,
Molstar is served from `client/public/molstar` via its CDN build, the RDKit UI
loader lives in `client/index.html`, and `@rdkit/rdkit` is installed server-side.

### Scientific feature backends
| Feature | Route prefix | Backend |
|---------|-------------|---------|
| Molecule generation | `/api/generate-molecules` | NVIDIA MolMIM, hosted (`health.api.nvidia.com`) |
| Protein folding | `/api/openfold3/predict` | NVIDIA OpenFold3, hosted (`health.api.nvidia.com`) |
| Tanimoto search | `/tanimoto/v1/*` | **tonomitosql** (`kobimic887/tonomitosql`) — FastAPI + Postgres/RDKit cartridge, via `TANIMOTO_API_BASE` |
| Asinex catalog / stock / docking | `/api/asinex/*`, `/api/shop` | Asinex APIs. **Per-company overridable** via `company.ligandServiceConfig` |
| DiffDock docking | `/api/diffdock/generate` | `DIFFDOCK_API_URL` (Asinex-hosted). `server/diff_dock.sh` is **dead code** — it posts to a `localhost:8000` NIM that has never run |
| SMILES→SDF conversion | used inside `/api/diffdock/generate` | `SDF_CONVERTER_URL` — a service on the shared `83.229.87.94` box |
| ADMET prediction | RabbitMQ queue | `services/admet/` worker — **not currently deployed anywhere** |
| GROMACS MD | `server/routes/scientificServices.js` | `services/gromacs-api/` — **not currently deployed anywhere**, and the image is a CPU-only apt build |
| Glioblastoma | `server/routes/scientificServices.js` | `services/glioblastoma-predictor/` — **not currently deployed anywhere** |

No code in this repo performs an MSA, a fold, or a local dock — folding and generation are
thin proxies to NVIDIA's hosted endpoints. See `docs/COMPUTE-BOX-MIGRATION.md`.

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
