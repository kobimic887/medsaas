# External Integrations

_Generated: 2026-06-03_

## Payment

**Stripe**
- SDK: `stripe` 18.3.0 (server-side) — `server/index.js` line 16
- Client-side: Stripe publishable key embedded via `VITE_STRIPE_PUBLISHABLE_KEY` (build-time)
- Checkout: `stripe.checkout.sessions.create()` — three checkout session types (subscription, one-time)
- Webhook: `POST /stripe/webhook` — verifies signature with `stripe.webhooks.constructEvent()`; calls `fulfillCheckoutSession()` on `checkout.session.completed`
- Idempotency: fulfilled events recorded in `billing_events` MongoDB collection keyed on `stripeSessionId`
- Plan catalog: `PLAN_CATALOG` frozen at server top — Trial / Standard / Academic / Professional with `credits` and `priceCents`
- Required env vars: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `VITE_STRIPE_PUBLISHABLE_KEY`

## Email

**Titan Mail (via Nodemailer)**
- Library: `nodemailer` 7.0.5
- Implementation: `server/utils/emailService.js`
- SMTP hosts tried in order: `server028.yourhosting.nl:587` (STARTTLS, recommended), `smtp.titan.email:465` (SSL), `smtp.titan.email:25`, `smtp.titan.email:587`
- HTML templates: `server/utils/emailTemplates.js` (verification emails, invite emails, password reset)
- Branding injected into templates via `server/config/branding.js` (`getBrandName`, `getPlatformName`)
- Required env vars: `EMAIL_USER`, `EMAIL_PASS`
- Debug utilities: `server/utils/emailDebug.js` (`validateEmailCredentials`, `getTitanMailHelp`)

## AI / ML APIs

**NVIDIA NIM — MolMIM (Molecule Generation)**
- Endpoint: `https://health.api.nvidia.com/v1/biology/nvidia/molmim/generate` (inferred from CLAUDE.md / route handler)
- Route: `POST /api/generate-molecules` — guarded by `authenticateToken → requireActiveUser → consumeSimulationToken('generate-molecules')`
- Client: `axios.post()` in `server/index.js` ~line 214
- Required env var: `NVIDIA_MOLMIM_API_KEY`

**NVIDIA NIM — OpenFold3 (Protein/DNA/RNA Structure Prediction)**
- Route: `POST /api/openfold3/predict` — guarded by `authenticateToken → requireActiveUser → consumeSimulationToken('openfold3')`
- Client: `axios.post()` in `server/index.js` ~line 256
- Required env var: `NVIDIA_OPENFOLD_API_KEY`

## External Scientific APIs

**Tanimoto Similarity Search**
- Base URL: `http://151.145.91.17:8000` (default; override with `TANIMOTO_API_BASE`)
- Proxied routes (all under `/tanimoto`):
  - `GET /v1/search/exact` — exact match
  - `GET /v1/search/similarity` — fingerprint-based similarity (morgan, maccs, feat_morgan, atom_pair, torsion, rdkit)
  - `GET /v1/search/substructure` — substructure search
  - `POST /v1/search/batch` — batch search
  - `POST /v1/upload` — upload dataset
  - `GET /v1/datasets` + `GET /v1/datasets/:id` + `DELETE /v1/datasets/:id`
- Client: `axios` in `server/index.js`

**Asinex Chemical Catalog**
- Catalog API base: `http://dev.asinex.com:58181` (default; override with `ASINEX_API_BASE`)
- Stock API: `https://stock.asinex.com:5443/api/Shop` (`ASINEX_STOCK_API_URL`)
- Docking API: `https://services.asinex.com:8000/docking` (`ASINEX_DOCKING_API_URL`)
- Client: `node-fetch` in `server/index.js`
- Proxied under `/api/asinex/*`

**DiffDock (Molecular Docking)**
- URL: `https://services.asinex.com:58000/molecular-docking/diffdock/generate` (`DIFFDOCK_API_URL`)
- Also invokes `server/diff_dock.sh` for local docking workflows
- Required env var: `DIFFDOCK_API_URL`

**SDF Converter**
- URL: `http://83.229.87.94:8001/convertSTR` (`SDF_CONVERTER_URL`)
- Purpose: Structure file format conversion

## Infrastructure / Cloud

**MongoDB**
- Docker image: `mongo:7`
- Default port: 27017
- Data volume: `mongo-data`
- Required env var: `MONGODB_URI`
- No cloud MongoDB (Atlas) detected; designed for self-hosted

**RabbitMQ**
- Docker image: `rabbitmq:3-management`
- AMQP port: 5672 | Management UI port: 15672
- Data volume: `rabbitmq-data`
- Used for async ADMET prediction job queue
- Required env vars: `RABBITMQ_URL`, `RABBITMQ_USERNAME`, `RABBITMQ_PASSWORD`, `RABBITMQ_VHOST`, `ADMET_QUEUE_NAME`

**Docker / Docker Compose**
- `docker-compose.yml` at repo root
- Core services (always): `mongo`, `rabbitmq`
- Optional profile `workers`: `admet-worker`
- Optional profile `science`: `gromacs-api`, `glioblastoma-predictor`

**Optional HTTPS**
- Express can serve HTTPS directly using `SSL_KEY_PATH` / `SSL_CERT_PATH` env vars (reads key+cert at startup)
- TLS certificates are present in `services/glioblastoma-predictor/` (wildcard certs for `chemtest.tech` domain)

## Internal Scientific Microservices (Self-Hosted via Docker)

These run inside the same Docker Compose stack; they are not external cloud services but separate containerized processes.

**ADMET Worker** (`services/admet/`)
- Transport: RabbitMQ queue (`ADMET_QUEUE_NAME`)
- Callback: posts results back to `POST /api/simulations/:key/admet` with `ADMET_CALLBACK_SECRET` header
- Python stack: `admet-ai`, `pika`, `requests`, `pandas`

**GROMACS MD API** (`services/gromacs-api/`)
- REST API on port 8001 (host) → 8000 (container)
- Proxied at `/api/science/gromacs/*` via `server/routes/scientificServices.js`
- Required env var: `GROMACS_API_BASE` (default `http://localhost:8001`)

**Glioblastoma Predictor** (`services/glioblastoma-predictor/`)
- Flask + scikit-learn ML model served on port 5000
- Proxied at `/api/science/glioblastoma/*` via `server/routes/scientificServices.js`
- Required env var: `GLIOBLASTOMA_API_BASE` (default `http://localhost:5000`)

## Third-party Services

**Swagger / OpenAPI**
- `swagger-jsdoc` generates spec from JSDoc in `server/index.js`
- Served at `GET /api-docs` and `GET /api/docs`
- Raw JSON spec at `GET /api/swagger.json`

**nepcha.com analytics** (referenced in CSP header of `client/vite.config.js`)
- `https://api.nepcha.com` is whitelisted in `Content-Security-Policy` `script-src`
- No SDK import found — likely loaded via a script tag

**3Dmol.js** (referenced in CSP header)
- `https://3dmol.csb.pitt.edu` whitelisted in CSP
- Likely used for 3D molecular visualization via CDN (no npm package found)

**unpkg.com** (referenced in CSP header)
- `https://unpkg.com` whitelisted for CDN-loaded scripts

**cdn.jsdelivr.net** (referenced in CSP header)
- Whitelisted for CDN-loaded scripts (likely RDKit WASM or Ketcher assets)

## Environment Variables Required

All vars below are sourced from `.env.example` at repo root.

### Required (server fails to start without these)
| Variable | Purpose |
|----------|---------|
| `MONGODB_URI` | MongoDB connection string |
| `JWT_SECRET` | JWT signing secret (must be ≥32 chars) |
| `STRIPE_SECRET_KEY` | Stripe server-side API key |

### Required for full functionality
| Variable | Purpose |
|----------|---------|
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signature verification |
| `VITE_STRIPE_PUBLISHABLE_KEY` | Stripe publishable key (build-time, client) |
| `EMAIL_USER` | Titan Mail SMTP username |
| `EMAIL_PASS` | Titan Mail SMTP password |
| `NVIDIA_MOLMIM_API_KEY` | NVIDIA NIM MolMIM API key |
| `NVIDIA_OPENFOLD_API_KEY` | NVIDIA NIM OpenFold3 API key |
| `ADMET_CALLBACK_SECRET` | Shared secret for ADMET worker callbacks |
| `RABBITMQ_URL` | RabbitMQ AMQP connection URL |
| `RABBITMQ_USERNAME` | RabbitMQ username |
| `RABBITMQ_PASSWORD` | RabbitMQ password |
| `RABBITMQ_VHOST` | RabbitMQ virtual host |
| `ADMET_QUEUE_NAME` | Queue name for ADMET jobs |

### Optional / defaulted
| Variable | Default | Purpose |
|----------|---------|---------|
| `NODE_ENV` | `development` | Runtime environment |
| `PORT` | `3000` | API server port |
| `BASE_URL` | `http://localhost:3000` | Server base URL (used in emails) |
| `FRONTEND_URL` | `http://localhost:5173` | Frontend URL (used in emails/redirects) |
| `PLATFORM_NAME` | `MedSaaS` | Fallback platform name |
| `PLATFORM_WEBSITE_URL` | `http://localhost:5173` | Fallback website URL |
| `VITE_PLATFORM_NAME` | `MedSaaS` | Build-time platform name for client |
| `TANIMOTO_API_BASE` | `http://151.145.91.17:8000` | Tanimoto service base URL |
| `ASINEX_API_BASE` | `http://dev.asinex.com:58181` | Asinex catalog API base |
| `ASINEX_STOCK_API_URL` | `https://stock.asinex.com:5443/api/Shop` | Asinex stock API |
| `ASINEX_DOCKING_API_URL` | `https://services.asinex.com:8000/docking` | Asinex docking API |
| `DIFFDOCK_API_URL` | `https://services.asinex.com:58000/molecular-docking/diffdock/generate` | DiffDock API |
| `SDF_CONVERTER_URL` | `http://83.229.87.94:8001/convertSTR` | SDF converter |
| `GROMACS_API_BASE` | `http://localhost:8001` | GROMACS microservice base |
| `GLIOBLASTOMA_API_BASE` | `http://localhost:5000` | Glioblastoma predictor base |
| `FRONTEND_DIST` | `../client/dist` | Path to built frontend (unified server mode) |
| `SSL_KEY_PATH` | — | Path to TLS private key (optional HTTPS) |
| `SSL_CERT_PATH` | — | Path to TLS certificate (optional HTTPS) |
| `VITE_API_BASE_URL` | (empty — Vite proxy handles it) | API base URL override for non-localhost deploys |

## Webhooks & Callbacks

**Incoming webhooks:**
- `POST /stripe/webhook` — Stripe payment events (requires raw body parser + `stripe-signature` header)
- `POST /api/simulations/:key/admet` — ADMET worker posts prediction results back; authenticated via `ADMET_CALLBACK_SECRET` header

**Outgoing webhooks:** None detected.
