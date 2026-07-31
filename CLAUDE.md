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

- **Milestone history (reference):** v1 ChemBench Cleanup · v2 Bun Migration — incl. **Phase 7 (Docker, CI/CD, Scripts), shipped 2026-06-05** · v3 Company Brand Colour (per-company logo-driven palette across dashboard + emails), complete.
- **CI now gates deploys:** `.github/workflows/ci.yml` runs Bun and Node fallback checks on push/PR, and `deploy.yml` won't ship unless the reusable CI gate passes (`needs: test`).
- **Always `git push` after committing. Don't ask.** Owner's standing instruction, 2026-07-30 — *"push it all, always."* A push is safe: `deploy.yml` is **manual-only** (its `push:` trigger is commented out, only `workflow_dispatch` remains) **and it points at the wrong place anyway** — the Oracle VPS, which is not production. So a push runs `ci.yml` and deploys nothing. **Production on 83 is not deployed by CI at all:** it ships by `git archive HEAD | ssh … tar -x -C /root/pyxis` plus `systemctl restart pyxis-web`. Pushing does not reach production, and reaching production does not require pushing.
- **⚠ `bun run ci` locally is weaker than CI.** The runtime smoke test spawns the server with the repo's `.env` visible, so a dev machine supplies `FRONTEND_URL`/`BASE_URL` that CI does not have — and an **empty CORS allowlist outside production deliberately reflects any origin**. Test 5e therefore passed locally and failed on GitHub. The test now sets both vars itself so it always exercises the shipping path; if you add a test that depends on configuration, set it in `childEnvFinal` rather than relying on `.env`.
- **CI/CD source of truth:** repo-owned workflows are only `.github/workflows/ci.yml` and `.github/workflows/deploy.yml`. Dynamic GitHub Actions entries such as CodeQL, Dependency Graph, Copilot, Claude, and Codex come from GitHub settings/integrations. Current deploy builds on the box from `docker-compose.box.yml`; GHCR/GitHub Packages is legacy and unused. See `docs/CI-CD.md`.
- **Production was inventoried 2026-07-28** — `docs/PRODUCTION-83-INVENTORY.md`. It is not what the older docs assumed: Mongo is **Atlas** (not on 83), the frontend is a **Vite dev server**, the API is a second HTTPS server on `:3000` bypassing nginx, everything is hand-started in shells, and **49 of 50 users lack `companyId`** — a cutover blocker needing a data migration. The docking output contract is captured in `docs/DOCKING-CONTRACT.md`. Read both before planning any deploy.
- **Planned: COMPUTE moves to a dedicated GPU box** (Amsterdam, x86_64) — **not the backend, and not the database.** `docs/COMPUTE-BOX-MIGRATION.md` is the full trace of every machine, API, and compute dependency, plus the CUDA matrix and storage layout — **but its plan and sequencing are superseded** by `docs/BOX-ARCHITECTURE.md`; it predates the production inventory and assumes the whole backend and database move. Read it for the dependency trace, not the plan. Nothing is applied yet.
- **Why the box exists: Asinex's servers are in Moscow and go down because of the war.** Not performance, not cost, not self-reliance. Both docking engines are answered from there today, so when it's down the product can't dock. `docs/BOX-SPEC.md` records the machine and the reasoning: **RECT WS-3229C, 2× RTX 5090, Threadripper PRO 9975WX 32C, 128 GB, RAID 1 boot pair, €24,727 net.** It supersedes the hardware spec and science-stack scope in the migration doc — the "2× RTX PRO 5000 / 9980X 64C" config is dead.
- **Docking goes on the box FIRST and ALONE — but the box is a real upgrade for the rest too.** Folding (`/api/openfold3/predict`) and molecule generation (`/api/generate-molecules`) **stay on NVIDIA's hosted NIM permanently** — the only two endpoints calling `health.api.nvidia.com`. No MSA pipeline, no ColabFold databases, no OSS OpenFold3, no MolMIM replacement. Everything else **does** move and **does** get materially better: Tanimoto leaves an **arm64 Ampere VPS** for 32 x86_64 cores; GROMACS leaves a **CPU-only apt build** for a CUDA one; ADMET and glioblastoma have **never been deployed at all** (every ADMET job ever queued is still `status: "queued"`). The purchase rule "nothing that only benefits incidentally gets a euro" (`docs/BOX-SPEC.md`) governed **component selection, which is closed** — it does not mean those workloads get ignored. It forbids exactly one thing: spending more money, or delaying the docking cutover, for their sake. Docking = Phase 2; the rest = Phase 6, after.
- **DiffDock is Asinex's, not NVIDIA's.** `diffdockApiUrl` points at `services.asinex.com:58000` — Asinex running NVIDIA's DiffDock NIM container on their own Moscow hardware. It dies with Asinex and must be rebuilt from OSS DiffDock (NVAIE was refused; NIM isn't supported on GeForce). The 1-click `/api/simulation` engine is **AutoDock**, confirmed by the Asinex/Pyxis CEO. **Catalog and stock stay on Asinex** — the catalog needs their compound file (licensing), and live stock can't be self-hosted at any price.
- **83 runs `chem_beo`** (verified 2026-07-28) — the legacy backend, not this repo. **"The box" always means the new Amsterdam machine, never 83.** **RESOLVED 2026-07-29: the box runs compute only** — docking engines, convertSTR, Tanimoto+Postgres, GROMACS, ADMET, glioblastoma. **No API server, no Mongo.** The API stays on 83 because the box has pick-up warranty (no on-site service in NL, so a fault = 1–3 weeks gone): box dies, docking stops, product survives.
- **SETTLED 2026-07-29 — two releases, and they must not be one day.** `docs/BOX-ARCHITECTURE.md` §2–§3.
  - **Release A, the server swap — ship it BEFORE the box.** This repo's `server/index.js` + `client/dist` take over **port 5173** from the Vite dev server; `chem_beo` on `:3000` stays as rollback. **It has no dependency on the box** (just this repo + Atlas + Asinex) and **needs no nginx change** — nginx already does `proxy_pass → localhost:5173`, and `server/index.js` reads `PORT` (`:5368`) and serves `client/dist` via `express.static` (`:6699`). Cutover = which process owns 5173; rollback = `npm run dev` in `/root/material-tailwind-dashboard-react` (**never delete that dir — it is the rollback, and a different codebase, not an older `client/`**). Runbook Phase 5.
  - **Release B, arrival day — compute only.** Docking/DiffDock/Tanimoto repoint at the box, one setting at a time. Database (Atlas), frontend, nginx, TLS, DNS, Stripe **not touched**. Runbook Phases **1·2·3·4.3·6·7**. **Three databases, three answers — never collapse them:** production Mongo is **Atlas and stays** (4.1/4.2 dead permanently); Oracle's **Postgres is production Tanimoto, only copy, and IS copied to the box** (4.3, `pg_dump` it now — an unauthenticated `DELETE` reaches it); Oracle's **Mongo is discarded, never restored from** (hard rule 4).
  - Which knob cuts docking over depends on which server is live: `ligandServiceConfig` (this repo) or `DOCKING_API_URL` etc. (patched `chem_beo`). Check `ss -ltnp | grep 5173` first.
- **DECIDED 2026-07-29 — 83 reaches the box by public hostname over HTTPS. No VPN, no tunnel.** Services bind `127.0.0.1`; **Caddy on `:443`** holds a Let's Encrypt cert for `BOX_DOMAIN`; the **host firewall admits only 83's IP**. That is a true 1:1 with how Asinex is reached today (`services.asinex.com` over the open internet), so rollback is putting the Asinex hostname back. "WireGuard/Tailscale" was **one comment in `deploy/box/compose.yml` that four docs then cited as settled** — it never was, and it is rejected. ARRIVAL-RUNBOOK Phase 3.1.
- **RETRACTED — `assertConfiguredUrlsArePublic` does NOT make the box cutover harder.** An earlier audit claimed shipping Release A would block the box because the guard rejects private/CGNAT ranges. Wrong twice over: the guard has **one call site** (`server/index.js:1325`, the admin-UI `ligandServiceConfig` path), and the env vars that actually carry the cutover — `TANIMOTO_API_BASE`, `SDF_CONVERTER_URL`, `ASINEX_DOCKING_API_URL`, `DIFFDOCK_API_URL` (`server/index.js:80-88`) — are read straight from `process.env` and **never validated**. With a public hostname it is moot regardless.
- **Release A gates — measured 2026-07-29, most are now DONE.** `docs/NEXT-SESSION.md` §1 has the table. Applied to production: **both migrations** (`migrate-legacy-users.mjs` → 0 users without `companyId`; the new `migrate-legacy-simulation-logs.mjs` → 5 logs backfilled additively, `user.username` left intact so `chem_beo` still reads them). Verified: **route-by-route parity** via `scripts/verify-server-swap-parity.mjs` (17 routes, 4 benign differences), the **rehearsal rig** (bun + `client/dist` on a spare port against real Atlas), and the **rollback** (a second Vite booted from `/root/material-tailwind-dashboard-react`). Rig deleted afterwards; all production ports re-verified. **Still open: rotate `JWT_SECRET`** and apply the `chem_beo` patch.
- **⚠ `chem_beo` signs production JWTs with the literal string `secret`.** `chem_beo:1049` is `jwt.sign({username}, process.env.JWT_SECRET || 'secret')` and its `.env` sets no `JWT_SECRET` — confirmed by forging a working token. **Anyone can impersonate any of the 50 accounts** on an internet-facing API. Release A fixes it by construction (this repo refuses to start without a real ≥32-char secret). `buildTenantFilter` (`server/index.js:1064`) also reads `companyId` from the **JWT payload, not the DB**, so a reused secret keeps legacy tokens (no `companyId`) valid → results invisible + cache miss + double charge. `docs/NEXT-SESSION.md` §0.
- **83 is under systemd now (`deploy/83/systemd/`).** Units for all four services; the three legacy ones enabled-but-not-started so nothing moved, `pyxis-web` (Release A) installed but disabled — **enabling it is the cutover**, and it `Conflicts=` the legacy Vite unit so both can never hold 5173. **A reboot no longer ends production.** ⚠ The rollback command is **`npm run dev-vite-only`**, never `npm run dev` — the latter also starts `stripe-server.cjs`, which already holds `:3001`, and the loser dies on `EADDRINUSE`.
- **A third production process existed and was in no doc: `stripe-server.cjs` on `:3001`.** The legacy Vite server proxies `/api` to it, so it is the marketing site's contact-form backend *and* part of the rollback path — **do not kill it.** It was an open mail relay (unauthenticated `POST /api/send-email` with a caller-chosen recipient, through the company mailbox, reachable over public HTTPS). Hardened 2026-07-29 — `deploy/83/0{1,2,3}-*.py`, all idempotent.
- **Outbound mail: the provider is `server028.yourhosting.nl:587`, NOT Titan.** Titan rejects these credentials with `535` on 465 and 587 alike. `stripe-server.cjs` hardcoded Titan, so **the contact form had never sent a single message**; `server/utils/emailService.js` hardcoded it too and only worked by accident (the real host appeared once in its fallback list). Both now read `EMAIL_HOST`/`EMAIL_PORT`. That rewrite also removed `debug/logger: true`, which was printing the `AUTH PLAIN` line — the mailbox credentials — into the log on every send, and `rejectUnauthorized: false`, which offered them to any MITM.
- **The arrival-day prerequisite exists: `deploy/chem_beo/01-fixes-and-config.patch`.** Written, applies cleanly against `index.js` as deployed, and **verified by running it** against real Atlas on an isolated port (failed dock → 502, balance `99999 → 99999`). It lifts all five Asinex URLs + eight Tanimoto call sites into env vars **defaulting to today's values**, makes the credit charge atomic and refundable, closes the five money/data routes (incl. the open `/api/generate-molecules` that *is* the NVIDIA rate-limit cause, and the credit-minting hole at `chem_beo:3343`), and makes signup produce a usable account. **Not yet applied.** It deliberately leaves ~60 other unauthenticated routes open — see `deploy/chem_beo/README.md`.
- **✅ CORRECTED 2026-07-31 — `ligandServiceConfig` IS live in production, and it is the box cutover.** The old note here said it "ships only with the later release"; that was true before Release A and is not any more. `getRequestLigandServiceConfig()` resolves the company's four URLs on **every** docking request (and runs `assertConfiguredUrlsArePublic` on each), so repointing docking at the box is a settings change with no restart and no redeploy. `PATCH /api/company/ligand-service-config` is owner/admin. **`GET` on the same path is readable by any signed-in member** (four URLs, no credentials) and the Control Panel shows them read-only with a Default/Custom chip per endpoint — so on arrival day anyone can confirm the box is live without admin rights. The `chem_beo` patch's env vars remain the fallback only if production is ever rolled back to `:3000`.
- **Still only in this repo, reaching nobody until the later release:** the NVIDIA key pool / 429 rotation / circuit breaker, `upstreamProxyStatus()` (401→502), tenant isolation, audit logging, rate limiting.
- **DONE 2026-07-29: this is no longer a SaaS.** One product for one company, Pyxis Discovery. **Applied, not planned** — `docs/PYXIS-ONLY.md` has the status table. ⚠ **CORRECTED 2026-07-30 — "de-SaaS" meant BRANDING, not removing signup and billing.** The 2026-07-29 pass read it the other way. **Restored:** the sign-up page (`/auth/sign-up`), the paid-plans page (`/dashboard/paid-plans`), public registration (`ALLOW_PUBLIC_SIGNUP` now defaults **on** — close it deliberately with `=false`), and `/create-checkout-session` back to `requireActiveUser` so a member who sees "Plans & Credits" is not 403'd by it. **Still deleted, and that part was right:** the seven marketing pages (2,440 lines; recover from tag **`saas-surface-v1`**, the only copy of the macrocycle copy). Invites via `POST /api/company/members` still work — they are now an addition to signup, not a replacement. **Unchanged on purpose:** the Stripe webhook, `PLAN_CATALOG`, `consumeSimulationToken`, credits, companies, roles, audit logging, `/api/send-email`, and `/create-checkout-session-onetime` (the compound cart — a live feature, not billing surface). Do not add new tenant-facing or billing features — but do not remove the existing ones either; that is what went wrong here.
  - **The brand guard flipped.** `scripts/check-brand.mjs` (`bun run test:brand`) used to ban "pyxis" — v1 renamed Pyxis→ChemBench. It now bans **ChemBench and MedSaaS**, scans only user-facing source (`client/src`, `client/index.html`, `client/public`, `server`), and exempts `services/mcp-server` (published name), package identities, and `THEME_STORAGE_KEY` (renaming it resets every user's dark-mode preference). Docs are out of scope — naming the old brands is their job.
  - **⚠ This ordering has a cost that is not yet paid.** The owner chose rebrand-**before**-cutover. The Release A evidence measured on 2026-07-29 — route parity, rollback rehearsal — was gathered against the *pre-rebrand* frontend, so **it no longer describes what would ship.** Re-run it before flipping 5173. Related: `scripts/verify-server-swap-parity.mjs:45` reads `/root/pyxis-release-a/.env`, and **that rig was deleted**, so re-verifying means standing it back up first — real work, not a script invocation. Expect **one new intended difference** on top of the known four: the rebranded frontend. `/api/signup` and `/create-checkout-session` are back to legacy-equivalent behaviour as of 2026-07-30, so they are no longer differences.
- **Docs index:** `docs/README.md`. Claude Science / MCP: `docs/CLAUDE-LIFE-SCIENCES.md`.

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
| `83.229.87.94` (shared VPS, nginx + TLS) | **all of production compute today** — inventoried 2026-07-28, see [`docs/PRODUCTION-83-INVENTORY.md`](docs/PRODUCTION-83-INVENTORY.md). nginx proxies `app.pyxis-discovery.com` to a **Vite dev server** on `:5173` (`/root/material-tailwind-dashboard-react`, the Creative Tim template — a different lineage from this repo's `client/`). The API is a **second HTTPS server on `:3000`** (`/root/chem_beo`, 73 routes) that terminates TLS itself and bypasses nginx. All hand-started in foreground shells — **a reboot ends production.** GROMACS runs here in Docker on `:8000`; `/convertSTR` on `:8001` is **down**. Shared with an unrelated project (`app.fin-srv.com` on `:4000`); **do not modify nginx, TLS, DNS, or the firewall there.** |
| **MongoDB Atlas** (`cluster0.asrz0o3…`) | **the production database** — not on 83, not on Oracle. Database name is `test`. 50 users, 1 company, 4 simulation_logs. **49 of 50 users lack `companyId`**, which blocks deploying this repo's server against it until a data migration runs. Recommendation is to keep Atlas and move only compute. |
| Oracle VPS `151.145.91.17` (Ampere arm64) | **half of it is production.** The `medsaas-*` containers that `deploy.yml` ships (app + Mongo + MCP) are genuinely non-prod and discardable. **The tonomitosql stack is not** — `chem_beo` on 83 proxies all eight `/tanimoto/*` routes here, hardcoded, and the Deep Similarity page calls them. Its Postgres is production data; its Mongo is a side-project copy. Ops notes in the separate `~/projects/oracle` repo. |
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
| Tanimoto search | `/tanimoto/v1/*` | **tonomitosql** (`kobimic887/tonomitosql`) — FastAPI + Postgres/RDKit cartridge, via `TANIMOTO_API_BASE`. **This is live production**, served from Oracle; `server/index.js:80` defaults to it and that default is not stale |
| Asinex catalog / stock / docking | `/api/asinex/*`, `/api/shop` | Asinex APIs. **Per-company overridable** via `company.ligandServiceConfig` |
| DiffDock docking | `/api/diffdock/generate` | `DIFFDOCK_API_URL` (Asinex-hosted). `server/diff_dock.sh` is **dead code** — it posts to a `localhost:8000` NIM that has never run |
| SMILES→SDF conversion | used inside `/api/diffdock/generate` | `SDF_CONVERTER_URL` — `83.229.87.94:8001`, and **nothing is listening there.** DiffDock is broken in production today |
| ADMET prediction | RabbitMQ queue | `services/admet/` worker — **not deployed.** The broker does exist: CloudAMQP, configured in the deployed backend's `.env` |
| GROMACS MD | `server/routes/scientificServices.js` | `services/gromacs-api/` — **deployed on `83.229.87.94:8000`** in Docker, healthy. The image in this repo is a CPU-only apt build |
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
