# External Integrations

**Analysis Date:** 2026-06-14

## APIs & External Services

**NVIDIA (AI/ML):**
- NVIDIA MolMIM API — Molecule generation
  - Endpoint: `POST /api/generate-molecules`
  - SDK/Client: `axios`
  - Auth: `NVIDIA_MOLMIM_API_KEY` (header)
  - Location: `server/index.js` lines 226–260

- NVIDIA OpenFold3 API — Protein/DNA/RNA/ligand structure prediction
  - Endpoint: `POST /api/openfold3/predict`
  - SDK/Client: `axios`
  - Auth: `NVIDIA_OPENFOLD_API_KEY` (header)
  - Location: `server/index.js` lines 279–345

**Tanimoto Similarity Search:**
- External Tanimoto service (configurable)
  - Endpoints: `/tanimoto/v1/upload`, `/tanimoto/v1/search/{exact,similarity,substructure,batch}`, `/tanimoto/v1/datasets/*`
  - SDK/Client: `axios`
  - Auth: None (proxied from authenticated session)
  - Base URL: `TANIMOTO_API_BASE` (default: `http://151.145.91.17:8000`)
  - Location: `server/index.js` lines 347–609

**Asinex Ligand Catalog:**
- Asinex APIs — Ligand catalog search, stock availability, molecular docking
  - Catalog API: `ASINEX_API_BASE` (default: `http://dev.asinex.com:58181`)
  - Stock API: `ASINEX_STOCK_API_URL` (default: `https://stock.asinex.com:5443/api/Shop`)
  - Docking API: `ASINEX_DOCKING_API_URL` (default: `https://services.asinex.com:8000/docking`)
  - DiffDock API: `DIFFDOCK_API_URL` (default: `https://services.asinex.com:58000/molecular-docking/diffdock/generate`)
  - SDF Converter: `SDF_CONVERTER_URL` (default: `http://83.229.87.94:8001/convertSTR`)
  - Endpoints: `/api/search-asinex`, `/api/docking`, `/api/docking-diffdock`, `/api/convert-sdf`
  - SDK/Client: `axios`, `fetch`
  - Location: `server/index.js` lines 2200–4580

## Data Storage

**Databases:**
- MongoDB 6.17.0
  - Connection: `MONGODB_URI` (e.g., `mongodb://localhost:27017/medsaas`)
  - Client: `mongodb` driver
  - Auth: Optional username/password in connection string
  - Container: `mongo:7` (docker-compose.yml)
  - Collections:
    - `users` — User accounts, credentials, tokens
    - `companies` — Company/tenant data, branding config
    - `audit_logs` — Authentication and admin action audit trail
    - `billing_events` — Stripe payment transaction records
    - `simulation_logs` — Scientific simulation execution history
    - `projects` — User projects and saved analyses
    - `mol_price` — Molecule pricing data (imported via `npm run import:mol-price`)
  - Indexes: username/email (unique), companyId (multi-tenant), stripeSessionId (idempotency)
  - Location: `server/index.js` lines 713–810

**File Storage:**
- Local filesystem only — no S3 or cloud storage
  - Build output: `client/dist/` (Vite build)
  - Server logs: Work directory or `/tmp/` (for DiffDock, GROMACS)
  - No persistent file store configured

**Caching:**
- In-memory rate limiters (custom implementation, no external cache)
  - `authRateLimit` — 30 requests per 15 minutes
  - `publicEmailRateLimit` — 5 requests per 15 minutes
  - `checkoutRateLimit` — 20 requests per 5 minutes
  - Location: `server/index.js` lines 175–193

## Message Queue

**RabbitMQ:**
- Purpose: ADMET prediction task queue (asynchronous job processing)
- Container: `rabbitmq:3-management` (docker-compose.yml)
- Connection: `RABBITMQ_URL` (default: `amqp://localhost:5672`)
- Auth: `RABBITMQ_USERNAME`, `RABBITMQ_PASSWORD` (default: guest/guest)
- Queue: `ADMET_QUEUE_NAME` (default: `admet_processing_queue`)
- Client: `amqplib` (Node.js) + pika (Python worker)
- Endpoints: `/api/admet-predict` (task creation), `/api/admet-queue-status` (status check)
- Location: `server/utils/rabbitMQUtils.js`, `server/index.js` lines 3400–3600
- Python worker: `services/admet/` (Docker, optional)

## Authentication & Identity

**JWT (Session Tokens):**
- Custom JWT implementation using `jsonwebtoken`
- Secret: `JWT_SECRET` (≥32 chars, required)
- Expiration: `JWT_EXPIRES_IN` (default: 7d)
- Token format: Standard JWT, passed in `Authorization: Bearer <token>` header
- Validation: `authenticateToken` middleware on all protected routes
- Roles: owner, admin, member (per company)
- Location: `server/index.js` lines 900–1000

**Password Hashing:**
- bcryptjs 3.0.2 — Hash passwords at signup, invite acceptance, password change
- Policy: `/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]).{8,}$/`
- Requirements: 8+ chars, 1 lowercase, 1 uppercase, 1 digit, 1 special char
- Location: `server/index.js` password validation endpoints

## Billing & Payments

**Stripe:**
- Purpose: Payment processing, checkout sessions, credit purchasing
- SDK: `stripe` 18.3.0
- Secret Key: `STRIPE_SECRET_KEY` (required)
- Publishable Key: `VITE_STRIPE_PUBLISHABLE_KEY` (client build-time)
- Webhook Secret: `STRIPE_WEBHOOK_SECRET` (for verification)
- Webhook Endpoint: `POST /stripe/webhook` (localhost:3000/stripe/webhook)
- Client checkout: `POST /create-checkout-session`, `POST /create-checkout-session-onetime`
- Session retrieval: `GET /checkout-session/:sessionId`
- Event handling:
  - `checkout.session.completed` — Trigger `fulfillCheckoutSession()` to grant credits atomically
  - Idempotency: tracked via `stripeSessionId` index on `billing_events` collection
- Fallback: When `STRIPE_WEBHOOK_SECRET` not configured, webhooks are rejected and credits NOT granted
- Location: `server/index.js` lines 109–135, 1289–1610

## Email

**Titan Mail (SMTP):**
- Purpose: User signup confirmations, password resets, invite emails, contact form replies
- Provider: Titan Mail
- Auth: `EMAIL_USER`, `EMAIL_PASS` environment variables
- Connection: nodemailer via SMTP
- Endpoints:
  - `POST /auth/send-password-reset-email` — Password reset link
  - `POST /auth/send-invite-email` — Company invite to new user
  - `POST /send-email` — Public contact form (fixed recipient)
- HTML templates: `server/utils/emailTemplates.js`
- From address: Uses `EMAIL_USER` or fallback to `PLATFORM_NAME`
- Branding: Dynamic based on company name (or `PLATFORM_NAME` fallback)
- Fixed contact recipient: `CONTACT_RECIPIENT` (env var, defaults to `EMAIL_USER`)
- Location: `server/utils/emailService.js`, `server/index.js` (signup/reset/invite routes)

## Monitoring & Observability

**Error Tracking:**
- Not detected — no external error tracking service (Sentry, etc.)
- Errors logged to console via `console.error()`

**Logs:**
- Console logging (stdout/stderr)
- File logging for DiffDock debug: `logToFile()` in `server/index.js` (location: `diff_dock_debug.log`)
- RabbitMQ connection logs for ADMET task processing
- Audit logs stored in MongoDB `audit_logs` collection

**Health Checks:**
- Endpoint: `GET /health` — Server status
- Database: `GET /health/db` — MongoDB connection test
- RabbitMQ: Logged at startup, health check via `rabbitMQHealthCheck()`
- Scientific services: `GET /api/scientific/platform/health` — GROMACS and Glioblastoma uptime

## CI/CD & Deployment

**Version Control:**
- Git repository (GitHub)
- Branches: main (production), feature branches

**CI Pipeline:**
- GitHub Actions (manual dispatch only)
- Job: `.github/workflows/deploy.yml`
- Trigger: Manual via "Run workflow" (no auto-deploy on push)
- Process:
  1. Checkout code
  2. Create git archive (tracked files only)
  3. SCP archive to deployment host (Oracle VPS)
  4. Extract and run `docker compose -f docker-compose.box.yml up -d --build`
  5. Prune dangling Docker images
- Deployment host is non-public (secrets-managed SSH)

**Containerization:**
- Root `Dockerfile` — Two-stage Bun build for app + client
  - Stage 1 (`frontend`): Build client via Vite
  - Stage 2 (`api`): Install server deps, copy built client, run Bun
  - Base image: `oven/bun:1.3.14-slim`
  - Entrypoint: `bun index.js`
  - Port: 3000
  - Environment: `NODE_ENV=production`, `FRONTEND_DIST=../client/dist`

- Optional science services (docker-compose.yml):
  - `admet-worker` — ADMET prediction (profile: workers)
  - `gromacs-api` — Molecular dynamics (profile: science)
  - `glioblastoma-predictor` — Cancer model prediction (profile: science)
  - Core services (always up):
    - MongoDB 7
    - RabbitMQ 3-management

- Deployment compose file: `docker-compose.box.yml` (referenced in CI, not in repo root)

**No containerization for main app in development** — `docker-compose.yml` contains only MongoDB, RabbitMQ, and optional science services. The Express app runs natively via `bun` or `node --watch`.

## Environment Configuration

**Required Env Vars (Validated at Startup):**
- `MONGODB_URI` — Database connection
- `JWT_SECRET` — Session token key (≥32 chars)
- `STRIPE_SECRET_KEY` — Stripe secret

**Required for Full Operation:**
- `STRIPE_WEBHOOK_SECRET` — Webhook verification (without this, payment webhooks rejected)
- `EMAIL_USER`, `EMAIL_PASS` — Email sending
- `NVIDIA_MOLMIM_API_KEY` — Molecule generation
- `NVIDIA_OPENFOLD_API_KEY` — Protein folding

**Optional/Defaulted:**
- `PORT` (default: 3000)
- `BASE_URL`, `FRONTEND_URL` — Callback URLs
- `PLATFORM_NAME` (default: "MedSaaS")
- `TANIMOTO_API_BASE` (default: `http://151.145.91.17:8000`)
- `ASINEX_*` endpoints (defaults provided)
- `RABBITMQ_URL`, credentials (defaults: localhost, guest/guest)
- `GROMACS_API_BASE`, `GLIOBLASTOMA_API_BASE` (defaults: localhost:8001, :5000)
- `FRONTEND_DIST` — Path to built client (optional; auto-detected)
- `SSL_KEY_PATH`, `SSL_CERT_PATH` — HTTPS certificates

## Webhooks & Callbacks

**Incoming (Server Receives):**
- `POST /stripe/webhook` — Stripe payment events (e.g., `checkout.session.completed`)
  - Signature verification via `stripe.webhooks.constructEventAsync()`
  - Idempotent processing via `billing_events` collection
  - Location: `server/index.js` lines 109–135

- `POST /api/admet-callback` — ADMET worker task completion callback
  - Called by `services/admet/` worker after processing
  - Auth: `ADMET_CALLBACK_SECRET` (env var, shared secret)
  - Payload: Task ID, results, status
  - Returns: Updated simulation record
  - Location: `server/index.js` (ADMET callback route)

**Outgoing (Server Calls):**
- NVIDIA MolMIM API — POST requests for molecule generation
- NVIDIA OpenFold3 API — POST requests for protein structure prediction
- Tanimoto API — GET/POST requests for similarity search
- Asinex APIs — GET/POST requests for ligand search and docking
- DiffDock API — POST requests for molecular docking
- GROMACS API (internal) — GET/POST for MD simulations
- Glioblastoma predictor (internal) — POST for cancer predictions
- RabbitMQ — AMQP messages enqueued to `admet_processing_queue` for ADMET jobs

---

*Integration audit: 2026-06-14*
