# Technology Stack

_Generated: 2026-06-03_

## Runtime & Language

- **Node.js** v22.19.0 — server runtime (confirmed via `node --version`)
- **JavaScript (ESM)** — both `server/` (`"type": "module"`) and `client/` (`"type": "module"`)
- **Python 3.11** — scientific microservices only (`services/admet/`, `services/gromacs-api/`, `services/glioblastoma-predictor/`)

## Frontend

**Framework:**
- React 18.2.0 — UI framework (`client/package.json`)
- React DOM 18.2.0

**Router:**
- react-router-dom 6.17.0 — SPA routing; routes declared in `client/src/routes.jsx`

**Build Tool:**
- Vite 4.5.0 — dev server (port 5173) + production bundler
- Config: `client/vite.config.js`
- `envDir: '..'` — reads `.env` from repo root, not `client/`
- Path alias: `@` → `client/src/` (via `resolve.alias`)
- Dev proxy: `/api`, `/tanimoto`, `/create-checkout-session*`, `/health` → `http://127.0.0.1:3000`

**Styling:**
- Tailwind CSS 3.3.4 — utility classes; config in `client/tailwind.config.cjs`
- @material-tailwind/react 2.1.4 — component library wrapping Tailwind; applied via `withMT()` in Tailwind config
- PostCSS 8.4.31 + autoprefixer 10.4.16
- Sass 1.89.2 — available for `.scss` files

**Key Libraries:**
- @heroicons/react 2.0.18 — icon set
- apexcharts 3.44.0 + react-apexcharts 1.4.1 — charts/dashboards
- d3 7.x — data visualization
- Molecule visualization:
  - ketcher-core / ketcher-react / ketcher-standalone 3.2.x — 2D structure editor
  - molstar 4.18.0 — 3D molecular viewer
  - smiles-drawer 2.1.7 — SMILES string rendering
  - molecule-2d-for-react 0.2.3 — 2D molecule display
  - kekule 1.0.2 — cheminformatics toolkit
- prop-types 15.8.1 — runtime prop validation

**Formatting:**
- Prettier 3.0.3 + prettier-plugin-tailwindcss 0.5.6
- Config: `client/prettier.config.cjs`

## Backend

**Framework:**
- Express 4.18.2 — HTTP server; single-file app at `server/index.js` (ESM)
- Node `--watch` flag in dev (no nodemon needed)
- API docs served at `/api-docs` and `/api/docs` via Swagger UI

**Key Libraries:**
- axios 1.13.5 — HTTP client for upstream API calls (NVIDIA, Tanimoto, Asinex)
- node-fetch 3.3.2 — HTTP client used in proxy routes and email fallback
- cors 2.8.5 — CORS middleware
- form-data 4.0.4 — multipart form construction for upstream requests
- dotenv 17.0.1 — `.env` loading; loads both `../. env` and cwd `.env`

**Auth:**
- jsonwebtoken 9.0.2 — JWT issuance and verification (`JWT_SECRET` env var, ≥32 chars required)
- bcryptjs 3.0.2 — password hashing
- Custom in-memory rate limiter (no external package): `authRateLimit` (30/15min), `publicEmailRateLimit` (5/15min), `checkoutRateLimit` (20/5min)

**DB Client:**
- mongodb 6.17.0 — official MongoDB Node driver; `MongoClient` + `ObjectId` used directly (no ORM)

**Email:**
- nodemailer 7.0.5 — SMTP email sending
- Implementation: `server/utils/emailService.js` (Titan Mail via SMTP)
- Templates: `server/utils/emailTemplates.js`

**Message Queue:**
- amqplib 0.10.9 — RabbitMQ AMQP client
- Implementation: `server/utils/rabbitMQUtils.js`; queues ADMET prediction tasks

**API Docs:**
- swagger-jsdoc 6.2.8 — generates OpenAPI spec from JSDoc comments in `server/index.js`
- swagger-ui-express 5.0.1 — serves Swagger UI at `/api-docs`

**Cheminformatics (server-side):**
- @rdkit/rdkit 2025.3.4 — RDKit WebAssembly build; used server-side for molecule operations
- xlsx 0.18.5 — Excel file parsing for `import-mol-price.js`

## Database & Storage

- **MongoDB 7** (Docker image `mongo:7`) — primary datastore
  - Collections: `users`, `companies`, `audit_logs`, `billing_events`, `simulation_logs`, `projects`, `mol_price`
  - Indexes created/verified at server startup
  - Connection: `MONGODB_URI` env var (required)
- **RabbitMQ 3** (Docker image `rabbitmq:3-management`) — async message queue for ADMET worker
  - Management UI on port 15672
  - AMQP on port 5672
- **File storage:** local filesystem only — no object storage (S3 / GCS) detected

## Scientific Microservices (Docker, optional)

All three services are Dockerized and optional; they run under Docker Compose profiles.

| Service | Language | Profile | Port | Base image |
|---------|----------|---------|------|-----------|
| ADMET worker | Python 3 | `workers` | N/A (queue consumer) | Python |
| GROMACS MD API | Python 3.11 | `science` | 8001→8000 | Ubuntu 22.04 + GROMACS |
| Glioblastoma predictor | Python 3 (Flask) | `science` | 5000 | Python |

**ADMET dependencies:** `admet-ai`, `pika` (AMQP), `requests`, `pandas`
**GROMACS dependencies:** `gromacs` (system), Python app (`requirements.txt` in `services/gromacs-api/`)
**Glioblastoma dependencies:** Flask 2.3.3, pandas 2.0.3, numpy 1.24.3, scikit-learn 1.3.0, rdkit 2023.3.2, joblib 1.3.2, gunicorn 21.2.0, flask-cors 4.0.0

## Dev Tooling

**Package Manager:**
- npm — root workspace uses `npm --prefix` to run sub-package scripts
- No lockfile at root (monorepo); lockfiles in `client/` and `server/`

**Monorepo structure:** Manual — not using nx/turborepo/lerna; root `package.json` orchestrates via `npm --prefix`

**Concurrent dev:**
- concurrently (in `client/devDependencies`) — runs API + Vite in parallel under `npm run dev`

**Containerization:**
- Docker + Docker Compose — for MongoDB, RabbitMQ, and optional science services
- `docker-compose.yml` at repo root

**Linting/Formatting:**
- Prettier 3.0.3 (client) — config at `client/prettier.config.cjs`
- No ESLint config detected at root or in `server/`
- No Husky / lint-staged detected

**Testing:**
- No test framework detected (no jest.config, vitest.config, or `*.test.*` / `*.spec.*` files found)
- `npm run check` = `node --check server/index.js && npm --prefix client run build` (syntax check only)

**TypeScript:**
- Not used — `@types/react` and `@types/react-dom` are installed as devDependencies but the project is plain JavaScript/JSX

## Scripts

| Command | What it does |
|---------|-------------|
| `npm run install:all` | Installs `client/` and `server/` dependencies |
| `npm run dev` | Starts API on :3000 (node --watch) + Vite on :5173 concurrently |
| `npm run build` | Vite production build → `client/dist/` |
| `npm start` | `npm run build` then `FRONTEND_DIST=../client/dist node server/index.js` (unified server) |
| `npm run check` | Syntax-checks `server/index.js` + Vite build (CI gate) |
| `npm run services:up` | `docker compose up -d mongo rabbitmq` |
| `npm run services:science` | Starts GROMACS + Glioblastoma predictor containers |
| `npm run services:workers` | Starts ADMET worker container |
| `npm run services:all` | All optional services |
| `npm --prefix server run import:mol-price -- /path/to/file.xlsx` | Imports molecule pricing data |
