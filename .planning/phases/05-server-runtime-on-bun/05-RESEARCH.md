# Phase 05: Server Runtime on Bun - Research

**Researched:** 2026-06-04
**Domain:** Express API runtime migration from Node.js to Bun
**Confidence:** HIGH for codebase touch points and locked decisions; MEDIUM for host execution path because Oracle lacks host-level Bun/Node/npm in noninteractive SSH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

### Run scripts & default runtime (RUN-01, RUN-02)
- **D-01:** Bun becomes the **default immediately** — swap `node` → `bun` inside the existing scripts: `server` `dev` (`bun --watch index.js`), `start` (`bun index.js`), `start:unified` (`FRONTEND_DIST=../client/dist bun index.js`). Root `start`/`dev` keep their current shape (npm-invoked, `predev` hook and `concurrently` preserved) — only the runtime binary the script calls changes.
- **D-02:** Scripts stay **invoked by npm** in Phase 5. Do NOT convert to `bun run` / `bun install` here — that is Phase 6. ("Bun default immediately" = the runtime binary is Bun, not "everything runs through Bun's package tooling.")
- **D-03:** Dev `web` side (Vite client) stays on the existing npm/node toolchain — the bundler swap is out of the whole milestone.

### Node fallback / rollback (RUN-04)
- **D-04:** Add parallel **`*:node` fallback scripts** (e.g. `start:node`, `dev:node`, `start:unified:node`) that run the server on `node`. These are the retained, documented one-command rollback. README/docs must show the exact rollback command.

### RAM gate & before/after report (MEAS-02, MEAS-03)
- **D-05:** Reuse the **Phase 4 measurement harness as-is** — `spike/load-gen.mjs`, N=5, `/health` + `/health/db` endpoint mix, `/proc/<pid>/status` VmRSS boundary — to capture Bun metrics comparable to `BASELINE.md`. (Note: `spike/baseline-capture.mjs` was written for Node; planner must produce a Bun-capable capture path that yields the same metrics with the same method.)
- **D-06:** **Gate rule = "any reduction → Bun"**: if Bun's median idle RSS is lower than the Node baseline, Bun stays the default; if Bun does **not** reduce idle RSS, the default **reverts to Node** (the `*:node` scripts make this a one-line flip) and the report documents it. This reconciles the user's "Bun default immediately" choice with locked roadmap success criterion #4 — Bun is default *during* the phase, but the MEAS-03 gate has final say on the shipped default.
- **D-07:** Because the gate triggers on "any reduction," the before/after report MUST show **per-sample distributions, not just medians** (Phase 4 idle RSS ranged ~111–122 MiB around a 118.9 median — wider than a small "reduction"), so the default isn't flipped on measurement noise. Measure Bun and Node back-to-back on the same machine (oracle).

### Stripe webhook async cutover (RUN-03)
- **D-08:** Apply the `STRIPE-HANDOFF.md` fix: replace `stripe.webhooks.constructEvent()` at `server/index.js:99` with `constructEventAsync()`, and update `server/test/stripe-webhook.test.mjs` to `await`.
- **D-09 [CRITICAL — anti-shallow]:** Phase 4's CMPT-04 ✓ is **NOT** proof the production webhook works under Bun. `spike/04-stripe.ts` called `constructEventAsync()` directly on a hand-built string — it never went through Express, `express.raw()`, or a real HTTP request. The RUN-03 smoke test MUST exercise the **real Express webhook route end-to-end** (signed request → `express.raw` body → `constructEventAsync`) under Bun. A standalone-script re-run does not satisfy RUN-03.

### Smoke test scope & method (RUN-03)
- **D-10:** **Scripted** smoke test (not a manual checklist), reusing Phase 4's `oracle` execution path. It must cover: (1) auth login returns a valid JWT, (2) the real Stripe webhook route verifies a signed event end-to-end (see D-09), (3) the `consumeSimulationToken` middleware on one **cheap** token-consuming endpoint — assert token decrement and/or 402 when tokens are exhausted, **without** calling the external science service.

### the agent's Discretion
- **Stripe code-path shape:** user deferred ("idk & idc") on unconditional-async vs runtime-branched → **decision: unconditional `constructEventAsync()`** (it works on Node too, so one code path serves both runtimes and keeps the Node fallback simple). Planner/executor may adjust only if a Node-version incompatibility surfaces.
- Exact `*:node` script naming, the specific cheap token endpoint chosen for the smoke test, and the smoke-test harness shape (extend `test:stripe` style vs new script) are left to research/planning.

### Deferred Ideas (OUT OF SCOPE)

- `oven/bun` Docker image, GitHub Actions CI on Bun, `check`/`test:brand`/`test:stripe` under Bun — **Phase 7** (OPS-01..04).
- `bun install` / `bun.lock`, scripts run through Bun's package tooling, client deps — **Phase 6** (PKG-01..03).
- Vite → Bun bundler swap — deferred to a later milestone (out of v2 entirely).

None of the above were re-scoped into Phase 5 — discussion stayed within the runtime-cutover boundary.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| RUN-01 | Express API runs in dev on `bun` with working file-watch reload | Use `server/package.json` `dev: bun --watch index.js`; Bun `--watch` hard-restarts on imported file changes and preserves initial args/env [CITED: https://bun.com/docs/runtime/watch-mode]. |
| RUN-02 | Express API runs in production on `bun`, serving built frontend | Use `server/package.json` `start:unified: FRONTEND_DIST=../client/dist bun index.js`; current Express static serving uses `FRONTEND_DIST_PATH` and SPA fallback [VERIFIED: codebase grep]. |
| RUN-03 | Env validation, middleware, auth, Stripe webhook, and one token-consuming endpoint behave identically under Bun | Change Stripe to `constructEventAsync`; extend smoke harness to spawn Bun, sign in, post the real webhook, and assert token decrement on `/api/generate-molecules` without an NVIDIA key [VERIFIED: codebase grep; VERIFIED: installed stripe package]. |
| RUN-04 | Node fallback retained and documented | Add parallel `*:node` scripts and document `npm --prefix server run start:unified:node` as rollback [VERIFIED: CONTEXT.md]. |
| MEAS-02 | Bun metrics captured with same method and compared to baseline | Adapt `spike/baseline-capture.mjs` to a runtime parameter while preserving N=5, `/proc/<pid>/status` VmRSS, `/health` + `/health/db`, and `spike/load-gen.mjs` [VERIFIED: BASELINE.md; VERIFIED: codebase grep]. |
| MEAS-03 | Default runtime gated on measured server RAM | Apply locked gate: Bun remains default only if median idle RSS is below Phase 4 baseline 118.9 MiB; otherwise flip default scripts back to Node and keep Bun scripts/fallback documented [VERIFIED: CONTEXT.md; VERIFIED: BASELINE.md]. |
</phase_requirements>

## Summary

Phase 5 should be planned as a narrow runtime cutover, not a package-manager or Docker migration. The existing server is an ESM Express app started from `server/index.js`; the only required production code behavior change identified is the Stripe webhook sync-to-async verification change, because the installed Stripe SDK's WebCrypto provider throws from the synchronous path and points callers to `constructEventAsync()` [VERIFIED: installed `server/node_modules/stripe/esm/Webhooks.js`; VERIFIED: installed `server/node_modules/stripe/esm/crypto/SubtleCryptoProvider.js`].

The highest-value implementation pattern is to parameterize existing scripts and harnesses rather than add new infrastructure. Change the server runtime binary in `server/package.json`, add `*:node` rollback scripts, update the real webhook route, and extend the existing `server/test/stripe-webhook.test.mjs` style into a broader smoke test that covers auth, Stripe, and token consumption through HTTP [VERIFIED: codebase grep]. Keep the measurement path comparable to Phase 4: same Oracle-class Linux boundary, same endpoint mix, same N=5, same `VmRSS`, same load generator [VERIFIED: BASELINE.md].

**Primary recommendation:** Use Bun `1.3.14` as the Phase 5 runtime target, keep npm as the script runner, migrate only `server/index.js` startup scripts plus Stripe async verification, and gate the shipped default using the Phase 4 idle RSS baseline of 118.9 MiB [VERIFIED: local `bun --version`; VERIFIED: 04-VERIFICATION.md; VERIFIED: BASELINE.md].

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|--------------|----------------|-----------|
| Runtime binary selection | API / Backend | Frontend Server (static serving) | `server/package.json` controls the Express process; `start:unified` also serves built client assets through Express [VERIFIED: codebase grep]. |
| Dev file-watch reload | API / Backend | Browser / Client | API reload is `bun --watch index.js`; client Vite dev server remains unchanged [VERIFIED: CONTEXT.md; CITED: https://bun.com/docs/runtime/watch-mode]. |
| Production static frontend serving | API / Backend | CDN / Static | Express uses `express.static(FRONTEND_DIST_PATH)` and SPA fallback after API routes [VERIFIED: codebase grep; CITED: https://expressjs.com/en/starter/static-files/]. |
| Stripe webhook verification | API / Backend | External Stripe service | The server must receive raw request bytes, verify `Stripe-Signature`, and fulfill billing records [VERIFIED: codebase grep; CITED: https://docs.stripe.com/webhooks?lang=node]. |
| Auth smoke | API / Backend | Database / Storage | `/api/signin` validates Mongo user state and returns JWT; smoke data should be seeded directly into Mongo [VERIFIED: codebase grep]. |
| Token consumption smoke | API / Backend | Database / Storage | `consumeSimulationToken` decrements `users.simulationTokens` in Mongo before selected simulation handlers run [VERIFIED: codebase grep]. |
| RSS/startup measurement | API / Backend | OS / Runtime | Measurement reads Linux `/proc/<pid>/status` `VmRSS` for the server process, not app-level memory APIs [VERIFIED: BASELINE.md]. |
| Rollback | API / Backend | Ops / Runtime | Parallel `*:node` scripts keep a one-command Node fallback without changing app logic [VERIFIED: CONTEXT.md]. |

## Standard Stack

### Core

| Library / Tool | Version | Purpose | Why Standard |
|----------------|---------|---------|--------------|
| Bun | 1.3.14 | Server JavaScript runtime | Already used in Phase 4 compatibility proofs and installed locally; official docs document `--watch`, Node compatibility, and `.env` behavior [VERIFIED: local `bun --version`; VERIFIED: 04-VERIFICATION.md; CITED: https://bun.com/docs/runtime/watch-mode]. |
| Node.js | 22.22.3 | Rollback runtime and baseline comparator | Phase 4 baseline used Node 22.22.3; fallback scripts must retain this path [VERIFIED: local `node --version`; VERIFIED: BASELINE.md]. |
| npm | 10.9.8 | Phase 5 package/script runner | Locked decision says scripts stay npm-invoked until Phase 6 [VERIFIED: local `npm --version`; VERIFIED: CONTEXT.md]. |
| Express | 4.21.2 installed, `^4.18.2` declared | HTTP API, middleware, static serving | Existing app framework; no Bun-native server rewrite needed [VERIFIED: `server/package-lock.json`; VERIFIED: `npm view express@4.21.2`; CITED: https://expressjs.com/en/4x/api/]. |
| Stripe SDK | 18.3.0 | Billing and webhook signature verification | Existing billing library; async webhook method is available and returns `Promise<Stripe.Event>` [VERIFIED: `server/package-lock.json`; VERIFIED: installed `stripe/types/Webhooks.d.ts`; VERIFIED: `npm view stripe@18.3.0`]. |
| MongoDB Node driver | 6.17.0 | Persistent users, billing, audit, health/db | Existing official MongoDB JavaScript driver and Phase 4 verified connect/query/index under Bun [VERIFIED: `server/package-lock.json`; VERIFIED: 04-VERIFICATION.md; CITED: https://www.mongodb.com/docs/drivers/node/current/]. |

### Supporting

| Library / Tool | Version | Purpose | When to Use |
|----------------|---------|---------|-------------|
| `mongodb-memory-server` | 11.2.0 | Ephemeral Mongo for smoke tests | Reuse existing Stripe test pattern; note it has a postinstall script and should not be newly introduced in Phase 5 [VERIFIED: `server/package-lock.json`; VERIFIED: `npm view mongodb-memory-server@11.2.0`]. |
| `bcryptjs` | 3.0.2 declared, 3.0.3 installed | Password hashing for seeded auth smoke user | Seed a known password hash so `/api/signin` exercises production auth [VERIFIED: `server/package.json`; VERIFIED: `server/package-lock.json`]. |
| `jsonwebtoken` | 9.0.2 declared, 9.0.3 installed | JWT verification/signing | Auth smoke should assert a token is returned and accepted by authenticated routes [VERIFIED: `server/package.json`; VERIFIED: `server/package-lock.json`]. |
| `dotenv` | 17.0.1 | Existing explicit env loading | Server currently calls `configDotenv` for root `.env` and server cwd `.env`; Bun also auto-loads `.env`, so smoke must check env parity [VERIFIED: codebase grep; CITED: https://bun.com/docs/runtime/environment-variables]. |
| `spike/load-gen.mjs` | repo script | Fixed-concurrency `/health` + `/health/db` load | Reuse unchanged for RSS-under-load [VERIFIED: codebase grep; VERIFIED: BASELINE.md]. |
| `spike/baseline-capture.mjs` | repo script | Baseline measurement template | Adapt to accept runtime command and output Phase 5 before/after report [VERIFIED: codebase grep]. |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `bun index.js` via npm scripts | `bun run start` / `bun install` | Out of scope until Phase 6; would mix runtime migration with package-manager migration [VERIFIED: CONTEXT.md]. |
| Express on Bun | `Bun.serve()` rewrite | Increases behavioral risk and would rewrite routing/middleware; Express already boots under Bun in Phase 4 [VERIFIED: 04-VERIFICATION.md; CITED: https://bun.com/docs/runtime/nodejs-compat]. |
| Existing Stripe SDK verification | Custom HMAC implementation | Security-sensitive and unnecessary; Stripe docs recommend official library signature verification and raw body preservation [CITED: https://docs.stripe.com/webhooks?lang=node]. |
| Existing lightweight load generator | `autocannon` or new load package | New package is unnecessary; Phase 4 baseline already defines comparable method [VERIFIED: BASELINE.md]. |

**Installation:**

```bash
# No new npm packages are recommended for Phase 5.
# Bun itself must exist on the execution host before running:
bun --version
```

**Version verification performed:**

```bash
bun --version                         # 1.3.14 [VERIFIED: local shell]
node --version                        # v22.22.3 [VERIFIED: local shell]
npm --version                         # 10.9.8 [VERIFIED: local shell]
npm view express@4.21.2 version       # 4.21.2 [VERIFIED: npm registry]
npm view stripe@18.3.0 version        # 18.3.0 [VERIFIED: npm registry]
npm view mongodb@6.17.0 version       # 6.17.0 [VERIFIED: npm registry]
npm view mongodb-memory-server@11.2.0 version # 11.2.0 [VERIFIED: npm registry]
```

## Package Legitimacy Audit

Phase 5 should install no new npm packages [VERIFIED: CONTEXT.md]. The legitimacy gate was attempted for existing critical packages, but `slopcheck` was unavailable after best-effort install, so no existing package should be newly promoted as verified by slopcheck [VERIFIED: shell command].

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| `express` | npm | existing dependency | not checked | `github.com/expressjs/express` | unavailable | Approved as existing project dependency; no new install [VERIFIED: package-lock; VERIFIED: npm registry]. |
| `stripe` | npm | existing dependency | not checked | `github.com/stripe/stripe-node` | unavailable | Approved as existing project dependency; required async API verified locally [VERIFIED: installed package; VERIFIED: npm registry]. |
| `mongodb` | npm | existing dependency | not checked | `github.com/mongodb/node-mongodb-native` | unavailable | Approved as existing project dependency; Phase 4 verified under Bun [VERIFIED: 04-VERIFICATION.md; VERIFIED: npm registry]. |
| `mongodb-memory-server` | npm | existing dev dependency | not checked | `github.com/typegoose/mongodb-memory-server` | unavailable | Keep existing smoke-test use; do not add as new dep [VERIFIED: package-lock; VERIFIED: npm registry]. |

**Packages removed due to slopcheck [SLOP] verdict:** none; slopcheck unavailable [VERIFIED: shell command].
**Packages flagged as suspicious [SUS]:** none from slopcheck; `mongodb-memory-server` and transitive `@scarf/scarf` have install scripts in the existing lockfile, so avoid unnecessary fresh installs in smoke/measurement tasks [VERIFIED: package-lock grep; VERIFIED: `npm view`].

## Architecture Patterns

### System Architecture Diagram

```text
Developer / Operator
  |
  | npm --prefix server run dev
  v
server/package.json
  |
  | default path: bun --watch index.js
  | rollback path: node --watch index.js
  v
server/index.js startup
  |
  | load env -> validate MONGODB_URI/JWT_SECRET/STRIPE_SECRET_KEY
  v
initializeDatabase()
  |
  | connect + ping + create indexes
  v
Express app.listen(0.0.0.0:PORT)
  |
  +--> /health, /health/db -------------------> measurement harness
  |
  +--> /api/signin ---------------------------> JWT smoke
  |
  +--> /stripe/webhook express.raw -----------> Stripe constructEventAsync -> billing updates
  |
  +--> /api/generate-molecules --------------> auth -> requireActiveUser -> consumeSimulationToken -> no external call when NVIDIA key absent
  |
  +--> express.static(FRONTEND_DIST_PATH) ----> built client + SPA fallback
```

### Recommended Project Structure

```text
server/
├── package.json                    # swap runtime scripts and add *:node rollback scripts
├── index.js                        # Stripe constructEventAsync only; keep middleware order
└── test/
    └── runtime-smoke.test.mjs      # recommended: auth + Stripe + token smoke, runtime-parametric

spike/
├── load-gen.mjs                    # reuse unchanged
└── runtime-capture.mjs             # recommended: adapt baseline-capture for node/bun and Phase 5 report

.planning/phases/05-server-runtime-on-bun/
├── 05-RESEARCH.md
└── BUN-BEFORE-AFTER.md             # recommended output report for MEAS-02/03
```

### Pattern 1: Runtime-Parametric Server Spawn

**What:** Build smoke and measurement scripts so the runtime command is a variable, defaulting to Bun but able to run Node for rollback comparison [VERIFIED: existing `server/test/stripe-webhook.test.mjs` uses `spawn('node', ['index.js'])`].

**When to use:** Use in smoke tests and measurement capture; do not branch application logic on `process.versions.bun` unless a verified incompatibility requires it [VERIFIED: CONTEXT.md].

**Example:**

```js
// Source: server/test/stripe-webhook.test.mjs pattern + Phase 5 recommendation
const runtime = process.env.SERVER_RUNTIME || 'bun';
const child = spawn(runtime, ['index.js'], {
  cwd: SERVER_DIR,
  env: {
    ...process.env,
    MONGODB_URI: uri,
    JWT_SECRET: 'test_jwt_secret_at_least_32_chars_long_xx',
    STRIPE_SECRET_KEY: 'sk_test_dummy_key_never_calls_api',
    STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
    PORT: String(PORT),
    NODE_ENV: 'test',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
```

### Pattern 2: Keep Webhook Raw Body Before JSON Middleware

**What:** The webhook route must remain before `app.use(express.json(...))`, and it must use `express.raw({ type: 'application/json' })` [VERIFIED: codebase grep; CITED: https://docs.stripe.com/webhooks/signature?lang=node].

**When to use:** Any edit around `server/index.js` top-level middleware must preserve route order [VERIFIED: codebase grep].

**Example:**

```js
// Source: Stripe docs + installed stripe package
app.post('/stripe/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const event = await stripe.webhooks.constructEventAsync(
    req.body,
    req.headers['stripe-signature'],
    STRIPE_WEBHOOK_SECRET
  );
  // fulfill event
});

app.use(express.json({ limit: '5mb' }));
```

### Pattern 3: Cheap Token Smoke Without External Science Calls

**What:** Seed a verified active user with one token, sign in through `/api/signin`, call `/api/generate-molecules` with no `NVIDIA_MOLMIM_API_KEY`, and assert Mongo `simulationTokens` decrements from `1` to `0`; the handler returns before external NVIDIA call because the key is missing [VERIFIED: codebase grep].

**When to use:** RUN-03 smoke test; this tests auth, `requireActiveUser`, and `consumeSimulationToken` without introducing external API nondeterminism [VERIFIED: codebase grep].

**Example:**

```js
// Source: server/index.js middleware order for /api/generate-molecules
await users.insertOne({
  username: 'runtime_smoke',
  email: 'runtime-smoke@example.com',
  password: await bcrypt.hash('SmokePass1!', 10),
  verified: true,
  active: true,
  simulationTokens: 1,
  createdAt: new Date(),
});

const signin = await fetch(`${BASE}/api/signin`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'runtime_smoke', password: 'SmokePass1!' }),
});
const { token } = await signin.json();

await fetch(`${BASE}/api/generate-molecules`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
  body: JSON.stringify({ smiles: 'CCO', numMolecules: 1 }),
});
```

### Anti-Patterns to Avoid

- **Converting npm scripts to `bun run`:** This violates Phase 5 scope; Phase 6 owns Bun package-manager/script-runner migration [VERIFIED: CONTEXT.md].
- **Using Phase 4 standalone Stripe spike as RUN-03 proof:** It does not exercise Express raw body or HTTP route behavior [VERIFIED: CONTEXT.md].
- **Measuring `process.memoryUsage().rss`:** Phase 4 baseline used Linux `VmRSS`; app-level runtime memory APIs are not the comparator [VERIFIED: BASELINE.md].
- **Calling external science services in smoke tests:** External services add nondeterminism and are not needed to prove token middleware [VERIFIED: BASELINE.md; VERIFIED: codebase grep].
- **Replacing Express with `Bun.serve()`:** Runtime migration should preserve app behavior and middleware semantics [VERIFIED: CONTEXT.md].

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Stripe webhook verification | Custom HMAC/timestamp parsing | `stripe.webhooks.constructEventAsync()` | Stripe docs require raw body/signature verification and official SDK handles edge cases [CITED: https://docs.stripe.com/webhooks?lang=node; VERIFIED: installed stripe package]. |
| Dev reload | Custom file watcher/nodemon wrapper | `bun --watch index.js` | Bun watch mode hard-restarts on imported file changes and preserves args/env [CITED: https://bun.com/docs/runtime/watch-mode]. |
| Load testing | New load package or shell curl loop | `spike/load-gen.mjs` | Baseline already uses this exact deterministic method [VERIFIED: BASELINE.md]. |
| RSS measurement | Runtime heap APIs | `/proc/<pid>/status` `VmRSS` | Baseline comparator is OS RSS boundary [VERIFIED: BASELINE.md]. |
| Auth bypass for smoke | Minting JWT manually only | Real `/api/signin` against seeded Mongo user | RUN-03 requires middleware/routes behave identically [VERIFIED: REQUIREMENTS.md; VERIFIED: codebase grep]. |
| Token decrement shortcut | Directly calling middleware | HTTP call to a route using `consumeSimulationToken` | Proves Express middleware chain and Mongo update [VERIFIED: codebase grep]. |

**Key insight:** Phase 5 is a behavioral equivalence phase. Every shortcut that bypasses Express, Mongo, or the real route order reduces confidence and should be rejected unless it is only a supporting unit check [VERIFIED: REQUIREMENTS.md].

## Runtime State Inventory

| Category | Items Found | Action Required |
|----------|-------------|-----------------|
| Stored data | Mongo stores users, billing events, audit logs, companies; runtime migration does not rename keys or collections [VERIFIED: codebase grep]. | No data migration. Smoke tests should use isolated DB names or `mongodb-memory-server` [VERIFIED: server test]. |
| Live service config | Oracle runs Docker containers including `medsaas-app-1` and `medsaas-mongo-1`; host noninteractive PATH lacks `bun`, `node`, and `npm` [VERIFIED: SSH probe]. | Planner must choose an execution path: install/activate Bun on host, or run measurement/smoke in an isolated runtime container while keeping Phase 7 production image work out of scope [VERIFIED: CONTEXT.md]. |
| OS-registered state | No launchd/systemd/pm2 registration was found in repo; deployment currently uses Docker Compose assets [VERIFIED: file scan; VERIFIED: `.planning/PROJECT.md`]. | No OS registration edit in Phase 5 unless execution discovers a live service manager outside git [ASSUMED]. |
| Secrets/env vars | Required runtime envs are `MONGODB_URI`, `JWT_SECRET`, `STRIPE_SECRET_KEY`; webhook needs `STRIPE_WEBHOOK_SECRET` for payment fulfillment [VERIFIED: codebase grep]. | Preserve names. Smoke/measurement must inject test-safe values and never commit secrets [VERIFIED: codebase grep]. |
| Build artifacts | `client/dist` must exist for `start:unified` to serve frontend; server uses `server/node_modules` from npm lockfile [VERIFIED: codebase grep; VERIFIED: package-lock]. | Plan should run `npm run build` before production smoke, and avoid deleting `server/node_modules` unless intentionally measuring install in another phase [VERIFIED: CONTEXT.md]. |

**Nothing found in category:** No repo evidence of runtime strings embedded in OS task registrations was found; this is low-confidence because live server manager state outside git was not inspected beyond SSH PATH/Docker probes [ASSUMED].

## Common Pitfalls

### Pitfall 1: Stripe Sync Verification Fails Under Bun

**What goes wrong:** `stripe.webhooks.constructEvent()` throws under Bun's async-only WebCrypto provider [VERIFIED: installed stripe package; VERIFIED: spike/STRIPE-HANDOFF.md].
**Why it happens:** The installed Stripe `SubtleCryptoProvider` throws from synchronous HMAC and the SDK message says to use `await constructEventAsync(...)` [VERIFIED: installed `stripe/esm/crypto/SubtleCryptoProvider.js`; VERIFIED: installed `stripe/esm/Webhooks.js`].
**How to avoid:** Replace only the webhook verification call with `await stripe.webhooks.constructEventAsync(...)` and keep the route async [VERIFIED: installed `stripe/types/Webhooks.d.ts`].
**Warning signs:** Bun smoke returns 400 for valid signed webhook or logs `SubtleCryptoProvider cannot be used in a synchronous context` [VERIFIED: spike/STRIPE-HANDOFF.md].

### Pitfall 2: Losing Raw Body Integrity

**What goes wrong:** Stripe signature verification fails if JSON middleware parses or mutates the request body before verification [CITED: https://docs.stripe.com/webhooks/signature?lang=node].
**Why it happens:** Express middleware order matters, and `express.json()` before the webhook consumes the original raw body [CITED: https://docs.stripe.com/webhooks/signature?lang=node].
**How to avoid:** Keep `/stripe/webhook` above `app.use(express.json(...))` and keep `express.raw({ type: 'application/json' })` on the route [VERIFIED: codebase grep; CITED: https://docs.stripe.com/webhooks?lang=node].
**Warning signs:** Valid generated test headers fail, while unsigned or parsed payloads appear to work only if verification is accidentally bypassed [CITED: https://docs.stripe.com/webhooks?lang=node].

### Pitfall 3: Bun `.env` Auto-Loading Masks Env Parity

**What goes wrong:** Bun automatically loads `.env` files while the app also calls `dotenv`, so local success can hide missing production env injection [CITED: https://bun.com/docs/runtime/environment-variables; VERIFIED: codebase grep].
**Why it happens:** Bun reads `.env`, mode-specific `.env`, and `.env.local` automatically; this app also explicitly loads root `.env` and cwd `.env` [CITED: https://bun.com/docs/runtime/environment-variables; VERIFIED: codebase grep].
**How to avoid:** In smoke/measurement, pass explicit env values and assert startup fails when required values are missing; production can use `--no-env-file` only if deployment env is fully explicit [CITED: https://bun.com/docs/runtime/environment-variables].
**Warning signs:** Server starts locally but fails on Oracle or in a container because required envs are absent [VERIFIED: codebase grep].

### Pitfall 4: Invalid Before/After Measurement

**What goes wrong:** Bun appears better or worse due to host/container boundary, endpoint mix, or measurement method changes [VERIFIED: BASELINE.md].
**Why it happens:** Phase 4 baseline defines a specific method: Oracle host, Node 22.22.3 in `node:22-slim` arm64 container, N=5, `/proc/<pid>/status` `VmRSS`, `/health` + `/health/db`, concurrency 20, duration 30s [VERIFIED: BASELINE.md].
**How to avoid:** Change only the server runtime, keep `spike/load-gen.mjs` unchanged, report all samples, and include a Node back-to-back sanity run if the Bun delta is within Phase 4 sample noise [VERIFIED: CONTEXT.md; VERIFIED: BASELINE.md].
**Warning signs:** Report has medians only, uses `/api` routes with external calls, or compares local macOS Bun to Oracle Node [VERIFIED: CONTEXT.md].

### Pitfall 5: Host Runtime Availability Assumptions

**What goes wrong:** Plans assume `bun`, `node`, or `npm` exists on Oracle host PATH, but noninteractive SSH showed only Docker available [VERIFIED: SSH probe].
**Why it happens:** Phase 4 used isolated bundles/containers on Oracle rather than relying on host-level runtimes [VERIFIED: 04-VERIFICATION.md].
**How to avoid:** Planner must include a Wave 0 environment step to make Bun available on the actual execution path, or explicitly run smoke/measurement in a container as a harness [VERIFIED: SSH probe; VERIFIED: CONTEXT.md].
**Warning signs:** `ssh oracle 'bun --version'` prints nothing, or production smoke cannot spawn `bun` [VERIFIED: SSH probe].

## Code Examples

### Package Script Shape

```json
{
  "scripts": {
    "start": "bun index.js",
    "start:node": "node index.js",
    "dev": "bun --watch index.js",
    "dev:node": "node --watch index.js",
    "start:unified": "FRONTEND_DIST=../client/dist bun index.js",
    "start:unified:node": "FRONTEND_DIST=../client/dist node index.js"
  }
}
```

Source: locked Phase 5 decisions and current `server/package.json` [VERIFIED: CONTEXT.md; VERIFIED: codebase grep].

### Runtime Measurement Spawn

```js
const runtime = args.get("runtime") || process.env.SERVER_RUNTIME || "bun";
const child = spawn(runtime, ["index.js"], {
  cwd: serverDir,
  env,
  stdio: ["ignore", "pipe", "pipe"],
});
```

Source: adapt `spike/baseline-capture.mjs` spawn pattern [VERIFIED: codebase grep].

### Startup Gate Poll

```js
const started = performance.now();
while (Date.now() < deadline) {
  const response = await fetch(`${baseUrl}/health`);
  if (response.status === 200) {
    return { child, startupMs: performance.now() - started };
  }
  await sleep(250);
}
```

Source: existing baseline capture startup measurement [VERIFIED: codebase grep].

### Stripe Async Verification

```js
event = await stripe.webhooks.constructEventAsync(
  req.body,
  req.headers['stripe-signature'],
  STRIPE_WEBHOOK_SECRET
);
```

Source: `spike/STRIPE-HANDOFF.md`, installed Stripe SDK types, and Stripe raw-body docs [VERIFIED: spike/STRIPE-HANDOFF.md; VERIFIED: installed stripe package; CITED: https://docs.stripe.com/webhooks?lang=node].

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Node runtime for Express API | Bun runtime for server process with Node fallback | Phase 5 target, 2026-06-04 | Runtime binary changes while app architecture stays Express [VERIFIED: CONTEXT.md]. |
| Synchronous Stripe webhook verification | `constructEventAsync()` | Required by Bun compatibility discovered in Phase 4 | Keeps one code path for Node and Bun [VERIFIED: spike/STRIPE-HANDOFF.md; VERIFIED: installed stripe package]. |
| `node --watch index.js` dev API | `bun --watch index.js` | Phase 5 target | Bun hard-restarts process on imported file changes [CITED: https://bun.com/docs/runtime/watch-mode]. |
| Baseline-only Node report | Bun before/after report against Node baseline | MEAS-02/03 | Runtime decision becomes data-gated rather than belief-based [VERIFIED: REQUIREMENTS.md]. |

**Deprecated/outdated:**
- Treating Phase 4 CMPT-04 as webhook production proof is invalid for Phase 5 because it bypassed Express and HTTP raw-body parsing [VERIFIED: CONTEXT.md].
- Using `createNodeCryptoProvider()` as a Bun Stripe workaround is invalid because installed Stripe Web platform functions throw when that provider is requested outside Node [VERIFIED: installed stripe package].

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | No live OS service manager outside git embeds Node-specific commands. | Runtime State Inventory | A deployed process manager could still run Node after scripts change; planner should inspect live deploy state if Phase 5 touches production service registration. |
| A2 | `/api/generate-molecules` is acceptable as the cheap token endpoint even though the expected HTTP response may be 500 when `NVIDIA_MOLMIM_API_KEY` is absent. | Architecture Patterns | Planner may prefer a cleaner endpoint; requirement is token decrement/no external call, so assert DB side effect rather than HTTP 200. |

## Open Questions

1. **Should Phase 5 install Bun on Oracle host, or run smoke/measurement in a harness container?**
   - What we know: Oracle noninteractive PATH has Docker but not Bun/Node/npm; local machine has Bun 1.3.14 [VERIFIED: SSH probe; VERIFIED: local shell].
   - What's unclear: Whether production host has runtime managers available in interactive shell/profile files or whether Phase 5 should deliberately install Bun [ASSUMED].
   - Recommendation: Add a Wave 0 environment task; fail closed if `ssh oracle 'bun --version'` cannot be made explicit.

2. **Where should the before/after report live?**
   - What we know: Phase 4 baseline is `.planning/phases/04-compatibility-spike-baseline/BASELINE.md` [VERIFIED: file read].
   - What's unclear: No Phase 5 report filename is locked [VERIFIED: CONTEXT.md].
   - Recommendation: Use `.planning/phases/05-server-runtime-on-bun/BUN-BEFORE-AFTER.md` so MEAS-02/03 evidence sits with the phase.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|-------------|-----------|---------|----------|
| Bun local | Dev smoke, script validation | yes | 1.3.14 | Oracle/container execution if local is not target [VERIFIED: local shell]. |
| Node local | Rollback scripts, syntax checks | yes | 22.22.3 | None needed [VERIFIED: local shell]. |
| npm local | Phase 5 script runner | yes | 10.9.8 | None needed [VERIFIED: local shell]. |
| Docker local | Container harness | no | unavailable | Use `ssh oracle` Docker path [VERIFIED: local shell]. |
| SSH `oracle` | Phase 4-style host validation | yes | OpenSSH available locally | Local-only checks for non-host-specific tasks [VERIFIED: local shell]. |
| Docker on Oracle | Harness/service execution | yes | 29.2.1 | Install host Bun if avoiding containers [VERIFIED: SSH probe]. |
| Bun on Oracle host PATH | Production/smoke if host-run | no | unavailable | Install/activate Bun or use container harness [VERIFIED: SSH probe]. |
| Node/npm on Oracle host PATH | Node fallback if host-run | no | unavailable | Install/activate Node or use existing Docker image path [VERIFIED: SSH probe]. |
| MongoDB | Server startup and smoke | yes via Docker on Oracle; local service not checked | Oracle containers present | `mongodb-memory-server` for smoke [VERIFIED: SSH probe; VERIFIED: server test]. |

**Missing dependencies with no fallback:**
- None if planner uses Oracle Docker or installs explicit host runtimes first [VERIFIED: SSH probe].

**Missing dependencies with fallback:**
- Local Docker missing; use Oracle Docker as Phase 4 did [VERIFIED: local shell; VERIFIED: 04-VERIFICATION.md].
- Oracle host Bun/Node/npm missing from noninteractive PATH; use explicit install/profile activation or a runtime container harness [VERIFIED: SSH probe].

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|------------------|
| V2 Authentication | yes | Keep `/api/signin` bcrypt/JWT flow and smoke it through HTTP [VERIFIED: codebase grep]. |
| V3 Session Management | yes | JWT issuance/verification remains through `jsonwebtoken`; no cookie/session rewrite in Phase 5 [VERIFIED: codebase grep]. |
| V4 Access Control | yes | Preserve `authenticateToken`, `requireActiveUser`, and token middleware order [VERIFIED: codebase grep]. |
| V5 Input Validation | yes | Preserve Express JSON limits and route-level validation; do not weaken webhook raw-body route [VERIFIED: codebase grep]. |
| V6 Cryptography | yes | Use Stripe SDK `constructEventAsync`, bcryptjs, jsonwebtoken; do not hand-roll HMAC/JWT/password logic [VERIFIED: installed stripe package; VERIFIED: codebase grep]. |
| V10 Malicious Code | yes | No new packages; slopcheck unavailable, so avoid expanding dependency surface [VERIFIED: package audit attempt]. |

### Known Threat Patterns for Runtime Migration

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Webhook signature bypass during async migration | Spoofing / Tampering | Positive and negative signed webhook tests through real Express route [CITED: https://docs.stripe.com/webhooks?lang=node; VERIFIED: server test]. |
| Raw body mutation by middleware reorder | Tampering | Keep webhook route before `express.json()` [CITED: https://docs.stripe.com/webhooks/signature?lang=node; VERIFIED: codebase grep]. |
| Env mismatch between Node and Bun | Tampering / Availability | Explicit env injection in smoke/measurement and startup failure tests for required envs [VERIFIED: codebase grep; CITED: https://bun.com/docs/runtime/environment-variables]. |
| Rollback path rot | Availability | Execute both Bun smoke and Node fallback smoke before final gate [VERIFIED: CONTEXT.md]. |
| Measurement-driven unsafe default flip | Availability | Report per-sample distributions and compare against Phase 4 median idle RSS [VERIFIED: CONTEXT.md; VERIFIED: BASELINE.md]. |

## Sources

### Primary (HIGH confidence)
- `.planning/phases/05-server-runtime-on-bun/05-CONTEXT.md` - locked Phase 5 decisions and boundaries [VERIFIED: file read].
- `.planning/REQUIREMENTS.md` - RUN-01..04, MEAS-02..03 definitions [VERIFIED: file read].
- `.planning/phases/04-compatibility-spike-baseline/BASELINE.md` - Node baseline numbers and method [VERIFIED: file read].
- `.planning/phases/04-compatibility-spike-baseline/04-VERIFICATION.md` - Phase 4 proof status [VERIFIED: file read].
- `server/index.js`, `server/package.json`, `server/test/stripe-webhook.test.mjs`, `spike/load-gen.mjs`, `spike/baseline-capture.mjs`, `spike/STRIPE-HANDOFF.md` - codebase runtime and test touch points [VERIFIED: codebase grep].
- Installed Stripe SDK files under `server/node_modules/stripe` - `constructEventAsync` and sync SubtleCrypto failure behavior [VERIFIED: installed package].

### Secondary (MEDIUM-HIGH confidence)
- Bun Watch Mode docs - `--watch` hard restart behavior and `--hot` distinction: https://bun.com/docs/runtime/watch-mode [CITED].
- Bun Environment Variables docs - automatic `.env` loading and `--no-env-file`: https://bun.com/docs/runtime/environment-variables [CITED].
- Bun Node.js Compatibility docs - Express/npm package compatibility and Node built-in status: https://bun.com/docs/runtime/nodejs-compat [CITED].
- Stripe Webhook docs - raw body requirement and Express middleware ordering: https://docs.stripe.com/webhooks?lang=node and https://docs.stripe.com/webhooks/signature?lang=node [CITED].
- Express static/API docs - `express.static`, `express.raw`, and Express 4 API surface: https://expressjs.com/en/starter/static-files/ and https://expressjs.com/en/4x/api/ [CITED].
- MongoDB Node.js driver docs - official driver context: https://www.mongodb.com/docs/drivers/node/current/ [CITED].
- npm registry lookups for existing dependencies [VERIFIED: npm registry].

### Tertiary (LOW confidence)
- None used as authoritative input.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - derived from lockfiles, npm registry, official docs, and Phase 4 verification [VERIFIED: package-lock; VERIFIED: npm registry; CITED: official docs].
- Architecture: HIGH - exact routes, middleware, and scripts were inspected in code [VERIFIED: codebase grep].
- Pitfalls: HIGH for Stripe/raw-body/measurement; MEDIUM for Oracle host runtime availability because only noninteractive SSH PATH was checked [VERIFIED: installed package; VERIFIED: SSH probe].
- Security: HIGH for webhook/auth/token controls; LOW for external live service manager state not represented in git [VERIFIED: codebase grep; ASSUMED].

**Research date:** 2026-06-04
**Valid until:** 2026-07-04 for codebase findings; 2026-06-11 for Bun/Stripe runtime compatibility if either version is upgraded [ASSUMED].
