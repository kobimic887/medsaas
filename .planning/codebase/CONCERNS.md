# Codebase Concerns

_Generated: 2026-06-03_

---

## Critical Issues

**Hardcoded test bypass — `tester123` skips token deduction in two simulation routes**
- `server/index.js` lines 2406 and 2553 contain `if (userDoc.username !== "tester123")` guards that prevent token deduction.
- These are inline special-cases in the GET `/api/simulation` and POST `/api/simulation` handlers — NOT inside the reusable `consumeSimulationToken` middleware.
- Impact: Anyone who registers the username `tester123` (or whoever holds that account) can run unlimited docking simulations without consuming tokens, bypassing billing entirely.
- Fix: Remove both guards and use the `consumeSimulationToken` middleware consistently, or at minimum move any tester bypass to a clearly flagged env-var-controlled feature flag.

**Unauthenticated molecular database endpoints**
- `GET /api/mol-price`, `GET /api/mol-price/count`, `GET /api/mol-price/search`, `GET /api/mol-price/:id`, `GET /api/mol-price-stats` (`server/index.js` lines 2009–2310) have no `authenticateToken` middleware.
- `GET /api/molecules`, `GET /api/molecules/:asinexId`, `GET /api/molecules/stats`, `GET /api/molecules/search/smiles`, `GET /api/molecules/price-range` (`server/index.js` lines 5072–5300) are also unauthenticated.
- Impact: The full compound pricing database is publicly accessible to anyone who can reach the server.
- Fix: Add `authenticateToken` middleware to all mol-price and molecules endpoints.

**CORS open when no origins configured**
- `server/index.js` line 113: `if (!origin || allowedOrigins.size === 0 || allowedOrigins.has(origin))` — when `BASE_URL` and `FRONTEND_URL` are both unset, `allowedOrigins` is empty and every origin is permitted.
- Impact: Any cross-origin request is silently allowed in an under-configured deployment (e.g., before env vars are properly set in production).
- Fix: Fail-secure — require at least one allowed origin or default to deny-all when the set is empty.

---

## Security Concerns

**JWT tokens stored in `localStorage` (XSS risk)**
- `client/src/context/auth.jsx` lines 49–51 write `access_token`, `auth_token`, and `user_info` to `localStorage`. A duplicate redundant key (`auth_token`) is also written alongside `access_token`.
- Impact: Any XSS vulnerability in the app (e.g., via third-party libraries like Ketcher/Molstar) could exfiltrate the JWT.
- Fix: Prefer `httpOnly` cookies or at minimum document the accepted risk.

**No JWT token revocation**
- Tokens are stateless JWTs signed with `JWT_SECRET`. There is no blacklist, no server-side session table, and no token rotation.
- `server/index.js` line 1862: tokens expire in `1d`. There is no refresh token mechanism.
- Impact: Disabling a user account (`active: false`) blocks the `requireActiveUser` middleware DB check, but compromised tokens remain cryptographically valid until expiry — a 24-hour window.
- Fix: Add a per-user `tokenVersion` counter to the DB; verify it on every authenticated request.

**Full JWT payload stored in simulation logs**
- `server/index.js` lines 2427, 2578: `user: req.user` stores the entire decoded JWT payload (including all claims) directly into the `simulation_logs` MongoDB collection.
- Impact: Sensitive claims (role, companyId, etc.) are needlessly duplicated into a non-core collection, widening the blast radius if that collection is exposed.
- Fix: Store only `username` and `companyId` (already duplicated in separate fields on the same document).

**No email format validation at signup**
- `server/index.js` line 1450–1465: the `POST /api/signup` handler checks for presence of `email` but does not validate its format (no regex, no library call).
- Impact: Users can register with malformed email addresses, breaking verification email delivery silently.
- Fix: Add a basic email format check (e.g., `/^[^\s@]+@[^\s@]+\.[^\s@]+$/`) before inserting the user.

**No input sanitisation for MongoDB regex search (potential ReDoS)**
- `server/index.js` lines 2019–2024, 2143–2161, 5090–5093, 5243: raw user-supplied query strings are passed directly into MongoDB `$regex` filters with `$options: 'i'`.
- Impact: A malicious user can submit a pathological regex pattern (e.g., `(a+)+`) and cause catastrophic backtracking on the MongoDB server.
- Fix: Escape special regex characters before passing to `$regex`, or use `$text` full-text search for these queries.

**Client-side IP fetch on login (privacy + trust boundary)**
- `client/src/pages/auth/sign-in.jsx` lines 25–27 and 57–65 call `https://api.ipify.org` from the browser to obtain the user's IP before login, then on successful login for `tester123` a second identical fetch is made (line 57).
- `client/src/pages/dashboard/simulation.jsx` line 764 does another `api.ipify.org` fetch.
- `client/src/utils/algo/algo.jsx` line 29 calls `https://ipapi.co/json/` for geolocation.
- Issues: (1) The browser-reported IP is trivially spoofable — the server already has the real IP via `req.ip`. (2) Double fetch on `tester123` login. (3) Third-party GDPR-sensitive service calls without user consent banner. (4) `console.log('Tester123 IP stored:', ipData.ip)` leaks IP to browser console in production.
- Fix: Remove client-side IP fetching; use `req.ip` server-side for IP logging.

**Missing security headers**
- `server/index.js` lines 123–126 set only `X-Content-Type-Options` and `X-Frame-Options`. Missing: `Content-Security-Policy`, `X-XSS-Protection`, `Strict-Transport-Security`, `Permissions-Policy`.
- Fix: Install and configure `helmet` middleware.

**`/api/validate-token` is unauthenticated**
- `server/index.js` line 2838: `POST /api/validate-token` hits the DB to validate a token but has no rate limit. Unlike auth endpoints it lacks `authRateLimit`.
- Impact: Can be used to enumerate valid usernames and company IDs via error response differences.
- Fix: Apply `authRateLimit` to this endpoint.

**`/api/send-email` is unauthenticated**
- `server/index.js` line 4918: `POST /api/send-email` only applies `publicEmailRateLimit` (5 requests per 15 min per IP), no authentication.
- Impact: Any actor can send emails from the platform's configured SMTP account to arbitrary recipients.
- Fix: Require authentication or tightly validate the recipient against known users.

---

## Technical Debt

**5,821-line monolithic server file**
- `server/index.js` contains every route, middleware, utility function, and startup logic in a single ESM file (5,821 lines).
- Navigation, maintenance, and code review are impractical. Feature additions create conflicts.
- Fix: Split into a router-per-domain structure: `routes/auth.js`, `routes/simulation.js`, `routes/billing.js`, `routes/molprice.js`, etc. Middleware belongs in `middleware/`.

**`tester123` hardcoded username bypasses token logic in two separate places**
- See Critical Issues above. The bypass is duplicated at lines 2406 and 2553, not centralised.

**Dual dotenv loading with potential order ambiguity**
- `server/index.js` lines 14–33: `import 'dotenv/config'` (ESM auto-load) is followed by `configDotenv({ path: '../.env' })` and then `configDotenv()` (cwd `.env`). The first `import` already populates `process.env`; subsequent calls silently no-op for already-set keys. The intent is to support two `.env` files but the interaction is fragile.

**Stripe webhook secret is optional at startup**
- `server/index.js` line 50: `STRIPE_WEBHOOK_SECRET` falls back to `''` and is not in `REQUIRED_ENV`. If absent, the webhook returns HTTP 500 on every Stripe event — billing fails silently rather than loud-crashing at startup.
- Fix: Add `STRIPE_WEBHOOK_SECRET` to `REQUIRED_ENV`.

**`/api/simulation` GET/POST routes implement their own redundant token-decrement logic**
- Both GET and POST `/api/simulation` endpoints (lines 2395–2410, 2542–2558) manually check `userDoc.simulationTokens` and decrement it, duplicating the `consumeSimulationToken` middleware that already handles this correctly for other routes.
- This is where the `tester123` bypass sneaks in — the middleware would not have the bypass.

**Legacy code in-tree**
- `legacy/chem-beo-api/` (4,093 lines in `index.js`) is a standalone archived API with its own `utils/` directory. Not imported anywhere in the main app.
- `packages/dashboard-template/` is an upstream UI reference that is also not imported by the app.
- Both directories add confusion about what is active code.

**Test files left in `server/` root**
- `server/test-api.js`, `server/test-api-simple.js`, `server/test-mol-api.js`, `server/test-mongo-connection.js`, `server/test-mongo-connection.mjs`, `server/test-server.js`, `server/check-mol-price.js`, `server/simple-import.js` — all are ad-hoc test/debug scripts checked into the repository alongside production code.

**`xlsx` package version 0.18.5 is unmaintained**
- `server/package.json` line 28: `"xlsx": "^0.18.5"`. SheetJS CE (the open-source fork) stopped publishing to npm at 0.18.5 and the package has known supply-chain and security issues in this version range.
- Used only in `server/import-mol-price.js` (a one-off CLI tool).
- Fix: Switch to `exceljs` or `@e965/xlsx` (maintained fork) for the import script.

**Stale demo data files from template origin**
- `client/src/data/` contains template-originated mock data files: `authors-table-data.js`, `conversations-data.js`, `orders-overview-data.js`, `platform-settings-data.js`, `projects-data.js`, `projects-table-data.js`, `statistics-cards-data.js`, `statistics-charts-data.js`.
- These are imported by `client/src/pages/dashboard/dashboardhome.jsx` and `client/src/pages/dashboard/profile.jsx`, meaning the dashboard home and profile pages render hardcoded fake data.

---

## Performance Concerns

**No timeout on most external API calls**
- Most `axios` calls to NVIDIA, Tanimoto, and Asinex have no `timeout` set (`server/index.js` lines 214, 325, 351, 379, 422, 448, 490, 512, 539, 566).
- The OpenFold3 call has `timeout: 600000` (10 min) which ties up a Node.js async slot.
- Impact: Hung upstream services will hold Express request handlers indefinitely, eventually exhausting the event loop.
- Fix: Set `timeout: 30000` (or feature-appropriate) on all outbound HTTP calls.

**`simulation_logs` collection has no indexes**
- `server/index.js` lines 700–709 create indexes for `users`, `companies`, `audit_logs`, and `billing_events` — but `simulation_logs` has none.
- Queries at lines 2380, 2527 do `findOne({ ...tenantFilter, pdbid, smiles })` and line 2618 does a full `find(tenantFilter).sort({ timestamp: -1 })` — all without an index.
- Fix: Create compound indexes `{ companyId: 1, timestamp: -1 }` and `{ username: 1, pdbid: 1, smiles: 1 }`.

**In-memory rate limiter grows without bound**
- `server/index.js` line 130: `const hits = new Map()` is created per rate-limiter instance. Entries are never garbage-collected — stale IP entries remain in memory forever.
- Impact: In a long-running production server with many unique IPs, memory grows monotonically.
- Fix: Periodically prune entries whose `resetAt` has passed, or use `express-rate-limit` with an external store.

**Unescaped regex on large molecule collections**
- See Security Concerns. Beyond security, MongoDB evaluates unanchored case-insensitive regex via a full collection scan when the field is not indexed with a text index.
- `/api/mol-price` operates on a potentially large `mol_price` collection; the regex fan-out over 6 fields with `$or` on every request will be slow.

**Large page files**
- `client/src/pages/dashboard/simulation.jsx` (1,985 lines) and `client/src/pages/dashboard/molstar3d.jsx` (1,198 lines) are giant single-file components with no code splitting.
- These will result in slow initial bundle parse time and are hard to maintain.

---

## Scalability Concerns

**Single MongoDB client, no connection pooling configuration**
- `server/index.js` line 676: `new MongoClient(uri)` with default options — no `maxPoolSize`, `minPoolSize`, or `serverSelectionTimeoutMS` overrides.
- Impact: Under concurrent load, the default pool (100 connections) may be exhausted or the default 30s server selection timeout may cause cascading failures.

**In-memory rate limiter is not shared across Node.js processes**
- The custom rate limiter (`server/index.js` lines 129–152) stores state in a `Map` local to each Node.js process.
- If the app is run with a process manager (e.g., `pm2 cluster mode`) or behind multiple instances, each worker has its own independent counter, making the rate limit N× more permissive than intended.
- Fix: Use `express-rate-limit` with a Redis or MongoDB backing store.

**RabbitMQ ADMET integration lacks dead-letter handling**
- `server/utils/rabbitMQUtils.js` enqueues ADMET tasks but there is no dead-letter queue or retry-on-failure strategy visible in `server/index.js`.
- Impact: Failed ADMET jobs disappear silently; users see no error and tokens are already consumed.

---

## Maintainability Concerns

**All server logic in one 5,821-line file**
- See Technical Debt above. The pattern makes all changes a merge-conflict risk and makes it impossible to load only relevant context when debugging.

**Inconsistent token deduction pattern**
- Most simulation endpoints correctly use the `consumeSimulationToken(feature)` middleware.
- GET and POST `/api/simulation` bypass the middleware and implement their own duplicate logic (with the `tester123` bug).
- A developer adding a new simulation endpoint has two conflicting patterns to choose from.

**`/api/simulation` GET endpoint uses query params for a side-effectful operation**
- `GET /api/simulation` (`server/index.js` line 2348) runs a real docking simulation and deducts tokens. GET requests are conventionally idempotent/read-only. This will confuse browser caching, proxy retries, and any developer reading the API.

**Branding inconsistency across the codebase**
- The platform has been rebranded from "Pyxis" → "ChemBench" but remnants persist:
  - `server/index.js` line 4821: email subject `'Test Email from Pyxis Discovery'`
  - `server/index.js` line 4861: Swagger example `"Welcome to Pyxis Discovery"`
  - `client/src/data/pyxisImages.js` and `client/src/data/pyxisServicesImages.js` — Pyxis-named data files still used in `client/src/pages/main/services.jsx`
  - `client/src/pages/main/about-us.jsx` references `pyxis-hero.jpg`, `pyxis-team.jpeg`, `pyxis-lab.jpeg` image files.
  - `client/src/widgets/layout/navbar.jsx` line 86 and `sidenav.jsx` line 117 hardcode `brandName: "MedSaaS"` — the original pre-rebrand name.

**`diffdock_api.log` written to working directory with no path config**
- `server/index.js` line 5784: `LOG_PATH = 'diffdock_api.log'` is a relative path resolved at runtime from `process.cwd()`. If the server starts from a different cwd, the log lands in an unexpected location. The log rotation (lines 5790–5796) deletes the file rather than rotating it, losing historical data.

**Hardcoded fallback IP addresses for external services**
- `server/index.js` lines 54, 59: `'http://151.145.91.17:8000'` (Tanimoto) and `'http://83.229.87.94:8001/convertSTR'` (SDF converter) are raw IP addresses hardcoded as default fallbacks.
- These services are accessed over plain HTTP (not HTTPS), and use IP addresses that could change or be taken over.

**`/api/hello` debug endpoint exposed publicly**
- `server/index.js` line 1934: `GET /api/hello` returns a hardcoded JSON string with no authentication and no useful purpose.

---

## Dead Code / Cleanup Needed

**`legacy/chem-beo-api/`** — archived standalone chemistry API, 4,093 lines, never imported by the active codebase. Should be removed or archived outside the repo.

**`packages/dashboard-template/`** — upstream UI reference, not imported anywhere. Contains a full copy of source files that diverge from `client/src/`.

**`server/` root test scripts** — `test-api.js`, `test-api-simple.js`, `test-mol-api.js`, `test-mongo-connection.js`, `test-mongo-connection.mjs`, `test-server.js`, `check-mol-price.js`, `simple-import.js` — ad-hoc development scripts checked in alongside production code.

**`server/REFACTORING_SUMMARY.md`** — a planning document in the server root. Not source code.

**`client/src/data/pyxisImages.js` and `pyxisServicesImages.js`** — Pyxis-branded data files. `pyxisImages.js` is not imported anywhere active; `pyxisServicesImages.js` is imported by `client/src/pages/main/services.jsx` but the file name and keys should be renamed.

**`client/src/data/` template demo files** — `authors-table-data.js`, `conversations-data.js`, `orders-overview-data.js`, `platform-settings-data.js`, `projects-table-data.js`, `statistics-cards-data.js`, `statistics-charts-data.js` contain hardcoded fake data from the dashboard template. They are still imported and rendered in the live dashboard home and profile pages.

**`client/src/utils/algo/algo.jsx`** — currency-conversion and geolocation utility that fetches user IP via `ipapi.co` and exchange rates via a free-tier unauthenticated external API. Usage in the codebase is limited; its value vs. GDPR risk should be evaluated.

---

## Missing Error Handling

**`/api/send-email` does not catch SMTP config errors before sending**
- `server/index.js` lines 4927–4934 catch errors and return 500, but there is no pre-flight check for `EMAIL_USER`/`EMAIL_PASS`. Errors are logged to the console but full SMTP stack traces may be included in the `details` field returned to the caller.

**`ensureMongoConnected` ping on every authenticated request**
- `server/index.js` lines 744–745: every request through `ensureMongoConnected` calls `client.db().admin().ping()`, which is a synchronous round-trip to MongoDB on the hot path of every API call. If MongoDB is slow, this adds latency to every request.

**`fulfillCheckoutSession` throws on missing user — not caught by Stripe webhook**
- `server/index.js` line 1128: throws `Error('No user found for Stripe fulfillment: ...')`. The Stripe webhook handler at line 102–105 catches this and returns HTTP 500 — causing Stripe to retry the webhook. Without idempotency guarantees on all retry paths this could result in double-fulfillment (though the existing `billingEventsCollection` dedup partially mitigates it).

**No global Express error handler**
- There is no `app.use((err, req, res, next) => ...)` catch-all at the bottom of `server/index.js`. Unhandled promise rejections in route handlers that forget `try/catch` will trigger Node's `UnhandledPromiseRejectionWarning` and potentially crash the process.

**`execFile('./diff_dock.sh', ...)` injects user-supplied values as shell arguments**
- `server/index.js` line 4050: `protein` and `ligand` values come from `req.body` and are passed as positional arguments to `diff_dock.sh` via `execFile`. While `execFile` doesn't invoke a shell (unlike `exec`), the script itself could mishandle special characters in argument values. There is no sanitisation of these values.

---

## Dependency Concerns

**`xlsx` 0.18.5 is the last npm-published SheetJS CE release and is no longer maintained**
- The maintainer moved to a paid model; this version has known prototype-pollution and parsing vulnerabilities.
- Used only in `server/import-mol-price.js` (CLI import script).
- Fix: Replace with `exceljs` (`npm install exceljs`).

**`vite` 4.5.0 is multiple major versions behind (current: 6.x)**
- `client/package.json` pins Vite at 4.5.0. Vite 4 is EOL.
- Several `devDependencies` (`@vitejs/plugin-react 4.1.0`, `postcss 8.4.31`, `tailwindcss 3.3.4`) are similarly behind.

**`react-router-dom` 6.17.0 is not current (current: 7.x)**
- Pinned at a minor release that misses security and API updates.

**No lockfile at repo root**
- The root `package.json` (which only defines `scripts`) has no `package-lock.json`. Only `server/` and `client/` have lockfiles.

**`node-fetch` vs `axios` duplication**
- The server imports both `axios` (for NVIDIA APIs) and `node-fetch` (for Asinex/DiffDock/Tanimoto). Two HTTP client libraries with inconsistent error-handling patterns.

---

## Notes for New Developers

- **There are no automated tests** — no unit, integration, or E2E tests exist anywhere in the codebase. The `npm run check` script runs `node --check index.js` (syntax only) + `vite build`. Do not assume correctness from "passing CI".

- **`server/index.js` is the entire backend** — all 5,821 lines of business logic, routes, middleware, and startup code live in this one file. Use line number navigation. The ordering is: imports → Stripe webhook → CORS/middleware → all routes (grouped loosely by feature) → auth middleware functions → startup.

- **The `tester123` user is a special-cased free account** — registering or using this username bypasses token deduction on `/api/simulation` GET and POST. This is not a test-only account enforced by environment; it applies in production.

- **`mol-price` and `molecules` APIs are public** — no authentication required. Do not store sensitive data in these collections under the assumption they are protected.

- **Environment variable `STRIPE_WEBHOOK_SECRET` is not required at startup** — missing it causes silent billing failure. Set it even in development (use `stripe listen --forward-to localhost:3000/stripe/webhook`).

- **`client/dist/` is committed to git** — the built frontend is in the repository. After client changes, run `npm run build` from `client/` and commit the updated `dist/`.

- **Branding is inconsistent** — the product has been through at least two names (Pyxis → MedSaaS → ChemBench). Code, data files, and email subjects reference all three. When adding new user-facing text, use "ChemBench" consistently.

- **External scientific services are third-party IP addresses over plain HTTP** — Tanimoto (`151.145.91.17`), SDF converter (`83.229.87.94`), Asinex (`dev.asinex.com`). These services may be down or slow; none have retry logic.

- **The `packages/dashboard-template/` and `legacy/chem-beo-api/` directories are dead code** — they are reference copies and archived code respectively. Do not modify or import from them.

---

*Concerns audit: 2026-06-03*
