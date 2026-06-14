# Technology Stack

**Analysis Date:** 2026-06-14

## Languages

**Primary:**
- JavaScript (ESM) — Used across the entire monorepo
  - Server: `server/index.js` (ESM, Node.js compatible)
  - Client: `client/src/` (React 18, JavaScript/JSX — 28 `.js` + 50 `.jsx`, no `tsconfig.json`, no TypeScript dependency)
  - Build: Node/Bun scripts
- TypeScript (ESM) — confined to the Bun-migration compatibility spikes only (`spike/*.ts`, e.g. `spike/04-stripe.ts`); NOT used in `server/` or `client/`

**Secondary:**
- Python 3.9–3.12 — Docker-optional scientific microservices
  - ADMET prediction (`services/admet/`) — Python 3.12
  - GROMACS MD API (`services/gromacs-api/`) — Python 3.11
  - Glioblastoma predictor (`services/glioblastoma-predictor/`) — Python 3.9
- Shell scripts — `diff_dock.sh`, utilities

## Runtime

**Primary Environment (Default):**
- **Bun** 1.3.14 (see `Dockerfile` `FROM oven/bun:1.3.14-slim`)
  - Default runtime for all dev, build, and start commands
  - Server: `bun index.js`
  - Client: `bun run build` (invokes `vite build`)
  - Preferred package manager

**Fallback Environment:**
- **Node.js** (version not specified in repo — use system Node)
  - Retained for compatibility
  - Invoked via `:node`-suffixed scripts: `dev:node`, `build:node`, `start:node`, `install:all:node`

**Package Managers:**
- **Bun** (default)
  - All three `bun.lock` files at `/`, `client/`, `server/`
  - Install: `bun install` (per directory via `--cwd`)
  - Lockfile policy: frozen-lockfile in CI (`bun install --frozen-lockfile`)
  
- **npm** (fallback)
  - All three `package-lock.json` files at `/`, `client/`, `server/`
  - Regenerated alongside `bun.lock` via `bun run lockfiles:refresh`
  - Install: `npm ci` (per directory via `--prefix`)
  - Lockfile rule: both families committed together; always refresh both when dependencies change

**Monorepo Structure (Not a Workspace):**
- Root, `client/`, and `server/` are **independent installations**
- Root `package.json` has NO `workspaces` key
- Each dir installs independently: `bun --cwd=client install`, `bun --cwd=server install`, etc.
- Root `package.json` contains only orchestration scripts (dev, build, start, services)

## Frameworks

**Core Server:**
- Express 4.18.2 — REST API, routing, middleware
  - Location: `server/index.js` (single large ESM file + `server/routes/scientificServices.js`)
  - Swagger UI for API documentation
  - `server/config/branding.js`, `server/utils/emailService.js`, `server/utils/rabbitMQUtils.js`

**Core Client:**
- React 18.2.0 + React Router 6.17.0 — Dashboard frontend
- Vite 4.5.0 — Client bundler (NOT replaced by Bun)
  - Build command: `bun run build` → `bun --cwd=client run build` → `vite build`
  - Dev command: `bun --cwd=client run dev` → `vite` (port 5173)
  - Configuration: `client/vite.config.js` with proxy to localhost:3000

**Testing (Server):**
- `mongodb-memory-server` 11.2.0 — In-memory MongoDB for tests
- Test files: `server/test/stripe-webhook.test.mjs`, `server/test/branding.test.mjs`, `server/test/runtime-smoke.test.mjs`
- Test runner: Bun's native test framework (via `bun test` or `bun --watch`)

**UI/Styling:**
- Material Tailwind 2.1.4 — React component library
- Tailwind CSS 3.3.4 — Utility CSS framework
- PostCSS 8.4.31 + Autoprefixer — CSS processing
- Heroicons 2.0.18 — Icon library

**Molecule Visualization:**
- Ketcher 3.2.0 (ketcher-core, ketcher-react, ketcher-standalone) — 2D structure editor
- Molstar 4.18.0 — 3D protein/molecule viewer
- smiles-drawer 2.1.7 — SMILES rendering
- molecule-2d-for-react 0.2.3 — 2D molecule visualization
- RDKit (`@rdkit/rdkit` 2025.3.4-1.0.0) — Cheminformatics library (server-side + client-side)
- Kekule 1.0.2 — Molecular structure visualization

**Data Visualization:**
- ApexCharts 3.44.0 + react-apexcharts 1.4.1 — Charts and graphs
- D3 7.9.0 — Data visualization

**Scientific Microservices (Docker, Optional):**
- ADMET prediction: Python 3.12 + admet-ai + pika (RabbitMQ client)
- GROMACS API: Python 3.11 + FastAPI + Uvicorn
- Glioblastoma predictor: Python 3.9 + Flask + Gunicorn

**Build & Dev:**
- Vite 4.5.0 — Client bundler
- Bun Build (native) — Server syntax check (`bun build server/index.js --target=bun`)
- Concurrently 9.2.0 — Run API + client dev servers concurrently

**Code Quality:**
- Prettier 3.0.3 — Code formatter
- prettier-plugin-tailwindcss 0.5.6 — Tailwind class sorting

## Key Dependencies

**Critical (Authentication & Billing):**
- jsonwebtoken 9.0.2 — JWT token generation and verification (sessions)
- bcryptjs 3.0.2 — Password hashing
- stripe 18.3.0 — Stripe payment processing SDK

**Infrastructure:**
- mongodb 6.17.0 — MongoDB client/driver
- amqplib 0.10.9 — RabbitMQ client (for ADMET task queues)
- nodemailer 7.0.5 — Email sending via SMTP (Titan Mail)

**API Integration:**
- axios 1.13.5 — HTTP client for NVIDIA APIs, Tanimoto, scientific services
- node-fetch 3.3.2 — Fetch API for Node.js (proxy/health checks)
- form-data 4.0.4 — Multipart form data handling

**Scientific Computing:**
- @rdkit/rdkit 2025.3.4-1.0.0 — RDKit cheminformatics (server-side)
- sharp 0.34.5 — Image processing (molecule thumbnails, branding)
- node-vibrant 4.0.4 — Color extraction from images (branding)
- xlsx 0.18.5 — Excel import/export (molecule pricing data)

**API Documentation:**
- swagger-jsdoc 6.2.8 — JSDoc to OpenAPI conversion
- swagger-ui-express 5.0.1 — Swagger UI middleware

**Dev & Testing:**
- vite-plugin-node-polyfills 0.23.0 — Node.js polyfills for browser
- @vitejs/plugin-react 4.1.0 — React Fast Refresh for Vite

**Utilities:**
- dotenv 17.0.1 — Environment variable loading
- cors 2.8.5 — CORS middleware
- sass 1.89.2 — SCSS compilation (for client dev)

## Configuration

**Environment Variables:**
- Location: Root `.env` (loaded by both server and client)
- Validation: Checked at server startup; `MONGODB_URI`, `JWT_SECRET`, `STRIPE_SECRET_KEY` are required
- Vite proxy: `envDir: '..'` in `client/vite.config.js` — reads root `.env` at build time
- Client build-time vars: `VITE_STRIPE_PUBLISHABLE_KEY`, `VITE_PLATFORM_NAME`

**Required Environment Variables:**
- `MONGODB_URI` — MongoDB connection string
- `JWT_SECRET` — Session token signing key (≥32 chars enforced by validation)
- `STRIPE_SECRET_KEY` — Stripe API secret key
- `STRIPE_WEBHOOK_SECRET` — Stripe webhook signature verification
- `EMAIL_USER`, `EMAIL_PASS` — Titan Mail SMTP credentials
- `NVIDIA_MOLMIM_API_KEY` — NVIDIA MolMIM molecule generation
- `NVIDIA_OPENFOLD_API_KEY` — NVIDIA OpenFold3 protein folding

**Optional Environment Variables:**
- `PORT` — Server port (default: 3000)
- `BASE_URL`, `FRONTEND_URL` — Callback URLs
- `PLATFORM_NAME`, `PLATFORM_WEBSITE_URL` — Branding fallbacks
- `TANIMOTO_API_BASE`, `ASINEX_API_BASE`, `ASINEX_STOCK_API_URL`, `ASINEX_DOCKING_API_URL` — Scientific service URLs
- `RABBITMQ_URL`, `RABBITMQ_USERNAME`, `RABBITMQ_PASSWORD` — Message queue config
- `GROMACS_API_BASE`, `GLIOBLASTOMA_API_BASE` — Internal microservice endpoints
- `FRONTEND_DIST` — Path to built client (for unified server mode)
- `SSL_KEY_PATH`, `SSL_CERT_PATH` — Optional HTTPS certificates

**Build Configuration:**
- `client/vite.config.js` — Vite config with `@` alias to `src/`, proxy to API port 3000
- `server/package.json` — ESM module via `"type": "module"`
- Root `.prettierrc` — Formatter config
- `.gitignore` — Standard Node.js + build artifacts

## Platform Requirements

**Development:**
- Bun 1.3.14 (default) or Node.js (fallback)
- Docker & Docker Compose (for services: MongoDB, RabbitMQ, science microservices)
- Python 3.9+ (only if running science services locally)

**Production:**
- Bun 1.3.14 or Node.js
- Docker (Dockerfile uses `oven/bun:1.3.14-slim` as base)
- MongoDB 7+ (Atlas or local container)
- Stripe account (for payment processing)
- SMTP provider (Titan Mail) for email
- NVIDIA API keys (for molecule generation, protein folding)
- Optional: RabbitMQ, GROMACS, Glioblastoma microservices

**Unified Server Deployment:**
- Express serves built frontend from `client/dist` when `FRONTEND_DIST` env var is set or `../client/dist` exists
- Single Docker container runs both client (pre-built) and API server

---

*Stack analysis: 2026-06-14*
