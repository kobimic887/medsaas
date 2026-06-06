# Phase 05: Server Runtime on Bun - Pattern Map

**Mapped:** 2026-06-04
**Files analyzed:** 7
**Analogs found:** 7 / 7

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `server/package.json` | config | request-response | `server/package.json` | exact |
| `package.json` | config | request-response | `package.json` | exact |
| `server/index.js` | route | request-response | `server/index.js` | exact |
| `server/test/runtime-smoke.test.mjs` | test | request-response | `server/test/stripe-webhook.test.mjs` | role-match |
| `spike/runtime-capture.mjs` | utility | batch | `spike/baseline-capture.mjs` | role-match |
| `.planning/phases/05-server-runtime-on-bun/BUN-BEFORE-AFTER.md` | report | batch | `.planning/phases/04-compatibility-spike-baseline/BASELINE.md` | role-match |
| `README.md` | docs | request-response | `README.md` | exact |

## Pattern Assignments

### `server/package.json` (config, request-response)

**Analog:** `server/package.json`

**Script pattern** (lines 5-12):
```json
"type": "module",
"scripts": {
  "start": "node index.js",
  "dev": "node --watch index.js",
  "start:unified": "FRONTEND_DIST=../client/dist node index.js",
  "import:mol-price": "node import-mol-price.js",
  "test:stripe": "node test/stripe-webhook.test.mjs"
}
```

**Apply:** keep ESM and npm-invoked script shape. Swap only runtime binaries for Phase 5 defaults (`bun index.js`, `bun --watch index.js`) and add parallel rollback scripts such as `start:node`, `dev:node`, and `start:unified:node` using the current Node commands.

---

### `package.json` (config, request-response)

**Analog:** `package.json`

**Root orchestration pattern** (lines 5-14):
```json
"scripts": {
  "install:all": "npm --prefix client install && npm --prefix server install",
  "predev": "node scripts/ensure-dev.mjs",
  "dev": "client/node_modules/.bin/concurrently \"npm --prefix server run dev\" \"npm --prefix client run dev\" --names \"api,web\" --prefix-colors \"green,blue\"",
  "build": "npm --prefix client run build",
  "start": "npm run build && npm --prefix server run start:unified",
  "start:api": "npm --prefix server run start",
  "check": "node --check server/index.js && npm --prefix client run build",
  "test:brand": "node scripts/check-brand.mjs"
}
```

**Apply:** preserve root `predev`, `concurrently`, `npm --prefix`, `build`, and client Vite commands. If the MEAS-03 gate reverts the default to Node, the one-line flip is in `server/package.json`; root scripts should continue delegating to server scripts.

---

### `server/index.js` (route, request-response)

**Analog:** `server/index.js`

**Imports and env validation pattern** (lines 1-18, 31-47):
```js
import express from 'express';
import { MongoClient, ObjectId } from 'mongodb';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import 'dotenv/config';
import { configDotenv } from 'dotenv';
import Stripe from 'stripe';

configDotenv({ path: path.resolve(__dirname, '../.env') });
configDotenv();

const REQUIRED_ENV = ['MONGODB_URI', 'JWT_SECRET', 'STRIPE_SECRET_KEY'];
const missingRequiredEnv = REQUIRED_ENV.filter((key) => !process.env[key]);
if (missingRequiredEnv.length > 0) {
  console.error(`Missing required environment variables: ${missingRequiredEnv.join(', ')}`);
  process.exit(1);
}
```

**Stripe raw-body route pattern** (lines 92-122):
```js
app.post('/stripe/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  let event;
  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      req.headers['stripe-signature'],
      STRIPE_WEBHOOK_SECRET
    );
  } catch (error) {
    console.error('Stripe webhook signature verification failed:', error.message);
    return res.status(400).send(`Webhook Error: ${error.message}`);
  }

  try {
    if (event.type === 'checkout.session.completed') {
      await fulfillCheckoutSession(event.data.object);
    }
    res.json({ received: true });
  } catch (error) {
    console.error('Stripe webhook fulfillment failed:', error);
    res.status(500).json({ error: 'Webhook fulfillment failed' });
  }
});

app.use(express.json({ limit: '5mb' }));
```

**Apply:** replace only the sync verification call with `await stripe.webhooks.constructEventAsync(...)`. Preserve route order: `/stripe/webhook` with `express.raw()` must stay before `app.use(express.json(...))`.

**Token-consuming route pattern** (lines 203-232):
```js
app.post('/api/generate-molecules', ensureMongoConnected, authenticateToken, requireActiveUser, consumeSimulationToken('generate-molecules'), async (req, res) => {
  const molmimApiKey = process.env.NVIDIA_MOLMIM_API_KEY;
  if (!molmimApiKey) {
    return res.status(500).json({ error: 'NVIDIA_MOLMIM_API_KEY is not configured' });
  }

  try {
    const response = await axios.post(invoke_url, payload, { headers });
    res.json(response.data);
  } catch (error) {
    res.status(error.response?.status || 500).json({ error: error.message });
  }
});
```

**Auth middleware pattern** (lines 1099-1170, 2412-2420):
```js
async function requireActiveUser(req, res, next) {
  const dbUser = await usersCollection.findOne(userQuery, { projection: { password: 0 } });
  if (!dbUser) return res.status(403).json({ error: 'User not found' });
  req.dbUser = dbUser;
  next();
}

function consumeSimulationToken(feature) {
  return async (req, res, next) => {
    const result = await usersCollection.updateOne(userQuery, {
      $inc: { simulationTokens: -1 },
      $set: { updatedAt: new Date() }
    });
    if (result.matchedCount === 0) {
      return res.status(403).json({ error: 'No simulation tokens left' });
    }
    next();
  };
}

function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token provided' });
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Invalid token' });
    req.user = user;
    next();
  });
}
```

**Signin pattern** (lines 1932-1959):
```js
app.post('/api/signin', authRateLimit, ensureMongoConnected, async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
  const user = await usersCollection.findOne({ $or: [{ username }, { email: username }] });
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });
  const valid = await bcrypt.compare(password, user.password);
  if (!valid) return res.status(401).json({ error: 'Invalid credentials' });
  const token = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: '1d' });
  res.json({ message: 'Signin successful', token, user: { username: user.username } });
});
```

**Static serving and listen pattern** (lines 83-88, 4740-4744, 6013-6027):
```js
const FRONTEND_DIST_PATH = path.resolve(__dirname, process.env.FRONTEND_DIST || '../client/dist');
const FRONTEND_INDEX_PATH = path.join(FRONTEND_DIST_PATH, 'index.html');
const hasFrontendBuild = () => fs.existsSync(FRONTEND_INDEX_PATH);

app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ HTTP Server running on port ${PORT}`);
});

app.use(express.static(FRONTEND_DIST_PATH, { index: false }));
app.get(/^(?!\/(?:api|api-docs|health|tanimoto|blobs)(?:\/|$)).*/, (req, res, next) => {
  if (!hasFrontendBuild()) return next();
  return res.sendFile(FRONTEND_INDEX_PATH);
});

startServer().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
```

---

### `server/test/runtime-smoke.test.mjs` (test, request-response)

**Analog:** `server/test/stripe-webhook.test.mjs`

**Imports and constants pattern** (lines 13-28):
```js
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { MongoClient } from 'mongodb';
import Stripe from 'stripe';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = path.resolve(__dirname, '..');
const PORT = 3199;
const BASE = `http://127.0.0.1:${PORT}`;
const WEBHOOK_SECRET = 'whsec_localtest_do_not_use_in_prod';
```

**Server spawn pattern** (lines 87-113):
```js
const mem = await MongoMemoryServer.create();
const uri = mem.getUri(DB_NAME);
const child = spawn('node', ['index.js'], {
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

**Apply:** make the runtime command parameterized, e.g. `process.env.SERVER_RUNTIME || 'bun'`, while keeping `cwd`, env override, log capture, health polling, and cleanup shape.

**Signed webhook request pattern** (lines 62-70, 142-161):
```js
const payload = JSON.stringify(eventObj);
const header = stripe.webhooks.generateTestHeaderString({ payload, secret });
const res = await fetch(`${BASE}/stripe/webhook`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Stripe-Signature': header },
  body: payload,
});

const r1 = await postEvent(event);
check('webhook returns 200', r1.status === 200, `(got ${r1.status}: ${r1.body})`);
const forged = await postEvent(buildEvent(...), { secret: 'whsec_wrong_secret' });
check('bad signature returns 400', forged.status === 400, `(got ${forged.status})`);
```

**Auth/token smoke additions should copy:** seed user via `MongoClient`, hash password with `bcryptjs`, call `/api/signin`, then call `/api/generate-molecules` with `Authorization: Bearer <token>` and no `NVIDIA_MOLMIM_API_KEY`; assert the route returns the configured-key error after `consumeSimulationToken` decrements the Mongo user from 1 to 0.

**Result accounting pattern** (lines 30-40, 168-177):
```js
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

console.log(`Result: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
```

---

### `spike/runtime-capture.mjs` (utility, batch)

**Analog:** `spike/baseline-capture.mjs`

**CLI/env config pattern** (lines 10-51):
```js
const args = new Map();
for (let i = 2; i < process.argv.length; i += 1) {
  const arg = process.argv[i];
  if (arg.startsWith("--")) {
    const key = arg.slice(2);
    const value = process.argv[i + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${arg}`);
    args.set(key, value);
    i += 1;
  }
}

const projectRoot = process.cwd();
const serverDir = path.join(projectRoot, "server");
const runs = Number(args.get("runs") || process.env.BASELINE_RUNS || 5);
const env = {
  ...process.env,
  PORT: String(port),
  NODE_ENV: "test",
  JWT_SECRET: process.env.JWT_SECRET || "node_baseline_jwt_secret_at_least_32_chars",
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY || "node_baseline_unused_dummy_stripe_key",
  MONGODB_URI: process.env.MONGODB_URI || "mongodb://localhost:27017/node_baseline",
};
```

**Measurement pattern** (lines 75-117, 186-265):
```js
async function readRssKiB(pid) {
  const status = await readFile(`/proc/${pid}/status`, "utf8");
  const match = status.match(/^VmRSS:\s+(\d+)\s+kB$/m);
  if (!match) throw new Error(`VmRSS not found for pid ${pid}`);
  return Number(match[1]);
}

async function startServer() {
  const child = spawn("node", ["index.js"], {
    cwd: serverDir,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  // poll /health until HTTP 200, then return child + startupMs
}

const server = await startServer();
await sleep(2_000);
const rssKiB = await readRssKiB(server.child.pid);
const load = spawn("node", ["spike/load-gen.mjs", "--base-url", baseUrl], { cwd: projectRoot });
```

**Apply:** preserve N>=5, `/proc/<pid>/status` VmRSS, `/health` startup polling, `/health` + `/health/db` load mix, and medians. Parameterize only the server runtime command (`bun` vs `node`) and write the Phase 5 report. Keep `spike/load-gen.mjs` unchanged.

**Report generation pattern** (lines 275-323):
```js
const medians = {
  idleRssMiB: round(median(idleRssMiB), 1),
  underLoadRssMiB: round(median(loadRssMiB), 1),
  coldStartMs: Math.round(median(coldStartMs)),
};

const markdown = `# Phase 04 Node Baseline

| Metric | Median | Unit | Samples |
|--------|--------|------|---------|
| Idle RSS | ${medians.idleRssMiB} | MiB | ${idleRssMiB.map((v) => round(v, 1)).join(", ")} |

## Methodology
- **RSS boundary:** Linux \`/proc/<pid>/status\` \`VmRSS\`.
`;

await writeFile(outputPath, markdown);
```

---

### `.planning/phases/05-server-runtime-on-bun/BUN-BEFORE-AFTER.md` (report, batch)

**Analog:** `.planning/phases/04-compatibility-spike-baseline/BASELINE.md`

**Metrics table pattern** (lines 5-13):
```markdown
| Metric | Median | Unit | Samples |
|--------|--------|------|---------|
| Idle RSS | 118.9 | MiB | 121.9, 114.3, 118.9, 119.3, 110.8 |
| RSS Under Load | 219.7 | MiB | 221.4, 217.9, 219.7, 222.7, 217.5 |
| Cold Start | 764 | ms | 1059, 768, 764, 762, 762 |
```

**Methodology pattern** (lines 17-29):
```markdown
- **Machine:** oracle ssh alias, host `instance-20260207-2053`, measured inside `node:22-slim` arm64 container
- **Runs:** N=5; median reported for every repeated metric.
- **Server command:** `node server/index.js`
- **RSS boundary:** Linux `/proc/<pid>/status` `VmRSS`; `process.memoryUsage()` is intentionally not used.
- **RSS under load:** run `node spike/load-gen.mjs --base-url http://127.0.0.1:3000 --duration 30 --concurrency 20`, sample peak VmRSS while the load generator runs.
- **Load endpoint mix:** `/health` and `/health/db` only.
```

**Apply:** include Node baseline values, Bun values, raw per-sample distributions, deltas, and the gate result. The final default is Bun only when Bun median idle RSS is below 118.9 MiB; otherwise document Node as default.

---

### `README.md` (docs, request-response)

**Analog:** `README.md`

**Run command docs pattern** (lines 17-55):
```markdown
## Local Setup

1. Install dependencies:
   ```bash
   npm run install:all
   ```

4. Run the app in development:
   ```bash
   npm run dev
   ```

5. Build and run the production-style unified app:
   ```bash
   npm start
   ```

   The backend serves `client/dist`.
```

**Stripe local testing docs pattern** (lines 102-112):
```markdown
## Billing Flow

Stripe checkout is created by the backend from a server-side plan catalog. Token credits are granted only from `checkout.session.completed` webhooks.

For local webhook testing:
```bash
stripe listen --forward-to localhost:3000/stripe/webhook
```
```

**Apply:** add Bun runtime note and exact Node rollback command near the Local Setup production/development commands. Keep docs command-first and concise.

## Shared Patterns

### Runtime Entrypoints
**Source:** `server/package.json` lines 7-11 and `package.json` lines 7-11  
**Apply to:** `server/package.json`, `package.json`, README rollback docs
```json
"dev": "node --watch index.js",
"start": "node index.js",
"start:unified": "FRONTEND_DIST=../client/dist node index.js"
```

### Raw Stripe Webhook Before JSON
**Source:** `server/index.js` lines 92-122  
**Apply to:** `server/index.js`, `server/test/runtime-smoke.test.mjs`
```js
app.post('/stripe/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  // verify signed raw body
});
app.use(express.json({ limit: '5mb' }));
```

### Smoke Harness Server Lifecycle
**Source:** `server/test/stripe-webhook.test.mjs` lines 87-121 and 163-177  
**Apply to:** `server/test/runtime-smoke.test.mjs`
```js
const child = spawn('node', ['index.js'], { cwd: SERVER_DIR, env, stdio: ['ignore', 'pipe', 'pipe'] });
child.stdout.on('data', (d) => { serverLog += d.toString(); });
child.stderr.on('data', (d) => { serverLog += d.toString(); });
const healthy = await waitForHealth();
try {
  // assertions
} finally {
  await cleanup();
}
```

### Measurement Boundary
**Source:** `spike/baseline-capture.mjs` lines 75-82 and `.planning/phases/04-compatibility-spike-baseline/BASELINE.md` lines 23-26  
**Apply to:** `spike/runtime-capture.mjs`, `BUN-BEFORE-AFTER.md`
```js
const status = await readFile(`/proc/${pid}/status`, "utf8");
const match = status.match(/^VmRSS:\s+(\d+)\s+kB$/m);
```

### Token Middleware Chain
**Source:** `CLAUDE.md` lines 56-65 and `server/index.js` line 203  
**Apply to:** runtime smoke test token-consuming route
```text
ensureMongoConnected → authenticateToken → requireActiveUser → consumeSimulationToken(feature)
```

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| None | - | - | All planned files have direct or role-matching analogs in the current repo. |

## Non-Patterns / Out Of Scope

| Area | Existing Analog | Planner Guidance |
|------|-----------------|------------------|
| Docker production image | `Dockerfile` lines 1-18 | Do not migrate to `oven/bun` in Phase 5; Phase 7 owns Docker image and CI runtime. Use only as current production command context. |
| `bun install` / `bun run` package tooling | N/A | Do not introduce in Phase 5; Phase 6 owns package-manager migration. |
| Client Vite runtime | `package.json` line 8 | Preserve current npm/Vite web side. |

## Metadata

**Analog search scope:** root `package.json`, `server/`, `spike/`, README/docs, Phase 4 planning artifacts, shell/Docker entrypoints  
**Files scanned:** 80+ repo files via `rg --files`; 12 primary analogs read  
**Pattern extraction date:** 2026-06-04
