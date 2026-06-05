---
last_mapped_commit: 1a703a98234dd0b9b66866ec31d4d9a1a6455b55
---

# Testing Patterns

**Analysis Date:** 2026-06-05

## Test Framework

**Runner:**
- Custom Node `.mjs` smoke/integration harnesses.
- Config: Not detected. There is no tracked Jest, Vitest, or Playwright config.
- Project test files: `server/test/stripe-webhook.test.mjs`, `server/test/runtime-smoke.test.mjs`, `server/test/runtime-watch-smoke.mjs`.

**Assertion Library:**
- No external assertion library is used.
- Tests use a local `check(label, cond, extra = '')` helper that increments `passed`/`failed` counters and exits with `process.exit(failed === 0 ? 0 : 1)`.

**Run Commands:**
```bash
npm --prefix server run test:stripe          # Run Stripe webhook integration smoke via Node
npm --prefix server run test:runtime-smoke   # Run runtime parity smoke via Node script runner
npm --prefix server run test:runtime-watch   # Run Bun watch reload smoke
npm run test:brand                           # Run retired-brand regression guard
npm run check                                # Syntax-check server and build client
```

**Bun and npm paths:**
```bash
bun run install:all                          # Default Phase 6 install path
npm run install:all:node                     # npm fallback install path
bun run dev                                  # Default Phase 6 dev path: Bun API runtime + Vite client
npm run dev:node                             # Node/npm fallback dev path
bun run build                                # Default Phase 6 client build invocation through Bun
npm run build:node                           # npm fallback client build
```
- Phase 5 made the Express API run under Bun by default and added runtime smoke coverage.
- Phase 6 made Bun the default package runner while preserving npm fallback scripts and dual lockfiles.
- Docker, CI, `check`, `test:brand`, `test:stripe`, and broader test/check migration to Bun remain Phase 7 scope. Keep current Node-based test commands intact until that phase changes them.

## Test File Organization

**Location:**
- Server integration/smoke tests live under `server/test/`.
- Root executable regression scripts live under `scripts/`, currently `scripts/check-brand.mjs` and `scripts/ensure-dev.mjs`.
- Spike and measurement harnesses live under `spike/` and planning phase directories, not under the production test suite: `spike/load-gen.mjs`, `spike/baseline-capture.mjs`.
- No client test files are tracked under `client/src`.

**Naming:**
- Use `*.test.mjs` for server smoke tests that can be invoked as test scripts: `server/test/runtime-smoke.test.mjs`, `server/test/stripe-webhook.test.mjs`.
- Use descriptive `*-smoke.mjs` for special executable harnesses that are not conventional unit suites: `server/test/runtime-watch-smoke.mjs`.
- Use verb-oriented names for root scripts: `scripts/check-brand.mjs`, `scripts/ensure-dev.mjs`.

**Structure:**
```text
server/test/
├── runtime-smoke.test.mjs        # Phase 5 runtime parity smoke: auth, Stripe, token use, static serving
├── runtime-watch-smoke.mjs       # Phase 5 Bun --watch reload smoke
└── stripe-webhook.test.mjs       # Stripe payment-to-credit integration smoke

scripts/
├── check-brand.mjs               # Brand regression guard
└── ensure-dev.mjs                # Dev environment helper
```

## Test Structure

**Suite Organization:**
```javascript
let passed = 0;
let failed = 0;
function check(label, cond, extra = '') {
  if (cond) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.log(`  ✗ ${label} ${extra}`);
    failed++;
  }
}

async function main() {
  // arrange: start dependencies and server
  // act: call real HTTP endpoints
  // assert: call check(...) for each behavior
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('Test harness error:', err);
  process.exit(1);
});
```

**Patterns:**
- Boot the real `server/index.js` process with `spawn(...)` instead of importing route handlers directly: `server/test/stripe-webhook.test.mjs`, `server/test/runtime-smoke.test.mjs`.
- Poll `/health` with a timeout before assertions to avoid racing server startup: `waitForHealth` in `server/test/runtime-smoke.test.mjs`.
- Use deterministic local ports per harness to avoid clashes: `3199` in `server/test/stripe-webhook.test.mjs`, `3201` in `server/test/runtime-smoke.test.mjs`, `3202` in `server/test/runtime-watch-smoke.mjs`.
- Capture child process stdout/stderr into `serverLog` and print it only on startup/reload failure: `server/test/runtime-smoke.test.mjs`, `server/test/runtime-watch-smoke.mjs`.
- Always clean up child processes and in-memory MongoDB in `finally`: `cleanup` helpers in all `server/test/*.mjs` harnesses.

## Mocking

**Framework:** Manual process/environment/data setup. No Jest/Vitest mocking framework is detected.

**Patterns:**
```javascript
const child = spawn(runtimeBin, ['index.js'], {
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

**What to Mock:**
- Use `mongodb-memory-server` for database isolation in server integration tests: `server/test/stripe-webhook.test.mjs`, `server/test/runtime-smoke.test.mjs`, `server/test/runtime-watch-smoke.mjs`.
- Use Stripe SDK test-signing helpers to generate valid and forged webhook signatures without contacting Stripe: `stripe.webhooks.generateTestHeaderString(...)` in `server/test/stripe-webhook.test.mjs`.
- Override runtime env vars in the child process to prevent real external calls and secret leakage: dummy Stripe keys and blank `NVIDIA_MOLMIM_API_KEY` in `server/test/runtime-smoke.test.mjs`.
- Seed MongoDB collections directly with known user/billing states before calling live routes: `users.insertOne(...)` in `server/test/runtime-smoke.test.mjs`.

**What NOT to Mock:**
- Do not mock the Express server, webhook route, or request body parser in runtime smoke tests. Phase 5 specifically requires the real `express.raw()` Stripe webhook path in `server/index.js`.
- Do not call real Stripe, NVIDIA, science, RabbitMQ, or remote molecule services in smoke tests. Use env overrides or cheap failure paths as in `server/test/runtime-smoke.test.mjs`.
- Do not replace `bun --watch` with a fake reload signal for the watch smoke; the harness must spawn Bun and observe restart behavior through logs/health in `server/test/runtime-watch-smoke.mjs`.

## Fixtures and Factories

**Test Data:**
```javascript
const user = {
  username: 'webhooktest',
  email: 'webhooktest@example.com',
  companyId: 'comp_test',
  role: 'member',
  status: 'active',
  simulationTokens: 5,
  createdAt: new Date(),
};
await users.insertOne(user);
```

**Location:**
- Fixtures are inline in each smoke harness rather than shared fixture files.
- Stripe event factory logic is local to `buildEvent(...)` in `server/test/stripe-webhook.test.mjs`.
- Runtime smoke user fixtures are inline in `server/test/runtime-smoke.test.mjs`, including a bcrypt-hashed password for `/api/signin`.

## Coverage

**Requirements:** None enforced by tooling. There is no coverage threshold or coverage command in tracked package scripts.

**View Coverage:**
```bash
# Not available: no coverage tool is configured.
```

## Test Types

**Unit Tests:**
- Not detected. No tracked source-adjacent unit tests exist under `client/src` or `server/`.
- Future unit tests should not replace the current smoke harnesses for runtime-critical behavior; keep the live-process tests for Bun/Node parity.

**Integration Tests:**
- `server/test/stripe-webhook.test.mjs` validates the live payment-to-credit path with real Express, real MongoDB driver against in-memory MongoDB, signed Stripe payloads, idempotency, and forged-signature rejection.
- `server/test/runtime-smoke.test.mjs` validates Phase 5 runtime parity for auth login, `/health`, `/health/db`, Stripe webhook signature/credit grant, token consumption on `/api/generate-molecules`, and optional static frontend serving via `--assert-static`.
- `server/test/runtime-watch-smoke.mjs` validates Bun dev watch startup and restart after a content-preserving rewrite of `server/config/branding.js`.

**E2E Tests:**
- Not used. No browser E2E framework is configured.
- Client behavior is currently guarded indirectly by `npm --prefix client run build` in root `npm run check`.

## Common Patterns

**Async Testing:**
```javascript
async function waitForHealth(timeoutMs = 40000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/health`);
      if (res.ok) return true;
    } catch {
      // server not up yet
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}
```

**Error Testing:**
```javascript
const forgedHeader = stripe.webhooks.generateTestHeaderString({
  payload,
  secret: 'whsec_wrong_secret',
});
const forgedRes = await fetch(`${BASE}/stripe/webhook`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Stripe-Signature': forgedHeader },
  body: payload,
});
check('forged signature returns 400', forgedRes.status === 400, `(got ${forgedRes.status})`);
```

**Runtime Matrix Testing:**
```bash
SERVER_RUNTIME=node npm --prefix server run test:runtime-smoke
SERVER_RUNTIME=bun npm --prefix server run test:runtime-smoke
npm run build && FRONTEND_DIST=../client/dist SERVER_RUNTIME=bun npm --prefix server run test:runtime-smoke -- --assert-static
```

**Brand Regression Testing:**
```bash
npm run test:brand
```
- `scripts/check-brand.mjs` recursively scans text-like files, excludes generated/build/secret-prone paths, and fails if the retired brand appears.

---

*Testing analysis: 2026-06-05*
