---
last_mapped_commit: 1a703a98234dd0b9b66866ec31d4d9a1a6455b55
---
# External Integrations

**Analysis Date:** 2026-06-05

## APIs & External Services

**Payments:**
- Stripe Checkout and webhooks - Used for one-time and plan credit purchases.
  - SDK/Client: `stripe` in `server/package.json`; server setup in `server/index.js`.
  - Auth: `STRIPE_SECRET_KEY`; webhook signing secret `STRIPE_WEBHOOK_SECRET`.
  - Incoming endpoint: `POST /stripe/webhook` in `server/index.js`.
  - Checkout routes: `POST /create-checkout-session-onetime`, `POST /create-checkout-session`, and `GET /checkout-session/:sessionId` in `server/index.js`.
  - Client build-time publishable key: `VITE_STRIPE_PUBLISHABLE_KEY` referenced by `client/src/pages/dashboard/paidplans.jsx`, `client/src/pages/main/paidplansdescription.jsx`, and `client/src/widgets/layout/dashboard-navbar.jsx`.

**NVIDIA Biology APIs:**
- NVIDIA MolMIM - Molecule generation proxy.
  - SDK/Client: `axios` in `server/index.js`.
  - Auth: `NVIDIA_MOLMIM_API_KEY`.
  - Endpoint called: `https://health.api.nvidia.com/v1/biology/nvidia/molmim/generate`.
  - Local route: `POST /api/generate-molecules` in `server/index.js`.
- NVIDIA OpenFold3 - Biomolecular complex structure prediction proxy.
  - SDK/Client: `axios` in `server/index.js`.
  - Auth: `NVIDIA_OPENFOLD_API_KEY`.
  - Endpoint called: `https://health.api.nvidia.com/v1/biology/openfold/openfold3/predict`.
  - Local route: `POST /api/openfold3/predict` in `server/index.js`.

**Molecular Search and Docking Services:**
- Tanimoto API - Dataset upload/search/list/delete proxy.
  - SDK/Client: `axios` in `server/index.js`.
  - Auth: Not detected in code; base URL configured by `TANIMOTO_API_BASE`.
  - Default base URL: `http://151.145.91.17:8000` in `server/index.js`.
  - Local routes: `/tanimoto/health`, `/tanimoto/v1/upload`, `/tanimoto/v1/search/exact`, `/tanimoto/v1/search/similarity`, `/tanimoto/v1/search/substructure`, `/tanimoto/v1/search/batch`, and `/tanimoto/v1/datasets` in `server/index.js`.
- ASINEX ligand catalog - Catalog, exact/id/all, structure, substructure, similarity, molecular weight, and direct search wrappers.
  - SDK/Client: native `fetch`/`node-fetch` in `server/index.js`.
  - Auth: Not detected in code.
  - Config: `ASINEX_API_BASE`, `ASINEX_STOCK_API_URL`, `ASINEX_DOCKING_API_URL`, and `DIFFDOCK_API_URL`; per-company overrides are stored on company records and normalized in `server/index.js`.
  - Default catalog base: `http://dev.asinex.com:58181` in `server/index.js`.
  - Local routes: `/api/exact/:smiles`, `/api/all/:id_:pageSize`, `/api/id/:id_number`, `/api/api4/*`, `/api/asinex/*`, and `/api/shop` in `server/index.js`.
- ASINEX stock API - Shop/stock lookup.
  - SDK/Client: native `fetch` in `server/index.js`.
  - Auth: Not detected in code.
  - Config: `ASINEX_STOCK_API_URL`.
  - Default endpoint: `https://stock.asinex.com:5443/api/Shop` in `server/index.js`.
- ASINEX docking API - Docking service proxy.
  - SDK/Client: native `fetch` in `server/index.js`.
  - Auth: Not detected in code.
  - Config: `ASINEX_DOCKING_API_URL`.
  - Default endpoint: `https://services.asinex.com:8000/docking` in `server/index.js`.
- DiffDock API - Molecular docking generation service.
  - SDK/Client: native `fetch` in `server/index.js`.
  - Auth: Not detected in code.
  - Config: `DIFFDOCK_API_URL`.
  - Default endpoint: `https://services.asinex.com:58000/molecular-docking/diffdock/generate` in `server/index.js`.
  - Local routes: `POST /api/diffdock/generate` and `POST /api/diffdock/generate_file` in `server/index.js`.
- SDF converter - Converts structure data.
  - SDK/Client: native `fetch` in `server/index.js`.
  - Auth: Not detected in code.
  - Config: `SDF_CONVERTER_URL`.
  - Default endpoint: `http://83.229.87.94:8001/convertSTR` in `server/index.js`.
- RCSB Protein Data Bank - Downloads PDB and ligand SDF files.
  - SDK/Client: native `fetch` in `server/index.js`.
  - Auth: None.
  - Endpoints called: `https://files.rcsb.org/download/{PDB}.pdb` and `https://files.rcsb.org/ligands/download/{ligand}_ideal.sdf`.

**Integrated Scientific Microservices:**
- GROMACS API - Proxied workflow/job service.
  - SDK/Client: `node-fetch` in `server/routes/scientificServices.js`.
  - Auth: Not detected in proxy code.
  - Config: `GROMACS_API_BASE`, default `http://localhost:8001`.
  - Local routes: `/api/scientific/platform/health`, `/api/scientific/gromacs/health`, `/api/scientific/gromacs/info`, `/api/scientific/gromacs/workflows/:workflow`, and `/api/scientific/gromacs/jobs/:jobId` via `server/routes/scientificServices.js`.
  - Service implementation: `services/gromacs-api/app.py`; dependencies in `services/gromacs-api/requirements.txt`.
- Glioblastoma predictor - Proxied ML prediction service.
  - SDK/Client: `node-fetch` in `server/routes/scientificServices.js`.
  - Auth: Not detected in proxy code.
  - Config: `GLIOBLASTOMA_API_BASE`, default `http://localhost:5000`.
  - Local routes: `/api/scientific/glioblastoma/predict` and `/api/scientific/glioblastoma/batch-predict` via `server/routes/scientificServices.js`.
  - Service implementation: `services/glioblastoma-predictor/app.py`; dependencies in `services/glioblastoma-predictor/requirements.txt`.

**Messaging and Workers:**
- RabbitMQ - Queues ADMET prediction tasks.
  - SDK/Client: `amqplib` in `server/package.json`; implementation in `server/utils/rabbitMQUtils.js`.
  - Auth: `RABBITMQ_URL`, `RABBITMQ_USERNAME`, `RABBITMQ_PASSWORD`, and `RABBITMQ_VHOST`.
  - Queue: `ADMET_QUEUE_NAME`; default in code is `test_queue`, `.env.example` documents `admet_processing_queue`.
  - Local routes: `GET /api/rabbitmq/health`, `GET /api/rabbitmq/queue-status`, and `POST /api/admet/create-task` in `server/index.js`.
- ADMET worker callback - Receives worker results for simulations.
  - SDK/Client: HTTP callback from worker; sender code exists in `services/admet/admet_sender.py`.
  - Auth: `ADMET_CALLBACK_SECRET`.
  - Incoming endpoint: `PUT /api/simulation/:simulationKey/admet` in `server/index.js`.
  - Worker dependencies: `services/admet/requirements.txt`.

**Email:**
- Titan Mail SMTP - Verification, password reset, admin/member invite, and contact email delivery.
  - SDK/Client: `nodemailer` in `server/package.json`; implementation in `server/utils/emailService.js`.
  - Auth: `EMAIL_USER`, `EMAIL_PASS`, optional `EMAIL_FROM`.
  - SMTP hosts tried: `server028.yourhosting.nl` and `smtp.titan.email` in `server/utils/emailService.js`.
  - Test/debug routes: `GET /api/test-email`, `GET /api/debug-email`, `POST /api/send-test-email`, and `POST /api/send-email` in `server/index.js`.

**Frontend Dev Proxy and Public Assets:**
- Vite dev server - Proxies client requests to the API during development.
  - Config: `client/vite.config.js`.
  - Proxy targets: `/api`, `/tanimoto`, checkout routes, and `/health` to `http://127.0.0.1:3000`.
  - CSP allows script/worker sources for `https://cdn.jsdelivr.net`, `https://api.nepcha.com`, `https://3dmol.csb.pitt.edu`, and `https://unpkg.com` in `client/vite.config.js`.
- Static frontend serving - API serves `client/dist` when `FRONTEND_DIST` is configured.
  - Config: `FRONTEND_DIST` in `server/index.js` and `server/package.json`.

## Data Storage

**Databases:**
- MongoDB - Primary application data store.
  - Connection: `MONGODB_URI`.
  - Client: `mongodb` Node driver in `server/index.js`.
  - Collections initialized in `server/index.js`: `users`, `companies`, `audit_logs`, and `billing_events`.
  - Additional collections queried in `server/index.js` include simulation, molecule, project, and activity data collections.
  - Import utility: `server/import-mol-price.js` imports molecule pricing data using `MONGODB_URI`.
  - Test database: `mongodb-memory-server` in `server/test/stripe-webhook.test.mjs` and `server/test/runtime-smoke.test.mjs`.

**File Storage:**
- Local filesystem only for served blobs and frontend assets.
  - Static blobs route: `/blobs` serves `server/blobs` from `server/index.js`.
  - Static SPA route serves `client/dist` via `FRONTEND_DIST` in `server/index.js`.
  - No S3, GCS, Azure Blob, Cloudinary, or UploadThing integration detected.

**Caching:**
- No external cache detected.
- In-process rate limiter uses a module-local `Map` in `server/index.js`.

## Authentication & Identity

**Auth Provider:**
- Custom username/email authentication with JWT.
  - Implementation: `bcryptjs` password hashing, `jsonwebtoken` signing/verification, and MongoDB user records in `server/index.js`.
  - Secret: `JWT_SECRET`.
  - Signup/signin/password routes: `POST /api/signup`, `POST /api/signin`, `POST /api/password-reset/request`, `POST /api/password-reset/confirm`, `POST /api/change-password`, `GET /api/verify-email`, and `POST /api/validate-token` in `server/index.js`.
  - Middleware: `authenticateToken`, `requireActiveUser`, and `requireCompanyAdmin` in `server/index.js`.
- Email verification and password resets use JWT tokens plus Titan Mail in `server/index.js` and `server/utils/emailService.js`.
- No Auth0, Clerk, Firebase Auth, Supabase Auth, OAuth, or SAML provider detected.

## Monitoring & Observability

**Error Tracking:**
- None detected. No Sentry, Datadog, New Relic, OpenTelemetry, or similar dependency appears in active manifests.

**Logs:**
- Console logging through `console.log`, `console.warn`, and `console.error` in `server/index.js`, `server/utils/emailService.js`, `server/utils/rabbitMQUtils.js`, and `server/routes/scientificServices.js`.
- MongoDB connection logs redact credentials in `server/index.js`.
- Titan Mail logs redact email user partially in `server/utils/emailService.js`.

## CI/CD & Deployment

**Hosting:**
- Containerized deployment is supported by `Dockerfile`, `docker-compose.yml`, `docker-compose.deploy.yml`, and `docker-compose.box.yml`.
- Root `Dockerfile` builds the Vite client and Express API with Node 22 Alpine and serves on port 3000.
- Root scripts in `package.json` use Docker Compose service profiles for local infrastructure and scientific workers.

**CI Pipeline:**
- Not detected. No `.github/workflows` files were found in the repository scan.

## Environment Configuration

**Required env vars:**
- Core required at API startup: `MONGODB_URI`, `JWT_SECRET`, `STRIPE_SECRET_KEY`.
- Stripe: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `VITE_STRIPE_PUBLISHABLE_KEY`.
- URLs and serving: `PORT`, `BASE_URL`, `FRONTEND_URL`, `FRONTEND_DIST`, `VITE_API_BASE_URL`, `VITE_PLATFORM_NAME`, `PLATFORM_NAME`, `PLATFORM_WEBSITE_URL`.
- Email: `EMAIL_USER`, `EMAIL_PASS`, optional `EMAIL_FROM`.
- NVIDIA: `NVIDIA_MOLMIM_API_KEY`, `NVIDIA_OPENFOLD_API_KEY`.
- Molecular services: `TANIMOTO_API_BASE`, `ASINEX_API_BASE`, `ASINEX_STOCK_API_URL`, `ASINEX_DOCKING_API_URL`, `DIFFDOCK_API_URL`, `SDF_CONVERTER_URL`.
- RabbitMQ/ADMET: `RABBITMQ_URL`, `RABBITMQ_USERNAME`, `RABBITMQ_PASSWORD`, `RABBITMQ_VHOST`, `ADMET_QUEUE_NAME`, `ADMET_CALLBACK_SECRET`.
- Scientific microservices: `GROMACS_API_BASE`, `GLIOBLASTOMA_API_BASE`.
- Optional HTTPS: `SSL_KEY_PATH`, `SSL_CERT_PATH`.

**Secrets location:**
- Root `.env` file present and intentionally not read.
- Root `.env.example` documents variable names and placeholder values.
- `services/admet/.env.example`, `legacy/chem-beo-api/.env.example`, `legacy/chem-beo-api/.env.rabbitmq.example`, and `packages/dashboard-template/.env.example` exist for service/template/legacy configuration examples.
- Do not read or quote real `.env`, credential, key, or secret files.

## Webhooks & Callbacks

**Incoming:**
- `POST /stripe/webhook` in `server/index.js` - Stripe `checkout.session.completed`; validates `Stripe-Signature` with `STRIPE_WEBHOOK_SECRET` and fulfills checkout credits.
- `PUT /api/simulation/:simulationKey/admet` in `server/index.js` - ADMET worker callback; guarded by `ADMET_CALLBACK_SECRET`.

**Outgoing:**
- Stripe Checkout sessions are created through the Stripe API from `server/index.js`.
- Titan Mail SMTP messages are sent from `server/utils/emailService.js`.
- RabbitMQ ADMET task messages are published from `server/utils/rabbitMQUtils.js`.
- NVIDIA MolMIM/OpenFold requests are sent from `server/index.js`.
- Tanimoto, ASINEX, DiffDock, SDF converter, RCSB, GROMACS, and glioblastoma requests are proxied from `server/index.js` and `server/routes/scientificServices.js`.

---

*Integration audit: 2026-06-05*
