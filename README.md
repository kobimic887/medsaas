# Pyxis Discovery (unified platform)

Combined monorepo for the Pyxis Discovery molecular research platform: web app,
chemistry API, ADMET worker, GROMACS MD, and glioblastoma prediction. See
[REPOS.md](./REPOS.md) for upstream GitHub mapping.

> **"medsaas" is the repository name, not the product.** The product is Pyxis
> Discovery, and it serves one company. The old *MedSaaS* and *ChemBench* names are
> retired in all user-facing surfaces — `bun run test:brand` fails the build if either
> reappears in `client/src`, `client/index.html`, `client/public` or `server`.
> Package identities, the published MCP server name and this repo's own name are
> deliberately exempt.

**Where this actually runs (measure DNS):** `app.pyxis-discovery.com` → **`84.13.81.51`**
(`oracleNew`). Public product is this repo (`pyxis-web` / `client/dist`) on **`:5174`**
(nginx `:443` → `127.0.0.1:5174`, soft flip 2026-08-23). Legacy Vite `:5173` → `chem_beo`
`:3000` is **rollback only**. Shared MongoDB Atlas. **Not** deployed by CI or Docker.
`83.229.87.94` is **imminent shutdown** — not the live DNS target. Start at
[docs/POST-PROMOTION-HANDOFF.md](./docs/POST-PROMOTION-HANDOFF.md); never modify nginx, TLS,
DNS or firewall without explicit owner approval.

| Path | Purpose |
|------|---------|
| `server/` | API server and production static host |
| `client/` | Vite React dashboard (Material Tailwind) |
| `services/admet/` | RabbitMQ ADMET-AI worker |
| `services/gromacs-api/` | GROMACS REST API |
| `services/glioblastoma-predictor/` | Glioblastoma sensitivity API |
| `services/mcp-server/` | MCP server exposing the platform's tools to Claude for Life Sciences |

Root scripts are the supported way to install, run, build, and check the app.
Bun is the default package runner for install, dev, build, and start. npm/Node
fallback aliases are retained for rollback.

## Working on this from another machine

Everything needed is in git — including the vendored 3Dmol build under
`client/public/3dmol`. A clone plus the steps below is a complete working setup. You do
**not** need access to production, the GPU box, or the Amsterdam machine to develop.

```bash
git clone https://github.com/kobimic887/medsaas.git && cd medsaas
bun run install:all
cp .env.example .env
```

Then set the three variables the server refuses to start without —
`MONGODB_URI`, `JWT_SECRET`, `STRIPE_SECRET_KEY`:

- `MONGODB_URI` — **already correct in `.env.example`** (`mongodb://localhost:27017/medsaas`).
  Leave it pointing at localhost. Start a database with `npm run services:up` (Docker), or
  install MongoDB natively, whichever you have.
- `JWT_SECRET` — must be at least 32 characters. Generate one:
  ```bash
  node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
  ```
- `STRIPE_SECRET_KEY` — any `sk_test_…` key. Startup only checks that it is set; nothing
  charges a card in development.

> ### ⚠ Do not point a development machine at production
>
> `.env` is gitignored, so a fresh clone gets the safe localhost default above — but do not
> copy a production `.env` onto a laptop to "save time". Production is **MongoDB Atlas**,
> and this repo's sign-up creates a company and an owner on whatever database it is pointed
> at. That has already happened once: the `kobokon` owner account and the `kobi inc` company
> in production were created 332 ms apart by a single sign-up on 2026-05-16, months before
> this repo served production at all. Development wrote straight into the live database.
>
> Atlas also allowlists by IP, so a new machine will fail with a TLS alert 80 rather than a
> clear error. That is the allowlist, not a broken checkout.

**No Docker and no MongoDB?** You can still run the whole test suite, including the smoke
test that boots the real server — `server/test/runtime-smoke.test.mjs` starts its own
in-memory MongoDB:

```bash
bun run ci
```

**What works without any upstream credentials:** the frontend, sign-up and sign-in, the
dashboard, the molecule viewer, and the full test gate. **What needs credentials or an
upstream host:** docking and the compound catalog (Asinex), molecule generation and protein
folding (NVIDIA API keys), and Tanimoto search (points at the Oracle host by default).
Those fail with upstream errors rather than breaking the app.

## Local Setup

1. Install dependencies:

   ```bash
   bun run install:all
   ```

   npm fallback:

   ```bash
   npm run install:all:node
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
   bun run dev
   ```

   npm/Node fallback:

   ```bash
   npm run dev:node
   ```

   Open **http://localhost:5173** only. Vite proxies `/api`, checkout, and Tanimoto to the API on port 3000 — no `VITE_API_HOSTNAME` needed.

   Set `FRONTEND_URL=http://localhost:5173` in `.env` for verification email links.

   **Branding:** the company name at signup drives the sidebar, emails, and invites. `PLATFORM_NAME` is a fallback only.

5. Build and run the production-style unified app:

   ```bash
   bun run build
   bun run start
   ```

   npm/Node fallback:

   ```bash
   npm run build:node
   npm run start:node
   ```

   The backend serves `client/dist`.

### Bun package management and Node rollback

**Gate result: PASS — Bun is the confirmed default runtime.**

Measured Bun median idle RSS: 115.1 MiB, below the locked Node Phase 4 baseline of 118.9 MiB
(the D-06 gate threshold), so Bun stays the default. Note: on the same oracle host a back-to-back
Node sanity run measured 115.5 MiB — Bun and Node are at parity within noise, not a memory win;
Bun passes the gate against the fixed Phase 4 baseline.
The full per-sample distributions, the back-to-back Node sanity run, and methodology
(N=5, `/proc/<pid>/status` VmRSS, oracle aarch64 host) were captured during the Bun migration.

Phase 6 makes Bun the default package runner. Phase 5 already made Bun the default API runtime.
Vite remains the client bundler: `bun run build` invokes `bun --cwd=client run build`, which runs
the existing `vite build` script in `client/package.json`.

- `bun run install:all` installs root, client, and server dependencies with Bun.
- `bun run dev` starts the API with `bun --watch index.js` and the Vite client unchanged.
- `bun run build` runs the retained Vite production build through Bun's package runner.
- `bun run start` builds the client, then runs `FRONTEND_DIST=../client/dist bun index.js`.

Docker, CI, `check`, and test scripts now use the Bun-default paths, with
Node fallback scripts retained where runtime parity matters.

**Bun commands (default):**

```bash
# Install all package roots
bun run install:all

# Development: Bun API runtime + Vite client
bun run dev

# Build retained Vite frontend
bun run build

# Production-style unified server
bun run start
```

**npm/Node fallback (one-command):**

```bash
# Install all package roots with npm ci
npm run install:all:node

# Development with Node API runtime + Vite client
npm run dev:node

# Build retained Vite frontend through npm
npm run build:node

# Production-style unified server on Node
npm run start:node
```

**Lockfile maintenance:** root, `client/`, and `server/` each retain both lockfile
families. `bun.lock` is the default Bun install artifact; `package-lock.json` is retained
for exact npm fallback installs. When any dependency changes, run:

```bash
bun run lockfiles:refresh
```

Commit the regenerated Bun and npm lockfiles together so the default and fallback package
graphs do not drift.

## CI/CD

Use `.github/workflows/ci.yml` as the PR and `main` quality gate. It runs both
the Bun default path and the Node fallback path. Use `.github/workflows/deploy.yml`
only after `main` is green; it is a manual non-prod deploy that reuses the CI gate,
ships a source archive to the Oracle VPS, and builds the Docker image there.

**`deploy.yml` does not reach production.** It is `workflow_dispatch`-only and points
at a non-production Oracle path. Live deploys are manual to **`84`**: refresh
`/root/pyxis-new-standby-5174` via `git archive` / `tar`, then `systemctl restart pyxis-web`
— see [docs/NEXT-SESSION.md](./docs/NEXT-SESSION.md). Do not deploy new work to the rollback
trees.
Pushing runs CI and deploys nothing.

The current deploy does not use GitHub Packages/GHCR. See
[docs/CI-CD.md](./docs/CI-CD.md) for the workflow order and deploy model.

## Required Runtime Dependencies

- MongoDB, configured with `MONGODB_URI`
- Stripe, configured with `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`
- JWT signing secret, configured with `JWT_SECRET`
- SMTP, configured with `EMAIL_HOST`, `EMAIL_PORT`, `EMAIL_USER` and `EMAIL_PASS`.
  The live provider is `server028.yourhosting.nl:587`, **not Titan** — Titan rejects
  these credentials with `535` on both 465 and 587. Host and port used to be
  hardcoded, which is why the marketing contact form had never sent a message.

Optional feature dependencies:

- RabbitMQ for ADMET tasks: `RABBITMQ_URL`, `ADMET_QUEUE_NAME`, `ADMET_CALLBACK_SECRET`
- NVIDIA MolMIM/OpenFold: `NVIDIA_MOLMIM_API_KEY`, `NVIDIA_OPENFOLD_API_KEY`
- External chemistry services: `TANIMOTO_API_BASE`, `SDF_CONVERTER_URL`
- Ligand catalog/stock/docking endpoints: `ASINEX_API_BASE`, `ASINEX_STOCK_API_URL`, `ASINEX_DOCKING_API_URL`, `DIFFDOCK_API_URL` seed the default config; each company can override them per-company from the Company Admin panel (stored in the `companies` collection)
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
