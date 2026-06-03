# MedSaaS (unified platform)

Combined monorepo for molecular research SaaS: web app, chemistry API, ADMET worker, GROMACS MD, and glioblastoma prediction. See [REPOS.md](./REPOS.md) for upstream GitHub mapping.

| Path | Purpose |
|------|---------|
| `server/` | API server and production static host |
| `client/` | Vite React dashboard (Material Tailwind) |
| `services/admet/` | RabbitMQ ADMET-AI worker |
| `services/gromacs-api/` | GROMACS REST API |
| `services/glioblastoma-predictor/` | Glioblastoma sensitivity API |
| `packages/dashboard-template/` | Upstream dashboard UI reference |
| `legacy/chem-beo-api/` | Archived standalone Chem API |

Root scripts are the supported way to install, run, build, and check the app.

## Local Setup

1. Install dependencies:

   ```bash
   npm run install:all
   ```

2. Create environment config:

   ```bash
   cp .env.example .env
   ```

3. Start local infrastructure:

   ```bash
   npm run services:up
   ```

4. Run the app in development:

   ```bash
   npm run dev
   ```

   Open **http://localhost:5173** only. Vite proxies `/api`, checkout, and Tanimoto to the API on port 3000 — no `VITE_API_HOSTNAME` needed.

   Set `FRONTEND_URL=http://localhost:5173` in `.env` for verification email links.

   **Branding:** the company name at signup drives the sidebar, emails, and invites. `PLATFORM_NAME` is a fallback only.

5. Build and run the production-style unified app:

   ```bash
   npm start
   ```

   The backend serves `client/dist`.

## Required Runtime Dependencies

- MongoDB, configured with `MONGODB_URI`
- Stripe, configured with `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`
- JWT signing secret, configured with `JWT_SECRET`
- Titan SMTP, configured with `EMAIL_USER` and `EMAIL_PASS`

Optional feature dependencies:

- RabbitMQ for ADMET tasks: `RABBITMQ_URL`, `ADMET_QUEUE_NAME`, `ADMET_CALLBACK_SECRET`
- NVIDIA MolMIM/OpenFold: `NVIDIA_MOLMIM_API_KEY`, `NVIDIA_OPENFOLD_API_KEY`
- External chemistry services: `TANIMOTO_API_BASE`, `ASINEX_API_BASE`, `ASINEX_DOCKING_API_URL`, `DIFFDOCK_API_URL`, `SDF_CONVERTER_URL`
- Integrated microservices: `GROMACS_API_BASE`, `GLIOBLASTOMA_API_BASE`

### Scientific microservices (Docker)

Core infra (Mongo + RabbitMQ):

```bash
npm run services:up
```

Optional GROMACS + glioblastoma APIs:

```bash
npm run services:science
```

ADMET worker (requires `ADMET_CALLBACK_SECRET` in `.env`):

```bash
npm run services:workers
```

All optional services:

```bash
npm run services:all
```

- GROMACS Swagger: `http://localhost:8001/docs`
- Glioblastoma API: `http://localhost:5000/health`
- Dashboard pages: **GROMACS MD**, **Glioblastoma predict**

## Billing Flow

Stripe checkout is created by the backend from a server-side plan catalog. Token credits are granted only from `checkout.session.completed` webhooks. The frontend no longer grants paid credits directly.

For local webhook testing:

```bash
stripe listen --forward-to localhost:3000/stripe/webhook
```

Set the emitted webhook secret as `STRIPE_WEBHOOK_SECRET`.

## Database Collections

The backend initializes indexes for:

- `users`
- `companies`
- `audit_logs`
- `billing_events`

Feature data also uses:

- `simulation_logs`
- `projects`
- `mol_price`

Import molecule pricing data with:

```bash
npm --prefix server run import:mol-price -- /path/to/mol_price.xlsx
```
