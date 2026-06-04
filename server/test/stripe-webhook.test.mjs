// Integration test: proves the Stripe payment -> credits-granted path works
// end to end, with ZERO cost and no real Stripe account.
//
// It boots the REAL server (index.js) against an ephemeral in-memory MongoDB,
// then delivers a properly Stripe-signed `checkout.session.completed` event to
// the live /stripe/webhook route. This exercises signature verification and
// fulfillCheckoutSession exactly as production would — the only thing not
// covered is Stripe's network delivery (which is the deferred prod-infra step).
//
// Run: node server/test/stripe-webhook.test.mjs   (from repo root)
//      npm --prefix server run test:stripe

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
const DB_NAME = 'medsaas_webhook_test';

const stripe = new Stripe('sk_test_dummy_key_for_signing_only');

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

function buildEvent(sessionId, { username, companyId, credits, plan }) {
  return {
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
        customer: 'cus_test123',
        metadata: { purchaseType: 'plan_tokens', plan, credits: String(credits), username, companyId },
      },
    },
  };
}

async function postEvent(eventObj, { secret = WEBHOOK_SECRET } = {}) {
  const payload = JSON.stringify(eventObj);
  const header = stripe.webhooks.generateTestHeaderString({ payload, secret });
  const res = await fetch(`${BASE}/stripe/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Stripe-Signature': header },
    body: payload,
  });
  return { status: res.status, body: await res.text().catch(() => '') };
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
  console.log('Starting ephemeral MongoDB...');
  const mem = await MongoMemoryServer.create();
  const uri = mem.getUri(DB_NAME);

  const BUN_PATH = process.env.BUN_PATH || `${process.env.HOME}/.bun/bin/bun`;
  const serverRuntime = process.env.SERVER_RUNTIME || 'node';
  const runtimeBin = serverRuntime === 'bun' ? BUN_PATH : process.execPath;

  console.log(`Spawning real server (index.js) against ephemeral DB via ${serverRuntime}...`);
  const child = spawn(runtimeBin, ['index.js'], {
    cwd: SERVER_DIR,
    env: {
      ...process.env,
      MONGODB_URI: uri,
      JWT_SECRET: 'test_jwt_secret_at_least_32_chars_long_xx',
      STRIPE_SECRET_KEY: 'sk_test_dummy_key_never_calls_api', // overrides live key in .env
      STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
      PORT: String(PORT),
      NODE_ENV: 'test',
    },
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
      console.error('Server did not become healthy. Server output:\n' + serverLog);
      throw new Error('server-not-healthy');
    }
    console.log('Server is up.\n');

    // Seed a user with a known starting balance.
    const mongo = new MongoClient(uri);
    await mongo.connect();
    const users = mongo.db(DB_NAME).collection('users');
    const billing = mongo.db(DB_NAME).collection('billing_events');
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
    const event = buildEvent(sessionId, { username: 'webhooktest', companyId: 'comp_test', credits: 50, plan: 'Standard' });

    console.log('Test 1 — valid signed event grants credits:');
    const r1 = await postEvent(event);
    check('webhook returns 200', r1.status === 200, `(got ${r1.status}: ${r1.body})`);
    const afterFirst = await users.findOne({ username: 'webhooktest' });
    check('credits 5 -> 55 (granted 50)', afterFirst.simulationTokens === 55, `(got ${afterFirst.simulationTokens})`);
    const be = await billing.findOne({ stripeSessionId: sessionId });
    check('billing_events row marked fulfilled', be?.status === 'fulfilled', `(got ${be?.status})`);
    check('billing_events recorded 50 credits', be?.credits === 50, `(got ${be?.credits})`);

    console.log('\nTest 2 — replaying the same event does NOT double-grant (idempotent):');
    const r2 = await postEvent(event);
    check('replay returns 200', r2.status === 200, `(got ${r2.status})`);
    const afterReplay = await users.findOne({ username: 'webhooktest' });
    check('credits stay at 55 (no double grant)', afterReplay.simulationTokens === 55, `(got ${afterReplay.simulationTokens})`);

    console.log('\nTest 3 — forged signature is rejected:');
    const forged = await postEvent(buildEvent(`cs_test_forged_${Date.now()}`, { username: 'webhooktest', companyId: 'comp_test', credits: 999, plan: 'Professional' }), { secret: 'whsec_wrong_secret' });
    check('bad signature returns 400', forged.status === 400, `(got ${forged.status})`);
    const afterForged = await users.findOne({ username: 'webhooktest' });
    check('forged event granted nothing', afterForged.simulationTokens === 55, `(got ${afterForged.simulationTokens})`);

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
  console.error('Test harness error:', err);
  process.exit(1);
});
