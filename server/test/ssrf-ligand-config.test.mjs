// SSRF guard regression: company-customised ligand upstreams are re-validated
// per request, so a config whose host is a private/internal address is refused
// before any outbound call — even when injected straight into Mongo, bypassing
// the config-time check (assertValidHttpUrl at save). This proves the
// *request-time* guard specifically: a test that POSTed the bad URL through the
// config API would be rejected up front and pass for the wrong reason.
//
// IP literals are used so the test is hermetic — no DNS, no network. The
// "public host is allowed" path is covered by assertValidHttpUrl's existing
// config-time use plus the default-config suites (which never set a custom URL,
// so the guard is skipped and they pass unchanged).
//
// Run: SERVER_RUNTIME=bun bun test/ssrf-ligand-config.test.mjs

import { spawn } from 'node:child_process';
import { once } from 'node:events';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import { MongoClient } from 'mongodb';
import { MongoMemoryServer } from 'mongodb-memory-server';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = path.resolve(__dirname, '..');
const PORT = 3207;
const BASE = `http://127.0.0.1:${PORT}`;
const DB_NAME = 'medsaas_ssrf_test';
const PASSWORD = 'SsrfPass1!';
const COMPANY = 'ssrf_company';
const USERNAME = 'ssrfowner';

const BUN_PATH = process.env.BUN_PATH || `${process.env.HOME}/.bun/bin/bun`;
const serverRuntime = process.env.SERVER_RUNTIME || 'bun';
const runtimeBin = serverRuntime === 'bun' ? BUN_PATH : process.execPath;

let passed = 0;
let failed = 0;

function check(label, condition, extra = '') {
  if (condition) {
    console.log(`  PASS ${label}`);
    passed += 1;
  } else {
    console.log(`  FAIL ${label} ${extra}`);
    failed += 1;
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForHealth(timeoutMs = 40000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${BASE}/health`);
      if (response.ok) return true;
    } catch {
      // still starting
    }
    await delay(250);
  }
  return false;
}

function spawnServer(uri) {
  let log = '';
  const child = spawn(runtimeBin, ['index.js'], {
    cwd: SERVER_DIR,
    env: {
      ...process.env,
      MONGODB_URI: uri,
      JWT_SECRET: 'ssrf_test_jwt_secret_at_least_32_characters',
      STRIPE_SECRET_KEY: 'sk_test_dummy_key_never_calls_api',
      STRIPE_WEBHOOK_SECRET: '',
      FRONTEND_DIST: '',
      PORT: String(PORT),
      NODE_ENV: 'test'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stdout.on('data', (data) => { log += data.toString(); });
  child.stderr.on('data', (data) => { log += data.toString(); });
  return { child, getLog: () => log };
}

async function stopServer(server) {
  if (!server?.child || server.child.exitCode !== null) return;
  server.child.kill('SIGKILL');
  await Promise.race([once(server.child, 'exit'), delay(3000)]);
}

async function api(pathname, { method = 'GET', token, body } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${BASE}${pathname}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  let parsed = {};
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    parsed = { raw: text };
  }
  return { status: response.status, body: parsed };
}

async function main() {
  console.log(`[ssrf] runtime: ${serverRuntime} (${runtimeBin})`);
  const memoryServer = await MongoMemoryServer.create();
  const uri = memoryServer.getUri(DB_NAME);
  const mongo = new MongoClient(uri);
  let server = null;

  try {
    await mongo.connect();
    const db = mongo.db(DB_NAME);
    const companies = db.collection('companies');
    const users = db.collection('users');
    const createdAt = new Date();

    await companies.insertOne({
      companyId: COMPANY,
      name: 'SSRF Co',
      slug: 'ssrf-co',
      active: true,
      createdAt,
      updatedAt: createdAt
    });
    await users.insertOne({
      username: USERNAME,
      email: 'ssrf@example.com',
      password: await bcrypt.hash(PASSWORD, 10),
      verified: true,
      active: true,
      role: 'owner',
      companyId: COMPANY,
      companyName: 'SSRF Co',
      simulationTokens: 50,
      createdAt
    });

    server = spawnServer(uri);
    if (!await waitForHealth()) {
      throw new Error(`Server did not become healthy:\n${server.getLog()}`);
    }

    const signin = await api('/api/signin', {
      method: 'POST',
      body: { username: USERNAME, password: PASSWORD }
    });
    const token = signin.body.token;
    check('owner signs in', signin.status === 200 && !!token, JSON.stringify(signin.body));

    // Inject a malicious config straight into the company doc — NOT via the
    // config API (which validates on save), so only the request-time guard can
    // catch this.
    async function seedConfig(patch) {
      await companies.updateOne({ companyId: COMPANY }, { $set: { ligandServiceConfig: patch } });
    }

    // A catalog route the guard protects (uses catalogApiBase via the chokepoint).
    const ROUTE = '/api/asinex/exact/CCO';

    const cases = [
      { label: 'cloud metadata endpoint (169.254.169.254)', url: 'http://169.254.169.254/latest/meta-data/' },
      { label: 'private 10/8 (10.0.0.1)', url: 'http://10.0.0.1:8080/api' },
      { label: 'loopback (127.0.0.1)', url: 'http://127.0.0.1:9999' },
      { label: 'link-local (169.254.x via 0.0.0.0)', url: 'http://0.0.0.0:8000' }
    ];

    for (const c of cases) {
      await seedConfig({ catalogApiBase: c.url });
      const startedAt = Date.now();
      const res = await api(ROUTE, { token });
      const elapsed = Date.now() - startedAt;
      const refused = res.status >= 400 && /public host/i.test(JSON.stringify(res.body));
      check(`refuses ${c.label}`, refused, `status=${res.status} body=${JSON.stringify(res.body)}`);
      check(`refuses ${c.label} fast (no outbound hang)`, elapsed < 5000, `elapsed=${elapsed}ms`);
    }

    // Defence-in-depth: even though the config API would reject a private URL on
    // save, the request-time guard is what stops a *rebound* host. Confirm the
    // refusal references the offending field, not a generic upstream error.
    await seedConfig({ catalogApiBase: 'http://169.254.169.254' });
    const fielded = await api(ROUTE, { token });
    check(
      'refusal names the offending field (catalogApiBase)',
      /catalogApiBase/.test(JSON.stringify(fielded.body)),
      JSON.stringify(fielded.body)
    );
  } finally {
    await stopServer(server);
    await mongo.close();
    await memoryServer.stop();
  }

  console.log('\n================================================');
  console.log(`Result: ${passed} passed, ${failed} failed`);
  console.log('================================================');
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
