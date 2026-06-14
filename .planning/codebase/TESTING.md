# Testing Patterns

**Analysis Date:** 2026-06-14

## Test Framework

**Runner:**
- **No test framework** (no Jest, Vitest, Mocha)
- Tests are **integration-style Node.js scripts** (`.mjs`) that spawn the real server against ephemeral MongoDB
- No assertion library; assertions are hand-rolled `check(label, condition, extra)` helper function
- Each test is independent; no test runner aggregates them

**Server Test Scripts:**
- `npm --prefix server run test:stripe` — Stripe webhook integration (payment → credits flow)
- `npm --prefix server run test:stripe:bun` — same with Bun runtime
- `npm --prefix server run test:stripe:node` — same with Node runtime
- `npm --prefix server run test:branding` — company branding, email theming, logo upload
- `npm --prefix server run test:branding:bun` — same with Bun runtime
- `npm --prefix server run test:branding:node` — same with Node runtime
- `npm --prefix server run test:runtime-smoke` — auth, Stripe, token consumption, static serving under both Bun/Node
- `npm --prefix server run test:runtime-watch` — smoke tests in watch mode (file at `server/test/runtime-watch-smoke.mjs`)

**No Unified Test Command:**
- No `npm test` aggregates all tests
- Tests must be run individually or via `npm run test:stripe && npm run test:branding && npm run test:runtime-smoke`
- `npm run check` (root level) is a **syntax check only**: `bun build server/index.js --target=bun` + `bun --cwd=client run build` — runs zero tests

**Client Tests:**
- **Zero test files** in `client/src/` or project structure
- Client is built but not tested; no client test suite exists

## Test File Organization

**Location:**
- `server/test/*.test.mjs` — integration tests that spawn real server
- `server/test/*.mjs` — helper/smoke test files (not all have `.test.` in name)
- No tests in `client/src/`

**Naming:**
- `.test.mjs` or just `.mjs` (e.g., `stripe-webhook.test.mjs`, `runtime-watch-smoke.mjs`)
- All use `.mjs` (ESM files); tests are not bundled or transpiled

**Files:**
- `server/test/stripe-webhook.test.mjs` — 182 lines, integration test
- `server/test/branding.test.mjs` — 400+ lines, company branding + email theming
- `server/test/runtime-smoke.test.mjs` — runtime parity test under Bun/Node
- `server/test/runtime-watch-smoke.mjs` — watch mode variant (no npm script)
- `server/test/email-theming.test.mjs` — exists but has no npm script entry

## Test Structure

**Pattern: Spawn Real Server + Ephemeral MongoDB**

Each test file follows this flow:

```javascript
import { spawn } from 'node:child_process';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { MongoClient } from 'mongodb';

// 1. Create in-memory MongoDB
const mem = await MongoMemoryServer.create();
const uri = mem.getUri(DB_NAME);

// 2. Spawn real server (index.js) against ephemeral DB
const child = spawn(runtimeBin, ['index.js'], {
  cwd: SERVER_DIR,
  env: {
    ...process.env,
    MONGODB_URI: uri,
    JWT_SECRET: 'test_jwt_secret_at_least_32_chars_long_xx',
    STRIPE_SECRET_KEY: 'sk_test_dummy_key_never_calls_api',
    PORT: String(PORT),
    NODE_ENV: 'test'
  }
});

// 3. Wait for server health
const healthy = await waitForHealth();

// 4. Run assertions via hand-rolled check() function
const r1 = await postEvent(event);
check('webhook returns 200', r1.status === 200);

// 5. Verify database state directly
const user = await users.findOne({ username: '...' });
check('credits granted', user.simulationTokens === 55);

// 6. Cleanup
child.kill('SIGKILL');
await mem.stop();
```

**Assertion Helper:**

```javascript
let passed = 0;
let failed = 0;
function check(label, condition, extra = '') {
  if (condition) {
    console.log(`  ✓ ${label}`);          // stripe-webhook style
    // or
    console.log(`  PASS ${label}`);        // branding style (inconsistent)
    passed++;
  } else {
    console.log(`  ✗ ${label} ${extra}`); // stripe-webhook style
    // or
    console.log(`  FAIL ${label} ${extra}`); // branding style
    failed++;
  }
}
// Final report: `Result: N passed, M failed`
```

Style is **mixed**: `stripe-webhook` uses `✓/✗` emoji, `branding` uses `PASS/FAIL` text.

## Mocking

**Strategy:** No mocking framework; tests use real implementations against real ephemeral MongoDB.

**What's real:**
- Full `server/index.js` startup (DB connection, indexes, middleware chain, routes)
- Real MongoDB via `mongodb-memory-server` (in-memory, no external service needed)
- Real Stripe signature verification (uses test key to sign webhook events)
- Real bcrypt password hashing (test user creation uses actual `bcrypt.hash()`)

**What's stubbed:**
- External API calls: dummy keys (e.g., `sk_test_dummy_key_never_calls_api`) prevent actual Stripe/NVIDIA calls
- STRIPE_WEBHOOK_SECRET: set to test value in env (`whsec_localtest_do_not_use_in_prod`)
- PORT: overridden to non-standard test port (3199, 3204, 3201) to avoid conflicts

**What to NOT Mock:**
- Database operations — use real ephemeral MongoDB; validates persistence/queries
- Middleware chain — run through real `authenticateToken`, `requireActiveUser`, etc.
- Request/response cycle — use real HTTP via `fetch()`
- Cryptographic operations — test real bcrypt and JWT signing

**What's Omitted (Not Tested):**
- RabbitMQ integration (no ADMET worker queue in tests)
- External scientific APIs (MolMIM, OpenFold3, Tanimoto) — these routes require valid API keys; tests skip them
- Email delivery (Nodemailer/Titan) — no email capture in tests
- Stripe payment delivery — webhook testing delivers properly-signed fake events, not real Stripe calls

## Fixtures and Factories

**Test Data:**

Stripe webhook test (`:127-142` in `stripe-webhook.test.mjs`):

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

const sessionId = `cs_test_${Date.now()}`;
const event = buildEvent(sessionId, {
  username: 'webhooktest',
  companyId: 'comp_test',
  credits: 50,
  plan: 'Standard'
});
```

Branding test (`:22-23` in `branding.test.mjs`):

```javascript
const PASSWORD = 'BrandingPass1!';
const COMPANY_A = 'company_brand_a';
const DEFAULT_PRIMARY = '#B4B239';
```

**Location:** Data is defined inline in test files; no shared fixtures directory.

**Factories:** Helper functions generate test data (e.g., `buildEvent(sessionId, metadata)` creates a Stripe event with metadata).

## Coverage

**Requirements:** None enforced

**Current State:**
- **No coverage tool** (no Istanbul, no C8)
- **Integration tests cover happy paths:** payment flow (stripe-webhook), branding CRUD, auth & token consumption (runtime-smoke)
- **Many areas untested:** client code, most API endpoints, error paths, edge cases

## Test Types

**Integration Tests:**

All server tests are integration-style — they start the real server and test end-to-end flows:

- **Stripe webhook** (`stripe-webhook.test.mjs`): Signs a fake event, POSTs to `/stripe/webhook`, verifies credits granted in DB
- **Branding** (`branding.test.mjs`): Signs up users, updates company branding (logo, palette), verifies email theming generation
- **Runtime smoke** (`runtime-smoke.test.mjs`): Auth (signup/signin), token consumption, Stripe webhook idempotency, static file serving under both Bun/Node

Scope: Full request/response cycle with real middleware and database.

**Unit Tests:**
- None present

**E2E Tests:**
- None present

**Client Tests:**
- None present

## Common Patterns

**Async Testing:**

All tests are async; use `await` throughout and wrap main logic in `async function main()`:

```javascript
async function main() {
  // Setup
  const mem = await MongoMemoryServer.create();
  const uri = mem.getUri(DB_NAME);
  
  // Execute
  const response = await fetch(url, { method, headers, body });
  
  // Verify
  const data = await response.json();
  check('response ok', response.ok);
  
  // Cleanup
  await mem.stop();
}

main().catch((err) => {
  console.error('Test harness error:', err);
  process.exit(1);
});
```

**Error Testing:**

Error paths verified by checking HTTP status codes and response bodies:

```javascript
// Forged signature test
const forged = await postEvent(buildEvent(...), { secret: 'whsec_wrong_secret' });
check('bad signature returns 400', forged.status === 400);

// Token insufficient test
check('no tokens left returns 403', afterDepleted.simulationTokens === 0);
```

No explicit `try-catch` for expected errors; status code checks suffice.

**Idempotency Testing:**

Stripe test verifies idempotency by replaying the same event and checking no double-grant occurs (`:155-159` stripe-webhook.test.mjs):

```javascript
console.log('\nTest 2 — replaying the same event does NOT double-grant (idempotent):');
const r2 = await postEvent(event);
check('replay returns 200', r2.status === 200);
const afterReplay = await users.findOne({ username: 'webhooktest' });
check('credits stay at 55 (no double grant)', afterReplay.simulationTokens === 55);
```

**Database State Verification:**

Tests verify database state directly via MongoClient:

```javascript
const users = mongo.db(DB_NAME).collection('users');
const afterFirst = await users.findOne({ username: 'webhooktest' });
check('credits 5 -> 55 (granted 50)', afterFirst.simulationTokens === 55);
const be = await billing.findOne({ stripeSessionId: sessionId });
check('billing_events row marked fulfilled', be?.status === 'fulfilled');
```

## Runtime Parity Testing

`runtime-smoke.test.mjs` (`:1-9`) explicitly tests feature parity under Bun and Node:

**Purpose:** Prove RUN-03 and RUN-02 (Bun migration phases) under both runtimes.

**Usage:**

```bash
SERVER_RUNTIME=node npm --prefix server run test:runtime-smoke
SERVER_RUNTIME=bun  npm --prefix server run test:runtime-smoke

# With static file serving (requires build)
npm run build && FRONTEND_DIST=../client/dist SERVER_RUNTIME=bun \
  npm --prefix server run test:runtime-smoke -- --assert-static
```

**Flags:**
- `--assert-static`: Verifies static frontend serving from `FRONTEND_DIST`

**Tested Features:**
- Authentication (signup, signin, JWT validation)
- Stripe webhook signature verification
- Token consumption (simulation token decrement)
- Static file serving (when `FRONTEND_DIST` set)

---

*Testing analysis: 2026-06-14*
