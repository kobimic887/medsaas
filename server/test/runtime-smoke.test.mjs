// Runtime parity smoke: auth, Stripe webhook, token consumption, static serving.
//
// Proves RUN-03 and RUN-02 under both Bun and Node runtimes.
//
// Run:
//   SERVER_RUNTIME=node npm --prefix server run test:runtime-smoke
//   SERVER_RUNTIME=bun  npm --prefix server run test:runtime-smoke
//   npm run build && FRONTEND_DIST=../client/dist SERVER_RUNTIME=bun \
//     npm --prefix server run test:runtime-smoke -- --assert-static

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { MongoClient } from 'mongodb';
import Stripe from 'stripe';
import bcrypt from 'bcryptjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = path.resolve(__dirname, '..');

const ASSERT_STATIC = process.argv.includes('--assert-static');
const PORT = 3201;
const BASE = `http://127.0.0.1:${PORT}`;
const WEBHOOK_SECRET = 'whsec_smoketest_do_not_use_in_prod';
const DB_NAME = 'medsaas_smoke_test';

const BUN_PATH = process.env.BUN_PATH || `${process.env.HOME}/.bun/bin/bun`;
const serverRuntime = process.env.SERVER_RUNTIME || 'bun';
const runtimeBin = serverRuntime === 'bun' ? BUN_PATH : process.execPath;

const stripe = new Stripe('sk_test_dummy_key_never_calls_api');

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

async function main() {
  console.log(`[smoke] runtime: ${serverRuntime} (${runtimeBin})`);
  console.log('[smoke] Starting ephemeral MongoDB...');
  const mem = await MongoMemoryServer.create();
  const uri = mem.getUri(DB_NAME);

  // Build child env — explicitly blank NVIDIA key to avoid external calls (D-10).
  // The server calls configDotenv at startup which re-reads the .env file, so
  // we must pass the key as an empty string to override what .env contains.
  const childEnv = { ...process.env };
  const childEnvFinal = {
    ...childEnv,
    MONGODB_URI: uri,
    JWT_SECRET: 'smoke_jwt_secret_at_least_32_chars_long_xx',
    STRIPE_SECRET_KEY: 'sk_test_dummy_key_never_calls_api',
    STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
    PORT: String(PORT),
    NODE_ENV: 'test',
    NVIDIA_MOLMIM_API_KEY: '',  // Blank so handler returns 500 without calling NVIDIA
  };
  if (!ASSERT_STATIC) {
    childEnvFinal.FRONTEND_DIST = '';
  }

  console.log('[smoke] Spawning server...');
  const child = spawn(runtimeBin, ['index.js'], {
    cwd: SERVER_DIR,
    env: childEnvFinal,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let serverLog = '';
  child.stdout.on('data', (d) => { serverLog += d.toString(); });
  child.stderr.on('data', (d) => { serverLog += d.toString(); });

  const cleanup = async () => {
    try { child.kill('SIGKILL'); } catch {}
    try { await mem.stop(); } catch {}
  };

  try {
    const healthy = await waitForHealth();
    if (!healthy) {
      console.error('[smoke] Server did not become healthy. Output:\n' + serverLog);
      throw new Error('server-not-healthy');
    }
    console.log('[smoke] Server is up.\n');

    // Seed test user: verified, active, with 1 simulation token
    const mongo = new MongoClient(uri);
    await mongo.connect();
    const users = mongo.db(DB_NAME).collection('users');

    const smokePasswordHash = await bcrypt.hash('SmokePass1!', 10);
    const smokeUser = {
      username: 'smokeuser',
      email: 'smoke@example.com',
      password: smokePasswordHash,
      verified: true,
      active: true,
      role: 'member',
      simulationTokens: 1,
      createdAt: new Date(),
    };
    await users.insertOne(smokeUser);

    // Seed webhook user for Stripe credit grant
    const webhookUser = {
      username: 'webhooksmoke',
      email: 'webhooksmoke@example.com',
      companyId: 'comp_smoke',
      role: 'member',
      status: 'active',
      simulationTokens: 5,
      createdAt: new Date(),
    };
    await users.insertOne(webhookUser);

    // --- Test 1: /api/signin ---
    console.log('Test 1 — /api/signin returns 200 and JWT for seeded user:');
    const signinRes = await fetch(`${BASE}/api/signin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'smokeuser', password: 'SmokePass1!' }),
    });
    const signinBody = await signinRes.json();
    check('signin returns 200', signinRes.status === 200, `(got ${signinRes.status}: ${JSON.stringify(signinBody)})`);
    check('signin response has token', typeof signinBody.token === 'string' && signinBody.token.length > 0);
    const authToken = signinBody.token;

    // --- Test 2: /health and /health/db ---
    console.log('\nTest 2 — health endpoints:');
    const healthRes = await fetch(`${BASE}/health`);
    check('/health returns 200', healthRes.status === 200, `(got ${healthRes.status})`);
    const healthDbRes = await fetch(`${BASE}/health/db`);
    check('/health/db returns 200', healthDbRes.status === 200, `(got ${healthDbRes.status})`);

    // --- Test 3: Stripe webhook (valid and forged) ---
    console.log('\nTest 3 — /stripe/webhook signature verification:');
    const billing = mongo.db(DB_NAME).collection('billing_events');
    const sessionId = `cs_test_smoke_${Date.now()}`;
    const webhookEvent = {
      id: `evt_${Math.random().toString(36).slice(2)}`,
      object: 'event',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: sessionId,
          object: 'checkout.session',
          mode: 'payment',
          payment_status: 'paid',
          amount_total: 2000,
          currency: 'usd',
          customer: 'cus_smoke',
          metadata: { purchaseType: 'plan_tokens', plan: 'Standard', credits: '50', username: 'webhooksmoke', companyId: 'comp_smoke' },
        },
      },
    };

    const payload = JSON.stringify(webhookEvent);
    const validHeader = stripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET });
    const wRes = await fetch(`${BASE}/stripe/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Stripe-Signature': validHeader },
      body: payload,
    });
    check('valid signed webhook returns 200', wRes.status === 200, `(got ${wRes.status}: ${await wRes.text().catch(() => '')})`);

    const afterGrant = await users.findOne({ username: 'webhooksmoke' });
    check('webhook grants credits (5 -> 55)', afterGrant?.simulationTokens === 55, `(got ${afterGrant?.simulationTokens})`);
    const be = await billing.findOne({ stripeSessionId: sessionId });
    check('billing_events recorded as fulfilled', be?.status === 'fulfilled');

    // Forged signature
    const forgedHeader = stripe.webhooks.generateTestHeaderString({ payload, secret: 'whsec_wrong_secret' });
    const forgedRes = await fetch(`${BASE}/stripe/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Stripe-Signature': forgedHeader },
      body: payload,
    });
    check('forged signature returns 400', forgedRes.status === 400, `(got ${forgedRes.status})`);

    // --- Test 4: /api/generate-molecules token consumption ---
    console.log('\nTest 4 — /api/generate-molecules token consumption:');
    if (!authToken) {
      console.log('  SKIP: no auth token from signin (Test 1 failed)');
      failed += 2;
    } else {
      // Call 1: token decrements 1->0, then returns 500 "NVIDIA_MOLMIM_API_KEY is not configured"
      const mol1Res = await fetch(`${BASE}/api/generate-molecules`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
        body: JSON.stringify({ smi: 'CCO', num_molecules: 1 }),
      });
      const mol1Body = await mol1Res.json().catch(() => ({}));
      check(
        'first call returns 500 (token consumed, API key missing)',
        mol1Res.status === 500,
        `(got ${mol1Res.status}: ${JSON.stringify(mol1Body)})`
      );
      check(
        'first call error is NVIDIA_MOLMIM_API_KEY not configured',
        mol1Body.error === 'NVIDIA_MOLMIM_API_KEY is not configured',
        `(got ${JSON.stringify(mol1Body.error)})`
      );

      // Verify token was actually decremented
      const afterConsume = await users.findOne({ username: 'smokeuser' });
      check('simulationTokens decremented 1->0', afterConsume?.simulationTokens === 0, `(got ${afterConsume?.simulationTokens})`);

      // Call 2: token exhausted -> 403
      const mol2Res = await fetch(`${BASE}/api/generate-molecules`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
        body: JSON.stringify({ smi: 'CCO', num_molecules: 1 }),
      });
      const mol2Body = await mol2Res.json().catch(() => ({}));
      check('second call returns 403 (no tokens left)', mol2Res.status === 403, `(got ${mol2Res.status}: ${JSON.stringify(mol2Body)})`);
      check('second call error is No simulation tokens left', mol2Body.error === 'No simulation tokens left', `(got ${JSON.stringify(mol2Body.error)})`);
    }

    // --- Test 5: static serving (only with --assert-static) ---
    if (ASSERT_STATIC) {
      console.log('\nTest 5 — GET / serves built frontend HTML:');
      const rootRes = await fetch(`${BASE}/`);
      const rootText = await rootRes.text().catch(() => '');
      check('GET / returns 200', rootRes.status === 200, `(got ${rootRes.status})`);
      check('GET / returns HTML', rootText.includes('<!DOCTYPE html') || rootText.includes('<html'), `(got ${rootText.slice(0, 100)})`);
    }

    await mongo.close();
  } finally {
    await cleanup();
  }

  console.log(`\n${'='.repeat(48)}`);
  console.log(`Result: ${passed} passed, ${failed} failed`);
  console.log('='.repeat(48));
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('[smoke] Harness error:', err);
  process.exit(1);
});
