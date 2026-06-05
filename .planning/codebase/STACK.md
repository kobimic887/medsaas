---
last_mapped_commit: 1a703a98234dd0b9b66866ec31d4d9a1a6455b55
---
# Technology Stack

**Analysis Date:** 2026-06-05

## Languages

**Primary:**
- JavaScript ES modules - Main client and API implementation in `client/src`, `server/index.js`, `server/routes/scientificServices.js`, and `server/utils`.
- JSX - React screens and widgets in `client/src/pages`, `client/src/widgets`, `client/src/components`, and `packages/dashboard-template/src`.

**Secondary:**
- Python - Scientific microservices and ADMET worker code in `services/gromacs-api/app.py`, `services/glioblastoma-predictor/app.py`, `services/admet/admentpred.py`, `services/admet/amqpadmet.py`, and `services/admet/admet_sender.py`.
- TypeScript - Spike/runtime compatibility scripts only, such as `spike/01-boot-health.ts`, `spike/02-mongo.ts`, and `spike/04-stripe.ts`.
- Shell/Dockerfile syntax - Container build definitions in `Dockerfile`, `services/admet/Dockerfile`, `services/gromacs-api/Dockerfile`, `services/glioblastoma-predictor/Dockerfile`, and `packages/dashboard-template/Dockerfile`.

## Runtime

**Environment:**
- Bun is the default application runtime for local development and server startup. Root scripts in `package.json` call `bun --cwd=server run dev:bun`, `bun --cwd=client run dev`, and `bun --cwd=server run start:unified:bun`.
- Node.js remains a supported fallback runtime. Root scripts in `package.json` expose `dev:node`, `start:node`, `start:api:node`, and `start:web:node`; `server/package.json` exposes `start:node`, `dev:node`, and `start:unified:node`.
- Container production image currently uses `node:22-alpine` and npm commands in `Dockerfile`, so production container builds are Node/npm-based unless the Dockerfile is changed.
- Python services run separately from the JavaScript app: FastAPI/Uvicorn for `services/gromacs-api`, Flask/Gunicorn for `services/glioblastoma-predictor`, and a RabbitMQ-backed ADMET worker in `services/admet`.

**Package Manager:**
- Bun is the default package manager for active root/client/server workflows.
- Lockfiles: `bun.lock` present at repo root, `client/bun.lock`, and `server/bun.lock`.
- npm fallback lockfiles: `package-lock.json`, `client/package-lock.json`, and `server/package-lock.json`.
- `package.json` keeps paired Bun and Node aliases: `install:all:bun` / `install:all:node`, `build:bun` / `build:node`, and `start:bun` / `start:node`.
- `lockfiles:refresh` in `package.json` refreshes Bun and npm lockfiles for root, `client`, and `server`.

## Frameworks

**Core:**
- React 18.2.0 - Client UI in `client/package.json` and `client/src`.
- Vite 4.5.0 - Client development server and production build retained in `client/package.json` and `client/vite.config.js`.
- Express 4.18.2 - Main API server and unified static frontend serving in `server/package.json` and `server/index.js`.
- MongoDB Node Driver 6.17.0 - Database access in `server/index.js` and import utility `server/import-mol-price.js`.
- FastAPI 0.109.0 - GROMACS API service in `services/gromacs-api/requirements.txt` and `services/gromacs-api/app.py`.
- Flask 2.3.3 - Glioblastoma predictor service in `services/glioblastoma-predictor/requirements.txt` and `services/glioblastoma-predictor/app.py`.

**Testing:**
- Node test scripts without a dedicated test runner - `server/test/stripe-webhook.test.mjs`, `server/test/runtime-smoke.test.mjs`, and `server/test/runtime-watch-smoke.mjs` are launched from `server/package.json`.
- `mongodb-memory-server` 11.2.0 - Ephemeral MongoDB for server smoke and Stripe webhook tests in `server/package.json` and `server/test`.
- Runtime parity tests support Bun and Node via `SERVER_RUNTIME=bun` or `SERVER_RUNTIME=node` in `server/test/runtime-smoke.test.mjs`.
- Python service tests are ad hoc; `services/glioblastoma-predictor/test_api.py` exists alongside the Flask service.

**Build/Dev:**
- `concurrently` 9.2.0 - Runs API and web dev processes from root `package.json`.
- `@vitejs/plugin-react` 4.1.0 - React plugin configured by `client/vite.config.js`.
- Tailwind CSS 3.3.4, PostCSS 8.4.31, Autoprefixer 10.4.16, Sass - Styling toolchain in `client/package.json`.
- Prettier 3.0.3 with `prettier-plugin-tailwindcss` - Formatting dependencies in `client/package.json` and config in `client/prettier.config.cjs`.
- Docker Compose - Root scripts in `package.json` start MongoDB, RabbitMQ, GROMACS, glioblastoma, and ADMET profiles through `docker-compose.yml`.

## Key Dependencies

**Critical:**
- `express` - Owns HTTP routing, middleware, Swagger UI, webhook raw body handling, and static frontend fallback in `server/index.js`.
- `mongodb` - Owns persistent storage for users, companies, audit logs, billing events, simulations, molecules, projects, and ADMET data in `server/index.js`.
- `jsonwebtoken` - Custom JWT authentication and password reset token handling in `server/index.js`.
- `bcryptjs` - Password hashing in `server/index.js` and runtime tests.
- `stripe` - Checkout session creation, session retrieval, and webhook signature verification in `server/index.js`.
- `nodemailer` - Titan Mail SMTP delivery in `server/utils/emailService.js`.
- `amqplib` - RabbitMQ queue publishing and health checks for ADMET work in `server/utils/rabbitMQUtils.js`.
- `axios` and `node-fetch` - External scientific API proxy calls throughout `server/index.js` and `server/routes/scientificServices.js`.
- `@rdkit/rdkit` - Chemistry toolkit dependency declared in `server/package.json`.
- `react`, `react-dom`, and `react-router-dom` - Client routing and rendering in `client/src`.
- `ketcher-*`, `molstar`, `smiles-drawer`, `kekule`, and `molecule-2d-for-react` - Molecule editing/visualization stack declared in `client/package.json`.

**Infrastructure:**
- `cors` - CORS policy for the API in `server/index.js`.
- `dotenv` - Root and server environment loading in `server/index.js`; server code loads `../.env` and then default `.env`.
- `swagger-jsdoc` and `swagger-ui-express` - OpenAPI generation and `/api-docs` serving in `server/index.js`.
- `form-data` - Multipart/external API payload support declared in `server/package.json`.
- `xlsx` - Spreadsheet import/export support declared in `server/package.json`.
- `@material-tailwind/react`, `@heroicons/react`, `apexcharts`, `react-apexcharts`, and `d3` - Dashboard UI and charting stack in `client/package.json`.
- `vite-plugin-node-polyfills` - Browser polyfill support declared in `client/package.json`.

## Configuration

**Environment:**
- Root `.env` is present and must not be read or committed; `.env.example` documents required environment names.
- `server/index.js` requires `MONGODB_URI`, `JWT_SECRET`, and `STRIPE_SECRET_KEY` at startup and rejects `JWT_SECRET` values shorter than 32 characters.
- `server/index.js` loads environment values from the repo root by calling `configDotenv({ path: path.resolve(__dirname, '../.env') })` and then `configDotenv()`.
- `client/vite.config.js` uses `envDir: '..'`, so Vite reads root-level Vite variables such as `VITE_API_BASE_URL`, `VITE_STRIPE_PUBLISHABLE_KEY`, and `VITE_PLATFORM_NAME`.
- Use `.env.example` as the source of required names: `PORT`, `BASE_URL`, `FRONTEND_URL`, `MONGODB_URI`, `JWT_SECRET`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `EMAIL_USER`, `EMAIL_PASS`, NVIDIA keys, scientific service URLs, RabbitMQ credentials, and optional SSL paths.

**Build:**
- Root `package.json` build defaults to `bun --cwd=client run build`.
- Client build remains Vite-based through `client/package.json` and `client/vite.config.js`.
- Unified server startup serves `client/dist` when `FRONTEND_DIST=../client/dist` is set through `server/package.json` scripts.
- Docker build currently uses npm in `Dockerfile`: client `npm ci`, `npm run build`, server `npm ci --omit=dev`, and `CMD ["node", "index.js"]`.
- Vite development proxy sends `/api`, `/tanimoto`, checkout routes, and `/health` to `http://127.0.0.1:3000` in `client/vite.config.js`.
- Vite CSP headers allow CDN/runtime script sources for Ketcher/Molstar-related client assets in `client/vite.config.js`.

## Platform Requirements

**Development:**
- Bun installed and available on PATH for default scripts in `package.json`, `client/package.json`, and `server/package.json`.
- Node.js available for fallback scripts, Docker builds, `node --check`, and test scripts that launch with `node`.
- npm available for fallback installs and package-lock refresh commands.
- MongoDB required for normal API startup via `MONGODB_URI`; tests can use `mongodb-memory-server`.
- RabbitMQ required for ADMET queue integration via `RABBITMQ_URL` and related variables.
- Docker Compose available for `services:up`, `services:science`, `services:workers`, and `services:all` scripts in `package.json`.
- Python service dependencies installed from `services/gromacs-api/requirements.txt`, `services/glioblastoma-predictor/requirements.txt`, and `services/admet/requirements.txt` when running scientific services outside containers.

**Production:**
- API listens on `PORT` defaulting to 3000 in `server/index.js`.
- Container image in `Dockerfile` builds and runs on Node 22 Alpine.
- Static frontend is served by the API when `FRONTEND_DIST` points to `client/dist`; otherwise root redirects to `/api-docs`.
- Optional HTTPS serving uses `SSL_KEY_PATH` and `SSL_CERT_PATH` in `server/index.js`.
- Deployment must provide MongoDB, Stripe, JWT, email, and service integration environment variables documented in `.env.example`.

---

*Stack analysis: 2026-06-05*
