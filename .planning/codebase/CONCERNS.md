---
last_mapped_commit: 1a703a98234dd0b9b66866ec31d4d9a1a6455b55
---

# Codebase Concerns

**Analysis Date:** 2026-06-05

## Tech Debt

**Monolithic Express API:**
- Issue: `server/index.js` contains API setup, middleware, route handlers, MongoDB initialization, Stripe webhook fulfillment, Swagger generation, external proxy calls, startup logic, and file logging in one 6,028-line module.
- Files: `server/index.js`
- Impact: Most backend changes touch the same file, increasing merge conflicts and making route-specific review difficult. Security fixes such as auth middleware, tenant checks, and token accounting must be audited manually across unrelated sections.
- Fix approach: Split by domain into route modules under `server/routes/` and middleware/helper modules under `server/middleware/` or `server/utils/`. Keep `server/index.js` as process bootstrap, middleware registration, route mounting, and server startup only.

**Duplicate simulation token accounting:**
- Issue: `GET /api/simulation` and `POST /api/simulation` implement token checks/decrements inline instead of using one shared token-consumption path. The inline logic also contains the `tester123` bypass tracked by `SEC-V2-01`.
- Files: `server/index.js`
- Impact: Billing-sensitive logic has multiple implementations, making it easy for future simulation endpoints to copy the wrong pattern or skip tenant/company usage accounting.
- Fix approach: Move all simulation charging into one middleware/helper, remove route-local decrements, and make cache-hit behavior explicit before charging.

**Runtime/package migration is incomplete at the ops boundary:**
- Issue: Bun is now the default package/runtime path in root and server scripts, but production image and some checks still use Node. `Dockerfile` uses `node:22-alpine`, `npm ci`, and `CMD ["node", "index.js"]`; root `check` and `test:brand` invoke `node`; server `test:stripe`, `test:runtime-smoke`, and `test:runtime-watch` invoke `node`.
- Files: `Dockerfile`, `package.json`, `server/package.json`, `.planning/REQUIREMENTS.md`, `.planning/ROADMAP.md`
- Impact: Phase 7 (`OPS-01` through `OPS-04`) remains the highest-priority migration gap. The app can pass local Bun runtime checks while deploy/test paths still exercise Node semantics.
- Fix approach: Convert the production image to `oven/bun` on arm64, add Bun variants for root check and server tests, and retain a documented Node rollback path as required by `OPS-04`.

**Manual-only deployment workflow:**
- Issue: `.github/workflows/deploy.yml` has the `push` trigger commented out and deploys by archiving source to the Oracle box, then building through `docker compose -f docker-compose.box.yml up -d --build`.
- Files: `.github/workflows/deploy.yml`, `docker-compose.box.yml`, `docker-compose.deploy.yml`
- Impact: Automatic deployment is disabled, and the active deploy path is the build-on-box compose file rather than the GHCR image path. This increases drift between CI, image build expectations, and the running VPS.
- Fix approach: In Phase 7, decide whether build-on-box remains canonical or GHCR becomes canonical, then align Actions, Dockerfile, compose files, and rollback docs around that single path.

**Legacy/template code remains committed beside active code:**
- Issue: Archived and template directories contain full copies of API/UI code that are not part of the active app.
- Files: `legacy/chem-beo-api/index.js`, `legacy/chem-beo-api/utils/`, `packages/dashboard-template/src/`
- Impact: Search results and code reviews include inactive implementations. Future agents can confuse `packages/dashboard-template/src/pages/dashboard/simulation.jsx` with the active `client/src/pages/dashboard/simulation.jsx`.
- Fix approach: Move legacy/template snapshots outside source control or clearly quarantine them with documentation and tooling exclusions.

**Template/demo data and brand remnants still exist:**
- Issue: Brand defaults and some visible strings still use `MedSaaS`; dead-link/template UI remains in auth, pricing, insights, and notifications views.
- Files: `scripts/ensure-dev.mjs`, `server/utils/emailTemplates.js`, `server/utils/emailService.js`, `client/src/config/branding.js`, `client/src/widgets/layout/navbar.jsx`, `client/src/widgets/layout/sidenav.jsx`, `client/src/pages/auth/sign-in.jsx`, `client/src/pages/main/paidplansdescription.jsx`, `client/src/pages/main/insights.jsx`, `client/src/pages/dashboard/notifications.jsx`
- Impact: The project requirement says the product must feel like a professional ChemBench tool, not a rebranded demo. Stale strings and `href="#"` links undermine that standard.
- Fix approach: Centralize platform branding defaults and replace placeholder links with real routes or remove them.

**Relative runtime log path:**
- Issue: DiffDock API logging writes to `diffdock_api.log` relative to the runtime working directory and deletes the file when it exceeds the size threshold.
- Files: `server/index.js`
- Impact: Logs can land in different directories depending on process startup cwd, and deleting the file loses historical diagnostics.
- Fix approach: Configure a log directory through env, write under a known writable path, and rotate rather than unlinking.

## Known Bugs

**Forgot-password flow is a dead link:**
- Symptoms: The sign-in form renders `Forgot password?` as `href="#"` with no route or handler.
- Files: `client/src/pages/auth/sign-in.jsx`, `.planning/REQUIREMENTS.md`
- Trigger: Open the sign-in page and click `Forgot password?`.
- Workaround: None in the UI. This is tracked as `AUTH-V2-01` for a future milestone.

**`tester123` can run simulations without token deduction:**
- Symptoms: The simulation routes skip decrementing `simulationTokens` when the current user document has username `tester123`.
- Files: `server/index.js`, `.planning/REQUIREMENTS.md`, `.planning/STATE.md`
- Trigger: Authenticate as username `tester123`, then run `GET /api/simulation` or `POST /api/simulation`.
- Workaround: Avoid provisioning or exposing a `tester123` account in production until `SEC-V2-01` is fixed.

**Price-range query rejects valid zero values:**
- Symptoms: `/api/molecules/price-range` treats `0` as missing because it checks `if (!minPrice || !maxPrice)`.
- Files: `server/index.js`
- Trigger: Request a price range with `minPrice=0` or `maxPrice=0`.
- Workaround: Use positive non-zero values. Fix by checking `Number.isFinite(minPrice)` and `Number.isFinite(maxPrice)`.

**Stripe webhook configuration fails at runtime rather than startup:**
- Symptoms: Missing or placeholder `STRIPE_WEBHOOK_SECRET` logs a warning at startup and causes webhook requests to return 500.
- Files: `server/index.js`, `server/test/stripe-webhook.test.mjs`
- Trigger: Start the server without a real `STRIPE_WEBHOOK_SECRET`, then receive a Stripe event.
- Workaround: Set `STRIPE_WEBHOOK_SECRET` in production. For stricter behavior, add it to required production env validation.

## Security Considerations

**Public mol-price and molecule catalog endpoints:**
- Risk: Compound/pricing data is reachable without `authenticateToken`.
- Files: `server/index.js`, `.planning/REQUIREMENTS.md`
- Current mitigation: MongoDB connection is required, but no user auth or tenant auth is required for `GET /api/mol-price`, `GET /api/mol-price/count`, `GET /api/mol-price/search`, `GET /api/mol-price/:id`, `GET /api/mol-price-stats`, `GET /api/molecules`, `GET /api/molecules/:asinexId`, `GET /api/molecules/stats`, `GET /api/molecules/search/smiles`, or `GET /api/molecules/price-range`.
- Recommendations: Apply `authenticateToken` and tenant/role policy to all catalog endpoints as tracked by `SEC-V2-02`.

**CORS allows every origin when no origins are configured:**
- Risk: If `BASE_URL` and `FRONTEND_URL` are both unset, the CORS callback allows any origin because `allowedOrigins.size === 0` passes.
- Files: `server/index.js`, `.planning/REQUIREMENTS.md`
- Current mitigation: Configured deployments can set `BASE_URL` or `FRONTEND_URL`.
- Recommendations: Fail closed when the allowlist is empty in production; keep localhost/dev allowances explicit. This is tracked as `SEC-V2-03`.

**Missing Helmet-grade security headers:**
- Risk: The server sets `X-Content-Type-Options`, `X-Frame-Options`, and `Referrer-Policy`, but does not configure CSP, HSTS, Permissions-Policy, or other Helmet defaults.
- Files: `server/index.js`, `.planning/REQUIREMENTS.md`
- Current mitigation: A small custom header middleware exists.
- Recommendations: Add and configure `helmet` with CSP exceptions for same-origin Ketcher/Molstar iframes. This is tracked as `SEC-V2-04`.

**JWTs and simulation/viewer payloads are stored in browser localStorage:**
- Risk: Any XSS can read `access_token`, `auth_token`, `user_info`, molecule cart data, Molstar URLs, DiffDock payloads, and simulation metadata from localStorage.
- Files: `client/src/context/auth.jsx`, `client/src/utils/constants.js`, `client/src/pages/dashboard/simulation.jsx`, `client/src/pages/dashboard/molstar3d.jsx`, `client/src/pages/dashboard/moleculeviewer.jsx`, `client/src/widgets/layout/dashboard-navbar.jsx`
- Current mitigation: Tokens expire server-side according to JWT settings, and logout clears known keys.
- Recommendations: Prefer httpOnly cookies for auth. Reduce localStorage to non-sensitive UI state, and avoid storing raw simulation artifacts when session memory or server-backed lookups are sufficient.

**Token validation endpoint is unauthenticated and not rate-limited:**
- Risk: `/api/validate-token` performs JWT verification and user/company lookup without `authRateLimit`.
- Files: `server/index.js`
- Current mitigation: A valid bearer token is required to return `valid: true`.
- Recommendations: Add rate limiting, normalize error messages, and treat token validation as authenticated session introspection rather than a public oracle.

**Public email-sending endpoint can send through platform SMTP:**
- Risk: `/api/send-email` accepts recipient, subject, and body from unauthenticated callers, protected only by IP rate limiting.
- Files: `server/index.js`, `server/utils/emailService.js`
- Current mitigation: `publicEmailRateLimit` limits request frequency.
- Recommendations: Require auth or restrict recipients to controlled contact destinations. Never allow arbitrary recipient submission from a public endpoint.

**Raw user input is used as MongoDB regex:**
- Risk: Search parameters are passed into `$regex` without escaping, allowing expensive patterns and broad collection scans.
- Files: `server/index.js`
- Current mitigation: None detected.
- Recommendations: Escape regex metacharacters, cap search lengths, prefer anchored/index-backed search where possible, or move to text indexes/search service.

**Client-side IP/geolocation calls cross privacy and trust boundaries:**
- Risk: Browser calls to third-party IP/geolocation services expose user metadata and produce client-controlled data that should not be trusted for audit/security decisions.
- Files: `client/src/pages/dashboard/simulation.jsx`, `client/src/utils/algo/algo.jsx`
- Current mitigation: Failures fall back silently.
- Recommendations: Use server-observed `req.ip` for audit logging and move geo/currency decisions behind explicit product requirements and consent handling.

**Hardcoded plain-HTTP service fallbacks:**
- Risk: External service defaults include raw IP HTTP URLs for Tanimoto and SDF conversion, so under-configured deployments can send data to mutable IP endpoints over plaintext.
- Files: `server/index.js`
- Current mitigation: Env vars can override the defaults.
- Recommendations: Require explicit production URLs, prefer HTTPS, and fail startup when required scientific service endpoints are missing in production.

## Performance Bottlenecks

**Unbounded custom in-memory rate limiter:**
- Problem: Each limiter stores entries in a module-local `Map` and never removes inactive IP keys.
- Files: `server/index.js`
- Cause: `createRateLimiter` resets counters for existing keys but does not prune expired records.
- Improvement path: Use `express-rate-limit` with pruning or an external Redis/Mongo store; required if the app scales beyond one process.

**Simulation log queries lack matching indexes:**
- Problem: Simulation cache lookups and listing queries operate on `simulation_logs`, but startup index creation covers `users`, `companies`, `audit_logs`, and `billing_events` only.
- Files: `server/index.js`
- Cause: `simulation_logs` indexes are not created in the database initialization block.
- Improvement path: Add compound indexes such as `{ companyId: 1, timestamp: -1 }`, `{ username: 1, timestamp: -1 }`, and a cache-key index on tenant plus `pdbid`/`smiles`.

**Mol-price/molecules searches can full-scan large collections:**
- Problem: Catalog endpoints combine count, unanchored case-insensitive regex, skip pagination, and multi-field `$or` filters.
- Files: `server/index.js`
- Cause: Regex search across `ASINEX_ID`, `IUPAC_NAME`, `SMILES_STRING`, `INCHI`, `INCHIKEY`, and `BRUTTO_FORMULA` is not index-friendly.
- Improvement path: Add text/search indexes, switch to cursor/range pagination for deep pages, cap limits, and escape search input.

**Outbound scientific API calls often lack timeouts:**
- Problem: Several `axios` calls and `fetch` calls to NVIDIA, Tanimoto, docking, Asinex, PubChem/RCSB, and other external scientific services do not consistently set request timeouts.
- Files: `server/index.js`, `client/src/pages/dashboard/moleculeviewer.jsx`, `client/src/pages/dashboard/molstar3d.jsx`, `client/src/pages/dashboard/simulation.jsx`
- Cause: Calls are made inline in route handlers/components without shared HTTP client defaults.
- Improvement path: Centralize outbound clients with explicit timeout, retry, and error mapping. Use longer timeouts only for queued/background jobs.

**Large frontend page components increase bundle and maintenance cost:**
- Problem: Several dashboard pages are large single-file components.
- Files: `client/src/pages/dashboard/simulation.jsx`, `client/src/pages/dashboard/molstar3d.jsx`, `client/src/pages/dashboard/controlpanel.jsx`, `client/src/pages/dashboard/company-admin.jsx`
- Cause: Data fetching, localStorage orchestration, rendering, molecule preview logic, and workflow state are all embedded in page files.
- Improvement path: Extract domain hooks/components and add route-level lazy loading for heavy molecule/visualization views.

## Fragile Areas

**Phase 7 Docker/CI/CD rollout:**
- Files: `Dockerfile`, `.github/workflows/deploy.yml`, `docker-compose.box.yml`, `docker-compose.deploy.yml`, `package.json`, `server/package.json`, `.planning/ROADMAP.md`
- Why fragile: Current Docker and CI deploy paths are not yet aligned with the Bun default runtime. The root repo also carries both `bun.lock` and npm lockfiles, so install behavior must stay intentionally dual-path.
- Safe modification: Change one operational layer at a time: Dockerfile first, then Actions script runner, then check/test scripts. Preserve `*:node` scripts and document a one-line rollback as required by `OPS-04`.
- Test coverage: Existing runtime smoke tests live in `server/test/runtime-smoke.test.mjs`, `server/test/runtime-watch-smoke.mjs`, and `server/test/stripe-webhook.test.mjs`, but Phase 7 needs them runnable through Bun.

**Simulation and billing enforcement:**
- Files: `server/index.js`, `server/test/runtime-smoke.test.mjs`
- Why fragile: Token deduction, company monthly caps, cache hits, audit events, and external docking calls are interleaved inside route handlers.
- Safe modification: Add characterization tests before changing token logic. Verify cache-hit requests do not charge, new simulation requests charge exactly once, disabled users/companies fail, and `tester123` is not special.
- Test coverage: Smoke coverage exercises one token-consuming simulation path, but there is no focused unit/integration coverage for both GET and POST charging semantics.

**Tenant-sensitive database access:**
- Files: `server/index.js`
- Why fragile: Some routes use `buildTenantFilter(req.user)` and authenticated middleware, while public mol-price/molecules routes do not. Full decoded JWT payloads are also stored in `simulation_logs`.
- Safe modification: Add a route inventory for auth/tenant requirements, then apply middleware consistently. Store minimal audit fields instead of entire JWT payloads.
- Test coverage: No detected automated test asserts that catalog endpoints require auth or that tenant data cannot cross companies.

**RabbitMQ ADMET workflow:**
- Files: `server/utils/rabbitMQUtils.js`, `server/index.js`, `services/admet/amqpadmet.py`, `services/admet/admet_sender.py`, `docker-compose.yml`
- Why fragile: Queue setup falls back to a timestamped queue name when declaration conflicts, publish success is treated as job creation, and there is no visible dead-letter/retry contract.
- Safe modification: Define queue topology in one place with DLQ/retry settings, fail loudly on unexpected queue declarations, and persist ADMET job state separate from publish acknowledgement.
- Test coverage: No detected automated test covers ADMET queue publish, worker failure, callback auth, or retry behavior.

**Environment loading and validation:**
- Files: `server/index.js`, `.env.example`, `services/gromacs-api/env.example`, `services/admet/.env.example`
- Why fragile: The server loads dotenv in multiple ways and only some operational secrets are required at startup. Different cwd values or pre-set env vars can change which file wins.
- Safe modification: Centralize config parsing in one module, validate production-required vars by environment, and avoid reading any secret file contents in docs or tooling.
- Test coverage: Runtime smoke tests cover selected env cases, but no dedicated config validation suite was detected.

**Generated/vendor static assets in public tree:**
- Files: `client/public/ketcher/static/js/`, `client/public/ketcher/static/css/`, `client/public/ketcher/iframe.html`
- Why fragile: Large bundled assets are committed directly and embedded by the app. Updating Ketcher can affect CSP, iframe behavior, and bundle size without normal source-level review.
- Safe modification: Treat Ketcher as a vendored asset with an update checklist. Verify iframe loading and CSP whenever security headers change.
- Test coverage: No detected browser/E2E test validates Ketcher iframe loading after header or asset changes.

## Scaling Limits

**Single-process in-memory controls:**
- Current capacity: One API process enforces local rate limits and holds runtime limiter state in memory.
- Limit: Running multiple API processes or replicas makes rate limits N-times more permissive and loses shared state.
- Scaling path: Move rate limiting and session/security counters to Redis or MongoDB-backed stores.

**MongoDB client defaults:**
- Current capacity: `new MongoClient(uri)` uses driver defaults.
- Limit: Pool size, server selection timeout, and retry behavior are not tuned for production traffic or Oracle VPS constraints.
- Scaling path: Configure `maxPoolSize`, `minPoolSize`, `serverSelectionTimeoutMS`, and monitoring appropriate to the deployment.

**Scientific jobs run through request/response paths:**
- Current capacity: Some heavy operations are invoked directly by Express handlers or frontend calls.
- Limit: Long external calls can tie user requests to upstream service latency and make retries/token accounting hard.
- Scaling path: Queue long-running docking, ADMET, GROMACS, and prediction jobs with durable status records and polling/websocket updates.

## Dependencies at Risk

**`xlsx`:**
- Risk: `xlsx` is pinned at the long-stale `^0.18.5` package line for the import script.
- Impact: Import tooling carries dependency risk even if it is not part of hot production routes.
- Migration plan: Replace import parsing with `exceljs`, a maintained SheetJS-compatible fork, or a CSV-based import path.

**Vite 4 / older frontend toolchain:**
- Risk: The client retains Vite 4.5.0 and older UI/chart packages while Bun is only the package runner.
- Impact: Phase 6 intentionally deferred bundler changes, so client build risks remain separate from the server runtime migration.
- Migration plan: Keep Vite for v2 as planned; audit and upgrade frontend dependencies in a later milestone with visual regression checks.

**Vendored Ketcher bundle:**
- Risk: Ketcher static JS/CSS is committed under public assets rather than imported through the normal build graph.
- Impact: Security scanning, dependency updates, and CSP work need manual review.
- Migration plan: Track the source/version of the vendored bundle and add a repeatable update procedure.

## Missing Critical Features

**Password reset:**
- Problem: Forgot-password UI exists but has no implementation.
- Blocks: Users cannot recover accounts through self-service.

**Bun-powered production ops:**
- Problem: Phase 7 is not started; Docker, Actions, and check/test scripts have not all moved to Bun.
- Blocks: Completing v2 Bun Migration requirements `OPS-01`, `OPS-02`, `OPS-03`, and `OPS-04`.

**Security hardening backlog from v2 planning:**
- Problem: `SEC-V2-01` through `SEC-V2-04` are tracked future items and remain open.
- Blocks: Production-hardening work around token bypass removal, public catalog auth, fail-secure CORS, and Helmet headers.

## Test Coverage Gaps

**Auth/security route policy:**
- What's not tested: Public/private route inventory, mol-price/molecules auth requirements, CORS fail-secure behavior, `/api/send-email` auth policy, and `/api/validate-token` rate limiting.
- Files: `server/index.js`, `server/test/`
- Risk: Security regressions can ship as route-level middleware omissions.
- Priority: High

**Simulation token accounting:**
- What's not tested: GET vs POST charging parity, no `tester123` bypass, cache-hit no-charge behavior, company monthly cap enforcement, disabled user/company blocks.
- Files: `server/index.js`, `server/test/runtime-smoke.test.mjs`
- Risk: Billing and usage enforcement can be bypassed or double-charged.
- Priority: High

**Phase 7 Bun ops checks:**
- What's not tested: Production Dockerfile under `oven/bun`, Bun-running root `check`, Bun-running brand check, Bun-running Stripe/runtime smoke tests, and rollback path.
- Files: `Dockerfile`, `.github/workflows/deploy.yml`, `package.json`, `server/package.json`, `server/test/`
- Risk: v2 can appear complete locally while deploy/runtime scripts still depend on Node.
- Priority: High

**ADMET async workflow:**
- What's not tested: RabbitMQ publish failure, queue declaration conflicts, callback authentication, worker failures, retry/dead-letter behavior, and simulation log updates from callbacks.
- Files: `server/utils/rabbitMQUtils.js`, `server/index.js`, `services/admet/`
- Risk: ADMET jobs can be lost or marked successful based only on publish acknowledgement.
- Priority: Medium

**Frontend heavy workflows:**
- What's not tested: Ketcher/Molstar iframe loading, localStorage state handoff between simulation and viewer pages, password reset link behavior, and large dashboard route flows.
- Files: `client/src/pages/dashboard/simulation.jsx`, `client/src/pages/dashboard/molstar3d.jsx`, `client/src/pages/dashboard/moleculeviewer.jsx`, `client/src/pages/auth/sign-in.jsx`, `client/public/ketcher/`
- Risk: Security header changes, route changes, and refactors can break core lab workflows without automated detection.
- Priority: Medium

---

*Concerns audit: 2026-06-05*
