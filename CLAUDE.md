# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> ## ⭐ Read [`GOAL.md`](GOAL.md) first.
>
> It holds the owner's actual objective in their own words, and the two rules that
> repeatedly got broken before it was written down: **don't grow the scope**, and
> **don't remove things users recognise** — fix how a thing works, keep the thing.
> Everything below is detail in service of that file.

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
codebase maps). **That directory is deleted and no longer tracked.** Its full contents are
preserved in git history at the tag **`planning-archive`** — recover any file with
`git show planning-archive:.planning/<file>`, or the whole tree with
`git checkout planning-archive -- .planning`. Do not write new `.planning/` files or
reference `/gsd:*` commands; that workflow is retired.

### Where things stand — 2026-08-01

- **The GPU box is ORDERED (2026-08-01), not delivered.** Nothing on it has been executed —
  do not write about work done *on* it in the past tense. GPUs are **4× RTX PRO 4000**.
- **⚠ Arrival day may be run from a FRESH CLONE on another machine.** Four things it needs are
  **not in git**: the **1.2 GB Tanimoto dump** (the *only* copy of a 2,951,975-molecule index,
  living on the owner's Mac at `~/backups/tanimoto/` — not on 83, not on Oracle in dump form),
  `client/dist` (build it), the `.env` files, and the **DiffDock weights** (124 MB, via
  `deploy/box/diffdock/fetch-weights.sh`). `docs/ARRIVAL-RUNBOOK.md` §1b.
- **Production serves the ORIGINAL Pyxis, deliberately.** Rolled back by the owner
  2026-07-31 and it stays there until the box arrives.

  | Port | Unit | What | Reachable |
  |---|---|---|---|
  | **5173** | `pyxis-vite-legacy` | the original Pyxis (Vite dev) → `chem_beo` on `:3000` | **the public site** |
  | **5174** | `pyxis-web` | this repo (Bun + `client/dist`) → Atlas | loopback only |
  | 3000 | `pyxis-api-legacy` | `chem_beo` | serves 5173 |
  | 3001 | `pyxis-stripe` | `stripe-server.cjs`, contact form | **do not kill it** |

  All four are under systemd (`deploy/83/systemd/`) and enabled, so a reboot no longer ends
  production. `Conflicts=` was **removed** — they are on different ports now.
- **Box day is a PORT SWAP then a settings change**, same day (owner, 2026-08-01):
  `docs/ARRIVAL-RUNBOOK.md` §8 then §9. Give `pyxis-web` `PORT=5173` and delete its
  `BIND_HOST=127.0.0.1`; move the legacy unit to 5174 (`-- --port 5174`). No enable/disable,
  no nginx/TLS/DNS/Stripe change. **Then retire the legacy stack in stages** — 83 is 2 cores
  and **1 GB RAM**, and a Vite dev server is the most expensive process on it. The rollback is
  the code on disk, not the running process.
- **⚠ The largest live exposure: ~60 unauthenticated `chem_beo` routes**, on the public site
  right now. `/api/sanitizedminimalsdf/<key>` returns real customer results with no token;
  `/api/generate-molecules` reaches the NVIDIA key and is the rate-limit cause. The fix —
  `deploy/chem_beo/01-fixes-and-config.patch` — is written, applies cleanly, was verified
  against real Atlas on an isolated port, and is **unapplied**. Its `'secret'` JWT hole is
  separately **closed** (verified by forging a token and getting `403`).
- **The box is COMPUTE ONLY.** Docking, DiffDock, convertSTR, Tanimoto+Postgres, GROMACS,
  ADMET, glioblastoma. **No API server, no Mongo.** The API stays on 83 because the box has
  pick-up warranty (a fault = 1–3 weeks gone): box dies, docking stops, product survives.
  `docs/BOX-ARCHITECTURE.md` is the decision record and supersedes topology everywhere else.
- **The database is MongoDB Atlas and does not move.** The box's docking path never opens a
  Mongo connection, so it needs no allowlist entry to cut docking over — ⚠ **but the ADMET
  worker does** (`deploy/box/compose.yml:186`), so that later step needs the box added to the
  Atlas allowlist first. ⚠ **83 is effectively the only machine allowlisted to reach it** — that is why the server cannot boot from a dev machine
  (Atlas rejects a non-allowlisted IP with TLS alert 80, which looks like a handshake failure,
  not an access error). Rigs that need real data run **on 83**. Nothing on the box opens a
  Mongo connection, so the box never needs an allowlist entry.
- **Why the box exists: Asinex's servers are in Moscow and go down because of the war.** Not
  performance, not cost. Both docking engines are answered from there today. `docs/BOX-SPEC.md`
  has the machine: RECT WS-3229C, **4× RTX PRO 4000** (settled 2026-08-01 — *not* 2× RTX 5090,
  which is dead), Threadripper PRO 9975WX 32C, 128 GB, RAID 1 boot pair.
- **Docking goes on the box FIRST and ALONE — but the box is a real upgrade for the rest too.**
  Folding (`/api/openfold3/predict`) and molecule generation (`/api/generate-molecules`) **stay
  on NVIDIA's hosted NIM permanently** — the only two endpoints calling `health.api.nvidia.com`.
  No MSA pipeline, no ColabFold databases, no OSS OpenFold3, no MolMIM replacement. Everything
  else moves and gets materially better: Tanimoto leaves an **arm64 Ampere VPS** (4 cores /
  24 GB as of 2026-08-01, up from 2/12 — so this gap is narrower than it was) for 32 x86_64
  cores; GROMACS leaves a **CPU-only apt build** for a CUDA one; ADMET and glioblastoma have
  **never been deployed at all**. The purchase rule *"nothing that only benefits incidentally
  gets a euro"* governed **component selection, which is closed** — it forbids spending more
  money or delaying the docking cutover for their sake, nothing else.
- **DiffDock is Asinex's, not NVIDIA's.** `diffdockApiUrl` → `services.asinex.com:58000`:
  Asinex running NVIDIA's DiffDock NIM container on their own Moscow hardware. It dies with
  Asinex and must be rebuilt from **OSS `gcorso/DiffDock` (MIT)**. **NIM is not an option and
  is not to be re-proposed** — it needs NVIDIA AI Enterprise, which the owner declined
  2026-07-31; RTX PRO does not change that. The 1-click `/api/simulation` engine is
  **AutoDock**, confirmed by the Asinex/Pyxis CEO. **Catalog and stock stay on Asinex** — the
  catalog needs their compound file (licensing), and live stock can't be self-hosted.
- **83 reaches the box by public hostname over HTTPS. No VPN, no tunnel.** Services bind
  `127.0.0.1`; **Caddy on `:443`** holds a Let's Encrypt cert; the host firewall admits **only
  83's IP**. A true 1:1 with how Asinex is reached today, so rollback is putting the Asinex
  hostname back. "WireGuard/Tailscale" was **one comment in `deploy/box/compose.yml` that four
  docs then cited as settled** — it never was, and it is rejected.
- **`ligandServiceConfig` is the box cutover.** `getRequestLigandServiceConfig()` resolves the
  company's four URLs on **every** docking request, so repointing docking is a settings change
  with no restart and no redeploy. `PATCH /api/company/ligand-service-config` is owner/admin;
  **`GET` is readable by any signed-in member**, and the Control Panel shows them read-only
  with a Default/Custom chip — so anyone can confirm the box is live without admin rights.
  ⚠ It only exists in **this repo's** server, so §8 must precede §9.
- **`assertConfiguredUrlsArePublic` does NOT make the cutover harder.** One call site
  (`server/index.js:1325`, the admin-UI path). The env vars that carry a cutover —
  `TANIMOTO_API_BASE`, `SDF_CONVERTER_URL`, `ASINEX_DOCKING_API_URL`, `DIFFDOCK_API_URL`
  (`:80-88`) — are read straight from `process.env` and **never validated**. Moot with a public
  hostname regardless. Do not mistake the guard for global.
- **Outbound mail: the provider is `server028.yourhosting.nl:587`, NOT Titan.** Titan rejects
  these credentials with `535` on 465 and 587 alike. Both senders now read `EMAIL_HOST`/
  `EMAIL_PORT`. That rewrite also removed `debug/logger: true`, which printed the `AUTH PLAIN`
  line — the mailbox credentials — into the log on every send, and `rejectUnauthorized: false`,
  which offered them to any MITM. ⚠ **The mail password still needs rotating by the owner** —
  it was served publicly on 2026-07-29 and still authenticates.
- **This is not a SaaS — but "de-SaaS" meant BRANDING, not removing signup and billing.** A
  2026-07-29 pass read it the other way and deleted the sign-up page, the paid-plans page and
  open registration. **All restored**; `ALLOW_PUBLIC_SIGNUP` defaults **on**. Still deleted, and
  correctly: the seven marketing pages (recover from tag **`saas-surface-v1`**, the only copy of
  the macrocycle copy). **Unchanged on purpose:** the Stripe webhook, `PLAN_CATALOG`,
  `consumeSimulationToken`, credits, companies, roles, audit logging, `/api/send-email`, and
  `/create-checkout-session-onetime` (the compound cart — a live feature, not billing surface).
  Do not add new tenant-facing or billing features — but do not remove the existing ones either.
- **The brand guard flipped.** `scripts/check-brand.mjs` (`bun run test:brand`) used to ban
  "pyxis" — v1 renamed Pyxis→ChemBench. It now bans **ChemBench and MedSaaS**, scans only
  user-facing source (`client/src`, `client/index.html`, `client/public`, `server`), and exempts
  `services/mcp-server` (published name), package identities, and `THEME_STORAGE_KEY` (renaming
  it resets every user's dark-mode preference). Docs are out of scope.
- **Always `git push` after committing. Don't ask.** Owner's standing instruction, 2026-07-30 —
  *"push it all, always."* A push is safe: `deploy.yml` is **manual-only** and points at the
  Oracle VPS, which is not production. So a push runs `ci.yml` and deploys nothing. **Production
  on 83 is not deployed by CI at all** — it ships by `git archive HEAD | ssh … tar -x -C
  /root/pyxis` plus the built `client/dist`, then `systemctl restart pyxis-web`. Pushing does
  not reach production, and reaching production does not require pushing.
- **⚠ `bun run ci` locally is weaker than CI.** The runtime smoke test spawns the server with
  the repo's `.env` visible, so a dev machine supplies `FRONTEND_URL`/`BASE_URL` that CI does
  not have — and an **empty CORS allowlist outside production deliberately reflects any
  origin**. Set anything a test depends on in `childEnvFinal`, not `.env`.
- **CI/CD source of truth:** repo-owned workflows are only `.github/workflows/ci.yml` and
  `deploy.yml`. CodeQL, Dependency Graph, Copilot, Claude and Codex entries come from GitHub
  settings/integrations, not this repo. See `docs/CI-CD.md`.
- **Production was inventoried 2026-07-28** — `docs/PRODUCTION-83-INVENTORY.md`, measured over
  SSH. The docking output contract is captured in `docs/DOCKING-CONTRACT.md` — the only ground
  truth that exists. Read both before planning any deploy.
- **Verify by measurement, and read the measurement like it might be lying.** `grep -c` counts
  *lines* and has produced a false "shipped" reading twice here. Confirm a deploy by fetching
  the live URL and matching a string that survives minification.
- **Milestone history (reference):** v1 ChemBench Cleanup · v2 Bun Migration (incl. Phase 7
  Docker/CI-CD/Scripts, shipped 2026-06-05) · v3 Company Brand Colour, complete.
- **Docs index:** `docs/README.md`. Claude Science / MCP: `docs/CLAUDE-LIFE-SCIENCES.md`.
  Archive tags: `docs-archive-2026-08-01`, `planning-archive`, `saas-surface-v1`.

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

# Syntax-check server JS + build client
npm run check

# The full gate — what CI runs. Run this before pushing server changes.
# check + Biome lint + the test suite (asinex, email theming, stripe, branding,
# ssrf, and a runtime smoke test that boots the server against a real Mongo).
bun run ci

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
- `services/mcp-server/` — ChemBench MCP server (Bun + `@modelcontextprotocol/sdk`). Exposes 14 platform tools to **Claude Science** over stateless Streamable HTTP on `:8080/mcp`, proxying to the platform API. See `docs/CLAUDE-LIFE-SCIENCES.md`.

### Where things actually run

| Machine | What it runs |
|---|---|
| `83.229.87.94` (shared VPS, nginx + TLS) | **all of production compute today** — inventoried 2026-07-28, see [`docs/PRODUCTION-83-INVENTORY.md`](docs/PRODUCTION-83-INVENTORY.md). nginx proxies `app.pyxis-discovery.com` to a **Vite dev server** on `:5173` (`/root/material-tailwind-dashboard-react`, the Creative Tim template — a different lineage from this repo's `client/`). The API is a **second HTTPS server on `:3000`** (`/root/chem_beo`, 73 routes) that terminates TLS itself and bypasses nginx. ⚠ That inventory predates systemd: all four services are now under `deploy/83/systemd/` and enabled, so **a reboot no longer ends production**, and this repo's server runs alongside on `:5174`. GROMACS runs here in Docker on `:8000`; `/convertSTR` on `:8001` is **down**. Shared with an unrelated project (`app.fin-srv.com` on `:4000`); **do not modify nginx, TLS, DNS, or the firewall there.** |
| **MongoDB Atlas** (`cluster0.asrz0o3…`) | **the production database** — not on 83, not on Oracle. Database name is `test`. ⚠ **83 is effectively the only machine on its IP allowlist**, which is why the server cannot boot from a dev machine (TLS alert 80 reads as a handshake failure, not an access error). The `companyId` backfill has **been applied** — 0 users remain without one. Atlas stays; only compute moves. |
| Oracle VPS `151.145.91.17` (Ampere arm64, **4 cores / 24 GB** — upgraded 2026-08-01 from 2/12) | **half of it is production.** The `medsaas-*` containers that `deploy.yml` ships (app + Mongo + MCP) are genuinely non-prod and discardable. **The tonomitosql stack is not** — `chem_beo` on 83 proxies all eight `/tanimoto/*` routes here, hardcoded, and the Deep Similarity page calls them. Its Postgres is production data; its Mongo is a side-project copy. Ops notes in the separate `~/projects/oracle` repo. |
| Amsterdam GPU box | **ordered 2026-08-01, not delivered.** **Compute only** — docking, DiffDock, convertSTR, Tanimoto, GROMACS, ADMET, glioblastoma. No API server, no Mongo. `docs/BOX-SPEC.md`, `docs/ARRIVAL-RUNBOOK.md`. |

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
| Tanimoto search | `/tanimoto/v1/*` | **tonomitosql** (`kobimic887/tonomitosql`) — FastAPI + Postgres/RDKit cartridge, via `TANIMOTO_API_BASE`. **This is live production**, served from Oracle; `server/index.js:80` defaults to it and that default is not stale |
| Asinex catalog / stock / docking | `/api/asinex/*`, `/api/shop` | Asinex APIs. **Per-company overridable** via `company.ligandServiceConfig` |
| DiffDock docking | `/api/diffdock/generate` | `DIFFDOCK_API_URL` (Asinex-hosted). `server/diff_dock.sh` is **dead code** — it posts to a `localhost:8000` NIM that has never run |
| SMILES→SDF conversion | used inside `/api/diffdock/generate` | `SDF_CONVERTER_URL` — `83.229.87.94:8001`, and **nothing is listening there.** DiffDock is broken in production today |
| ADMET prediction | RabbitMQ queue | `services/admet/` worker — **not deployed.** The broker does exist: CloudAMQP, configured in the deployed backend's `.env` |
| GROMACS MD | `server/routes/scientificServices.js` | `services/gromacs-api/` — **deployed on `83.229.87.94:8000`** in Docker, healthy. The image in this repo is a CPU-only apt build |
| Glioblastoma | `server/routes/scientificServices.js` | `services/glioblastoma-predictor/` — **not currently deployed anywhere** |

No code in this repo performs an MSA, a fold, or a local dock — folding and generation are
thin proxies to NVIDIA's hosted endpoints, and they stay that way permanently. See
`docs/BOX-SPEC.md` §4.

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
