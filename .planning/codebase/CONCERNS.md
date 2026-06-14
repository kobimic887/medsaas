# Codebase Concerns

**Analysis Date:** 2026-06-14

## Tech Debt

### Monolithic Server File

**Issue:** Single ~6,342 line server file (`server/index.js`) contains all routes, middleware, database logic, utility functions, and API integrations in one ESM module.

**Files:** `server/index.js`

**Impact:** 
- Extremely difficult to navigate and maintain
- Testing individual features requires testing the entire file
- Code organization by concern is impossible — parsing, business logic, database operations, and API proxies are interleaved
- Adding new routes or features forces reading thousands of lines of unrelated code
- Performance: Node/Bun must parse and hold the entire file in memory at startup

**Fix approach:** 
- Split routes into subdirectories: `server/routes/auth.js`, `server/routes/simulations.js`, `server/routes/billing.js`, `server/routes/admin.js`, etc.
- Extract middleware into `server/middleware/` — `authentication.js`, `rateLimit.js`, `validation.js`
- Extract database operations into `server/services/` — `userService.js`, `companyService.js`, `billingService.js`
- Extract shared utilities into `server/utils/` (already partially done)
- Use Express Router to compose routes at the top level in a 150-line `index.js`

---

### In-Memory Rate Limiter

**Issue:** Custom in-memory rate limiter (`createRateLimiter` at line 166) uses a `Map` to track request counts per IP/endpoint.

**Files:** `server/index.js` (lines 166–193)

**Impact:**
- **Horizontal scaling:** Cannot scale beyond a single process — rate limits are not shared across instances. If deployed to multiple servers, each instance tracks independently, defeating rate limiting at scale.
- **Restart loss:** All rate-limit records are lost on server restart or process crash. Coordinated attacks can immediately resume.
- **Memory leak risk:** Expired records are never cleaned up once `resetAt` passes. The `hits` Map grows indefinitely.
- **No persistence:** No audit trail or historical analysis of rate-limit violations.

**Fix approach:**
- Migrate to Redis-backed rate limiter (e.g., `redis` + `redis-rate-limit` or `Redlock` for distributed limits)
- Or replace with a managed service rate-limit (e.g., AWS API Gateway, Cloudflare)
- Add periodic cleanup of expired records if staying in-memory for development
- Consider storing rate-limit violations in MongoDB audit logs for post-breach analysis

---

### Module-Level Global State

**Issue:** Collections and client are defined at module scope and shared across all requests.

**Files:** `server/index.js` (lines 712–717, 731–734)

```javascript
let usersCollection;
let companiesCollection;
let auditLogsCollection;
let billingEventsCollection;
```

**Impact:**
- If initialization fails partway through, stale partial state may persist
- Connection pools and indexes are created once at startup; if MongoDB drops connection, middleware must detect and reconnect (`ensureMongoConnected` at line ~790)
- No request-scoped isolation — all requests share the same collection references and client connection
- Hard to test or mock: no dependency injection, global state must be cleared between tests

**Fix approach:**
- Wrap collections in a connection-management module with lazy initialization and reconnection logic
- Export a `getDb()` function rather than global references
- Use a connection pool manager (MongoDB native handles this, but explicit management clarifies the concern)
- Add health-check middleware that validates collection availability on each request startup phase

---

### Log File Rotation Without Cleanup

**Issue:** `logToFile()` function (lines 6307–6325) rotates logs by deleting the file when it exceeds 20 MB, but never archives or compresses old logs.

**Files:** `server/index.js` (lines 6304–6325)

**Impact:**
- Production logs are lost on rotation — no historical record of events
- No way to audit what happened before a crash or incident
- Debugging failed deployments requires real-time log access or manual capture
- No structured logging — logs are appended as plaintext strings, not queryable events

**Fix approach:**
- Use a proper logging library: `winston`, `pino`, or `bunyan` with file/MongoDB transports
- Implement log rotation with archival to S3 or GCS instead of deletion
- Switch to structured JSON logging so events can be queried and analyzed
- Consider centralized logging (ELK, Datadog, CloudWatch) for production

---

## Known Bugs

### Stripe Webhook Not Registered in Non-Prod

**Symptoms:** Checkout succeeds but credits are not granted. Manual testing must use the test endpoint to verify token flow.

**Files:** `server/index.js` (lines 67–74), `.env` configuration

**Current state:** 
- `STRIPE_WEBHOOK_SECRET` defaults to empty string if set to the placeholder `"replace_me"` (lines 70–72)
- When empty, `/stripe/webhook` rejects all events with 500 (line 111)
- Credits are ONLY granted via `fulfillCheckoutSession` called from the webhook (line 128)
- Non-prod deployments don't have a webhook registered with Stripe, so `checkout.session.completed` events never reach the endpoint

**Trigger:** 
- Purchase a plan in a non-prod environment
- Checkout session is created successfully and payment is processed
- No webhook event is sent (or secret validation fails)
- Credits are not added to the user's account
- User sees "0 tokens" despite successful payment

**Workaround:** 
- Register a webhook endpoint in the Stripe dashboard for non-prod with the correct `STRIPE_WEBHOOK_SECRET`
- Or manually call `fulfillCheckoutSession` via an admin endpoint for testing
- Use the Stripe CLI `stripe listen --forward-to` for local webhook testing (documented in CLAUDE.md)

**Fix approach:**
- Document the webhook registration requirement in `.env.example`
- Add a POST `/api/admin/stripe/fulfill` endpoint (admin-only) to manually trigger fulfillment for testing
- Log a WARNING at startup if `STRIPE_WEBHOOK_SECRET` is empty (already done at line 73–74, but customer may not see it)

---

### Auth Interceptor Assumes Single Redirect Window

**Symptoms:** If multiple API requests fail with 401 simultaneously (e.g., parallel `activity`, `simulation-logs`, and `user-info` calls), multiple redirects to `/auth/sign-in` may fire in rapid succession, causing route thrashing or race conditions.

**Files:** `client/src/utils/authInterceptor.js` (lines 18–30)

**Current state:**
- `isRedirecting` flag guards against multiple redirects (line 23)
- But flag is set at module load and never reset
- If a soft redirect fails (e.g., network error), the flag stays true and no subsequent 401s will trigger redirect

**Trigger:**
- Token expires while user is on the dashboard
- Multiple concurrent requests fail with 401 simultaneously
- First to fire sets `isRedirecting = true` and calls `window.location.href`
- Subsequent failures see the flag and return without action
- If the first redirect stalls (network latency), user is left on the dashboard with an expired token and no further redirects possible

**Workaround:**
- Manual page refresh or re-login via the URL bar
- Close and reopen the dashboard tab

**Fix approach:**
- Reset `isRedirecting` to false after a timeout (e.g., 5 seconds) to allow retries if the first redirect fails
- Or reset the flag on successful page navigation (listen for `popstate` or `location` change)
- Consider a queuing mechanism for redirect requests instead of a binary flag

---

## Security Considerations

### Environment Variable Validation at Startup Only

**Risk:** Required env vars (`MONGODB_URI`, `JWT_SECRET`, `STRIPE_SECRET_KEY`) are validated once at startup. If an env var is removed or corrupted after startup, the application continues to run with stale/invalid credentials until restart.

**Files:** `server/index.js` (lines 47–59)

**Current mitigation:**
- Startup validation catches missing vars before the server binds to a port
- `JWT_SECRET` length is enforced (≥32 chars, line 56–58)
- STRIPE_WEBHOOK_SECRET can be empty (intentionally allows non-prod without webhook)

**Recommendations:**
- Add periodic health checks that re-validate critical env vars (e.g., JWT_SECRET still exists, MongoDB URI still reachable)
- Log a WARNING if any critical env var changes during runtime
- Consider reading secrets from a vault (HashiCorp Vault, AWS Secrets Manager) instead of static .env, so rotations don't require restart

---

### Internal IP Address Validation for Admin-Configured URLs

**Risk:** Admins can configure custom ligand catalog/docking endpoints per company. The validator (`isDisallowedAddress` at line 1084) prevents pointing to internal/private IPs, but DNS rebinding attacks can bypass hostname validation.

**Files:** `server/index.js` (lines 1084–1141)

**Current mitigation:**
- Function blocks entire classes of private addresses (10.0.0.0/8, 172.16–31.0.0/12, 192.168.0.0/16, 169.254.0.0/16, loopback, etc.)
- IPv4 and IPv6 parsing (including IPv4-mapped IPv6)
- Covers metadata endpoint (169.254.169.254)

**Status (2026-06-14): still open — deliberately not auto-patched.** A config-time-only check (or a chokepoint re-resolve in `getRequestLigandServiceConfig`) only narrows the rebinding window — it leaves the TOCTOU open while reading as "fixed." The honest fix changes connection behaviour, and these ligand endpoints have no test coverage, so it needs a deliberate, tested change rather than a blind patch.

**Recommended fix:**
- Thread a custom undici `Agent` (with a validating `connect`/`lookup` that rejects private IPs at socket-connect time) through *only* the ligand fetches — not a global `setGlobalDispatcher`, which would also block internal Docker services (admet/gromacs/glioblastoma) that resolve to private addresses.
- Add a test that points a configured URL at a private/rebinding host and asserts the fetch is refused.
- Keep `requireCompanyAdmin` gating; log custom-URL configs to audit logs for review.

---

### 401/403 Distinction in Auth Responses

**Risk:** Client auto-logs-out on any same-origin 401 (per authInterceptor). If the server accidentally returns 401 for authorization failures (e.g., "insufficient admin role"), the user is logged out when they should stay logged in but see a permission error.

**Files:** 
- `server/index.js` — Auth middleware returns 401 for token issues (line 2599), 403 for role/account status (lines 1182, 1206, 1209, 1214, etc.)
- `client/src/utils/authInterceptor.js` — Logs out on 401 (line 63)

**Current mitigation:**
- Comments document the distinction (lines 2596–2598: "401 for missing/expired, 403 for authorization")
- Most middleware correctly returns 403 for disabled accounts, wrong roles, etc.
- However, some routes mix the codes (e.g., `requireActiveUser` returns 401 if token.user.username is missing, line 1195)

**Recommendations:**
- Audit all 400-series responses in the server to ensure 401 is ONLY for "you need to re-authenticate" and 403 is for "you're authenticated but not authorized"
- Add a linter rule to catch new 401 responses outside auth middleware
- Document this invariant in CONVENTIONS.md

---

## Performance Bottlenecks

### Simulation Token Consumption Via Atomic Update

**Problem:** Every simulation feature consumes a token via an atomic MongoDB `updateOne` with a query checking `simulationTokens: { $gt: 0 }` (line 1243–1248). This is correct for preventing overspend, but under high concurrency can cause contention.

**Files:** `server/index.js` (lines 1227–1266)

**Cause:**
- Update succeeds only if the query matches (user has > 0 tokens)
- If many requests arrive simultaneously, all hit the same user document
- MongoDB's write lock on the user document is held for the duration
- User experiences ~ms-scale latencies multiplied by concurrent request count

**Improvement path:**
- Cache token count in memory with a very short TTL (5–30 seconds) for reads, only update DB on consumption
- Or use a distributed token bucket (Redis) for better concurrency
- Profile with concurrent simulation requests to measure actual impact
- Consider batch updates if token consumption can be deferred and aggregated

---

### DiffDock / External API Timeout — RESOLVED 2026-06-14

**Resolved:** All outbound calls are now bounded. `axios.defaults.timeout` is set (per-call timeouts like the 600s OpenFold3 call still override), and all 21 native `fetch()` calls go through a `fetchWithTimeout` helper — interactive catalog/search/stock at 2 min, the three docking/diffdock generate jobs at 10 min. A hung upstream can no longer hold a file descriptor open indefinitely. Additive change (adds a ceiling where there was none; nothing that completes in time is affected).

**Problem (was):** OpenFold3 requests had a 600s timeout, but the DiffDock/Asinex/Tanimoto calls had none, leading to indefinite hangs (and eventual fd exhaustion) if an upstream stalled.

**Files:** `server/index.js` (line 295 has timeout; search for DiffDock requests for missing timeouts)

**Cause:**
- Long-running biochemistry simulations can legitimately take 5–10 minutes
- But if the external API hangs, the client connection stays open, consuming a process handle
- After many hangs, the app runs out of file descriptors and rejects new connections

**Improvement path:**
- Set explicit timeouts on ALL external API calls (Asinex, DiffDock, Tanimoto, GROMACS, etc.)
- Add circuit-breaker pattern: track upstream failures and fail-fast if a service is down
- Monitor request latencies and alert if p99 exceeds 10 minutes

---

### Company Record Lookups Without Caching

**Problem:** `getCompanyRecord()` (line ~960) queries MongoDB every time it's called. In a multi-tenant system, the same company is frequently loaded by multiple requests in parallel.

**Files:** `server/index.js` (search for `getCompanyRecord` calls)

**Cause:**
- No in-process cache or TTL-based cache
- Every request that loads user info, then company billing policy, usage, etc., makes sequential DB calls

**Improvement path:**
- Add an in-memory LRU cache with a 5–30 minute TTL for company records
- Invalidate cache on company update (admin changes branding, usage policy, etc.)
- Or use MongoDB query projection to fetch only needed fields, reducing document size
- Monitor query frequency with MongoDB APM tools

---

## Fragile Areas

### Email Template HTML Injection Escaping

**Issue:** Email templates inline brand palette colors via `style="color: rgb(${r}, ${g}, ${b})"` attributes. If the r/g/b values are user-controlled or unparsed, HTML injection is possible.

**Files:** `server/utils/emailTemplates.js`, `server/index.js` (email send logic)

**Why fragile:**
- Brand palette is user-uploaded (logo-driven extraction) — extraction algorithm must be bulletproof
- `generateInviteEmailHTML` and `generatePasswordResetEmailHTML` take palette as parameter
- If a palette color value contains a `"` or `>`, it breaks the HTML attribute

**Safe modification:**
- Always validate palette colors are valid RGB integers (0–255) before using in email HTML
- Use HTML entity encoding for any user text in email (already done for caller name in recent commit 0d0cb5b)
- Write a test case that attempts to inject HTML via a malformed palette (test/email-injection.test.mjs or similar)
- Check `server/utils/emailTemplates.js` for all HTML output to ensure proper escaping

**Test coverage:** 
- See commit 2b174ea: "test(04): cover invite template + HTML-injection regression" — test likely exists in `test/` directory

---

### Company Branding State Reset on Direct Company Switch

**Issue:** When a user switches companies, the brand palette CSS variables must be cleared to prevent stale colors from leaking to the new company's dashboard.

**Files:** `client/src/context/branding.jsx` (BrandingProvider)

**Why fragile:**
- CSS variables are written to `document.documentElement` on login (line 73 of STATE.md notes this)
- If logout doesn't clear the variables, a hard refresh before re-login shows the old company's colors
- If a company switch doesn't clear, the old palette momentarily appears before the new one loads

**Safe modification:**
- Ensure `BrandingProvider` clears `document.documentElement` style attributes on logout or company switch
- Call `clearBrandingVariables()` before loading new palette
- Commit 67cfab3 ("fix(03): WR-03 reset branding state on direct company switch to clear stale palette") fixed this — verify the fix is still in place

**Test coverage:**
- Write a test that logs in as company A (blue), switches to company B (red), verifies only company B colors are applied
- Test that manual refresh after company switch loads correct colors

---

### Bun vs. Node Runtime Compatibility (Partial Migration)

**Issue:** Bun is the default runtime with npm/Node fallbacks retained. The Bun migration (v2 — incl. Phase 7 Docker/CI/Scripts) shipped 2026-06-05; residual risk is Bun-vs-Node runtime divergence, not migration-incompleteness. As of 2026-06-14, CI (`ci.yml`) runs the Bun suite and gates deploys (`deploy.yml` `needs: test`).

**Files:** 
- `Dockerfile` — Currently uses `oven/bun:1.3.14-slim` as base (line 1)
- `.github/workflows/deploy.yml` — Doesn't run tests or checks before deployment (line 29–52)
- `server/package.json` — Has both `bun` and `node` scripts (lines 8–15)
- `client/package.json` — Similar dual scripts

**Current state:**
- Bun is the default for `npm run dev`, `npm run build`, `npm run start` (thanks to root `package.json` scripts)
- Node fallbacks exist via `:node` suffixes (e.g., `npm run dev:node`)
- Docker build uses Bun, production deployment uses Bun on Oracle Linux arm64
- CI/CD: `ci.yml` runs `bun run ci` (check + Bun tests) on push/PR; `deploy.yml`'s `deploy` job `needs: test`, so a deploy is blocked unless the suite passes (added 2026-06-14)

**Why fragile:**
- Tests are available (`npm run test:stripe:bun`, `npm run test:branding:bun`) but CI doesn't run them
- A broken commit can deploy to production without running the test suite
- If Bun and Node have runtime differences (e.g., async import timing, Buffer behavior), breakage won't be caught until production

**Safe modification:**
- Phase 7 (not yet started) should add test/lint checks to the CI pipeline
- Parallel test matrix for both Bun and Node runtimes in GitHub Actions (or skip until Phase 7)

---

### Missing CI/CD Test Execution — RESOLVED 2026-06-14

**Resolved:** Added `.github/workflows/ci.yml` (`bun run ci` = `check` + `test`: email-theming, stripe-webhook, branding, runtime-smoke) and made `deploy.yml`'s `deploy` job `needs: test`, reusing `ci.yml` via `workflow_call`. A deploy can no longer ship a commit whose suite is red. `mongodb-memory-server` is pinned to the ubuntu-22.04 binary + cached for deterministic Linux runs. Deliberately still open: Bun-only gate (no Node matrix), no ESLint/Biome linter, and `runtime-watch-smoke` excluded (it exercises `--watch` and can hang a runner). Original description retained below for context.

**Issue (was):** Deployment pipeline (`deploy.yml`) checks out code, archives it, and deploys to the Oracle VPS without running ANY tests, linting, or syntax checks.

**Files:** `.github/workflows/deploy.yml` (lines 18–52)

**Impact:**
- Syntax errors, failed tests, and lint violations reach production
- No feedback loop to developers before deployment
- Rollback requires manual intervention (SSH to the box, restart container)

**Fix approach (Phase 7 scope):**
- Add `bun run check` or `npm run check` step before archive (syntax check + client build)
- Add `npm run test:stripe:bun` and `npm run test:branding:bun` steps
- Fail the workflow if any check fails
- Consider adding a linter (ESLint, Biome) to catch code quality issues

---

## Scaling Limits

### In-Memory Rate Limiter Across Cluster

**Current capacity:** Single process, single instance only

**Limit:** Adding more server instances breaks rate limiting — each process independently tracks limits.

**Scaling path:** See "In-Memory Rate Limiter" under Tech Debt above. Migrate to Redis.

---

### Monolithic MongoDB Connection

**Current capacity:** Single `MongoClient` connection pool (default ~10 connections)

**Limit:** High-concurrency scenarios (100+ concurrent requests) may exhaust the pool.

**Scaling path:**
- Increase `maxPoolSize` in MongoClient options (currently not set, defaults to 10)
- Monitor connection pool exhaustion with `client.topology().s.sessionPool`
- Consider connection pooling proxy (e.g., PgBouncer equivalent for MongoDB)

---

### Audit Logging Unbounded Growth

**Current capacity:** `audit_logs` collection in MongoDB, no TTL index

**Limit:** Collection grows indefinitely with every auth action, simulation, admin change. After 1–2 years in production, queries slow down.

**Scaling path:**
- Add a TTL index to the `audit_logs` collection: `db.audit_logs.createIndex({ timestamp: 1 }, { expireAfterSeconds: 2592000 })` (30 days)
- Or implement log rotation to archive/delete old entries to cold storage (S3, GCS)
- Consider a separate timeseries collection for high-volume events (simulations) with tighter TTL

---

## Dependencies at Risk

### Node-Vibrant 4.0.4 (Pinned Version)

**Risk:** Pinned to an old version (Phase 1 spike, commit ~2026-06-06). Canvas-based library may have memory leaks or compatibility issues with newer Node/Bun versions.

**Files:** `server/package.json` (line 38: `"node-vibrant": "4.0.4"`)

**Impact:** 
- Logo color extraction can fail on certain image formats
- Memory consumption during logo upload is not tracked
- If abandoned upstream, security fixes won't arrive

**Migration plan:**
- Monitor for issues during phase 5 (Bun runtime testing)
- Test with newer versions (5.x, 6.x) if available
- Have a fallback palette extraction algorithm (e.g., pure-JS color picker) if vibrant fails
- Document the pinning decision in a comment next to the dependency

---

### Sharp 0.34.5 (Pinned Version)

**Risk:** Pinned to a specific version for arm64 stability (Phase 1 spike). Updates may have breaking changes.

**Files:** `server/package.json` (line 40: `"sharp": "0.34.5"`)

**Impact:**
- Image optimization may not use latest performance improvements
- Security fixes in newer Sharp versions won't be applied automatically

**Migration plan:**
- Periodically check for newer Sharp versions that support Bun on arm64
- Test upgrades in a staging environment before production
- Monitor for CVEs in the pinned version

---

### RDKit (@rdkit/rdkit 2025.3.4-1.0.0)

**Risk:** RDKit is a large, complex C++ library compiled to WebAssembly. Updates may break compatibility or have binary size regressions.

**Files:** `server/package.json` (line 27), `client/package.json` (if installed)

**Impact:**
- Slow installation on CI systems (requires compilation or download of large binaries)
- Breaking API changes in major versions
- Difficult to debug binary linking issues

**Migration plan:**
- Pin to a stable minor version and test updates in staging
- Cache compiled binaries in CI to speed up builds
- Monitor RDKit changelog for breaking changes

---

## Test Coverage Gaps

### Email Sending Not Tested End-to-End

**What's not tested:** Full email delivery flow (compose, template rendering, SMTP send) with real Nodemailer configuration.

**Files:** `server/utils/emailService.js` (sends via Nodemailer), `server/index.js` (calls emailService)

**Risk:** 
- Email templates may render incorrectly (missing variables, malformed HTML)
- Branding colors may not inline correctly in emails sent to real addresses
- SMTP configuration errors only surface in production when a user triggers an invite

**Test coverage:**
- Unit tests exist for template HTML generation (commit 2b174ea likely covers this)
- No integration test that sends a real email via Nodemailer
- No test for Titan email service specifically

**Priority:** Medium (branding emails are critical to user experience)

**Approach:**
- Add `test/email-send.test.mjs` that mocks Nodemailer, verifies template rendering and color inlining
- Use `nodemailer-mock` or stub `sendTitanEmail` for local testing
- In staging, send a test email to a real address and inspect the HTML

---

### Stripe Webhook Signature Verification

**What's not tested:** Webhook signature validation with tampered payloads.

**Files:** `server/index.js` (lines 109–135)

**Risk:**
- If signature verification is broken, malicious webhooks could grant credits to arbitrary users
- Test may exist (line 17: `"test:stripe": "SERVER_RUNTIME=bun bun test/stripe-webhook.test.mjs"`), but unclear if coverage is complete

**Test coverage:**
- Signature test likely exists (see commit 5098e96, phase 4 context)
- Check `test/stripe-webhook.test.mjs` for coverage of:
  - Valid signature acceptance
  - Invalid signature rejection
  - Tampered payload detection

**Priority:** High (billing security)

**Approach:**
- Verify test exists and covers tamper scenarios
- Add a test for replayed webhooks (same session ID sent twice) — currently handled via idempotency check (line 1297)

---

### Concurrency and Race Conditions

**What's not tested:** Parallel requests hitting the same user/company document (simulation token consumption, branding updates, company switch).

**Files:** `server/index.js` (token consumption at lines 1243–1248, company updates throughout)

**Risk:**
- Two simultaneous simulation requests could both pass the token check and consume one token twice, leaving the user with negative tokens
- Or both could fail incorrectly if MongoDB atomicity isn't guaranteed

**Test coverage:** Unlikely covered (would require multi-threaded test harness or cluster simulation)

**Priority:** Medium (affects multi-tab users and concurrent API calls)

**Approach:**
- Add a concurrency test using `Promise.all()` to fire 10 simulation requests with 1 token
- Verify that only 1 succeeds and 9 fail with "No simulation tokens left"

---

*Concerns audit: 2026-06-14*
