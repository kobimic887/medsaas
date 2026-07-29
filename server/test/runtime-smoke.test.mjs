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
import jwt from 'jsonwebtoken';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = path.resolve(__dirname, '..');

const ASSERT_STATIC = process.argv.includes('--assert-static');
const PORT = 3201;
const BASE = `http://127.0.0.1:${PORT}`;
const WEBHOOK_SECRET = 'whsec_smoketest_do_not_use_in_prod';
const SMOKE_JWT_SECRET = 'smoke_jwt_secret_at_least_32_chars_long_xx';
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
    JWT_SECRET: SMOKE_JWT_SECRET,
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

    // --- Test 4: /api/generate-molecules charges only for work that happened ---
    //
    // This test used to assert the opposite: that a call failing because no NVIDIA
    // key is configured still consumed the user's credit, and that the second call
    // was therefore rejected for having no tokens left. That was the bug, not the
    // contract. Metered routes decrement before calling their upstream, so any
    // upstream failure — a missing key here, an Asinex outage in production — must
    // hand the credit back. The balance staying at 1 across two failed calls is the
    // assertion that matters.
    console.log('\nTest 4 — /api/generate-molecules refunds when the call never ran:');
    if (!authToken) {
      console.log('  SKIP: no auth token from signin (Test 1 failed)');
      failed += 7;
    } else {
      const before = await users.findOne({ username: 'smokeuser' });
      const startingTokens = before?.simulationTokens;

      const mol1Res = await fetch(`${BASE}/api/generate-molecules`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
        body: JSON.stringify({ smi: 'CCO', num_molecules: 1 }),
      });
      const mol1Body = await mol1Res.json().catch(() => ({}));
      check(
        'unconfigured upstream returns 503, not 500',
        mol1Res.status === 503,
        `(got ${mol1Res.status}: ${JSON.stringify(mol1Body)})`
      );
      check(
        'error does not leak the env var name',
        typeof mol1Body.error === 'string' && !mol1Body.error.includes('NVIDIA_'),
        `(got ${JSON.stringify(mol1Body.error)})`
      );

      const afterFirst = await users.findOne({ username: 'smokeuser' });
      check(
        'credit refunded — balance unchanged after a failed call',
        afterFirst?.simulationTokens === startingTokens,
        `(expected ${startingTokens}, got ${afterFirst?.simulationTokens})`
      );

      // Second call must behave identically. If the refund were missing, this one
      // would fail with 403 "No simulation tokens left" instead.
      const mol2Res = await fetch(`${BASE}/api/generate-molecules`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
        body: JSON.stringify({ smi: 'CCO', num_molecules: 1 }),
      });
      const mol2Body = await mol2Res.json().catch(() => ({}));
      check(
        'second call still reaches the upstream check, not a token wall',
        mol2Res.status === 503,
        `(got ${mol2Res.status}: ${JSON.stringify(mol2Body)})`
      );

      const afterSecond = await users.findOne({ username: 'smokeuser' });
      check(
        'balance still unchanged after two failed calls',
        afterSecond?.simulationTokens === startingTokens,
        `(expected ${startingTokens}, got ${afterSecond?.simulationTokens})`
      );

      // The charge must still BLOCK at zero. Rewriting this test around refunds
      // removed the only coverage of chargeSimulationToken's matchedCount === 0
      // branch — without this, an edit that made the charge non-blocking would
      // pass everything above.
      await users.updateOne({ username: 'smokeuser' }, { $set: { simulationTokens: 0 } });
      const brokeRes = await fetch(`${BASE}/api/generate-molecules`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
        body: JSON.stringify({ smi: 'CCO', num_molecules: 1 }),
      });
      const brokeBody = await brokeRes.json().catch(() => ({}));
      check('zero balance returns 403', brokeRes.status === 403, `(got ${brokeRes.status}: ${JSON.stringify(brokeBody)})`);
      check(
        'zero balance error is No simulation tokens left',
        brokeBody.error === 'No simulation tokens left',
        `(got ${JSON.stringify(brokeBody.error)})`
      );

      const afterBlocked = await users.findOne({ username: 'smokeuser' });
      check(
        'a blocked call does not drive the balance negative',
        afterBlocked?.simulationTokens === 0,
        `(got ${afterBlocked?.simulationTokens})`
      );

      await users.updateOne({ username: 'smokeuser' }, { $set: { simulationTokens: startingTokens } });
    }

    // --- Test 5: password reset flow (request + confirm) ---
    console.log('\nTest 5 — password reset (request + confirm):');
    await users.insertOne({
      username: 'resetuser',
      email: 'reset@example.com',
      password: await bcrypt.hash('OldResetPass1!', 10),
      verified: true,
      active: true,
      role: 'member',
      simulationTokens: 0,
      createdAt: new Date(),
    });

    // request: always 200 with a generic message, for known and unknown accounts
    // (no user enumeration). Email delivery isn't configured in the smoke env;
    // the endpoint swallows the send error and still returns 200.
    const reqKnown = await fetch(`${BASE}/api/password-reset/request`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'reset@example.com' }),
    });
    check('reset request (known account) returns 200', reqKnown.status === 200, `(got ${reqKnown.status})`);
    const reqUnknown = await fetch(`${BASE}/api/password-reset/request`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'nobody@example.com' }),
    });
    check('reset request (unknown account) still 200 — no enumeration', reqUnknown.status === 200, `(got ${reqUnknown.status})`);

    // confirm: mint a token exactly as the server does, then set a new password
    const validResetToken = jwt.sign(
      { reset: true, email: 'reset@example.com', username: 'resetuser' },
      SMOKE_JWT_SECRET,
      { expiresIn: '30m' }
    );
    const confirmRes = await fetch(`${BASE}/api/password-reset/confirm`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: validResetToken, password: 'NewResetPass1!' }),
    });
    const confirmBody = await confirmRes.json().catch(() => ({}));
    check('reset confirm returns 200', confirmRes.status === 200, `(got ${confirmRes.status}: ${JSON.stringify(confirmBody)})`);

    const newLogin = await fetch(`${BASE}/api/signin`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'resetuser', password: 'NewResetPass1!' }),
    });
    check('signin with the new password returns 200', newLogin.status === 200, `(got ${newLogin.status})`);
    const oldLogin = await fetch(`${BASE}/api/signin`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'resetuser', password: 'OldResetPass1!' }),
    });
    check('signin with the old password no longer works', oldLogin.status !== 200, `(got ${oldLogin.status})`);

    // rejects a bogus token and a policy-violating password
    const badToken = await fetch(`${BASE}/api/password-reset/confirm`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'not-a-jwt', password: 'NewResetPass1!' }),
    });
    check('reset confirm with invalid token returns 400', badToken.status === 400, `(got ${badToken.status})`);
    const weakPass = await fetch(`${BASE}/api/password-reset/confirm`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: validResetToken, password: 'weak' }),
    });
    check('reset confirm with weak password returns 400', weakPass.status === 400, `(got ${weakPass.status})`);

    // --- Test 5b: public signup is closed ---
    // This install is one product for one company (docs/PYXIS-ONLY.md). An open
    // /api/signup does not just create a user, it creates a COMPANY and makes the
    // caller its owner. The smoke env sets no ALLOW_PUBLIC_SIGNUP, which is the
    // production configuration, so the route must refuse — and refuse with 403,
    // because the client logs itself out on any same-origin 401.
    console.log('\nTest 5b — public signup is closed:');
    const signupRes = await fetch(`${BASE}/api/signup`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'walkin', password: 'WalkIn123!', email: 'walkin@example.com',
        organization: 'Someone Elses Lab',
      }),
    });
    const signupBody = await signupRes.json().catch(() => ({}));
    check('signup returns 403, not 200', signupRes.status === 403, `(got ${signupRes.status})`);
    check(
      'signup 403 is not the client-logout 401',
      signupRes.status !== 401,
      `(got ${signupRes.status})`
    );
    check(
      'signup error points at the invite path',
      typeof signupBody.error === 'string' && /invitation|administrator/i.test(signupBody.error),
      `(got ${JSON.stringify(signupBody.error)})`
    );
    check(
      'no user was created',
      (await users.findOne({ username: 'walkin' })) === null,
      '(a walk-in account exists)'
    );
    check(
      'no company was created',
      (await mongo.db().collection('companies').findOne({ name: 'Someone Elses Lab' })) === null,
      '(a walk-in company exists)'
    );

    // --- Test 5c: the invite path still creates a usable account ---
    // Closing signup made POST /api/company/members the ONLY way an account comes
    // into existence, and nothing exercised it. The three things that would each
    // silently break the product: the route refusing an admin, the new member
    // landing with zero credits (they would see "No simulation tokens left" on
    // every page), and the account not actually being able to sign in.
    console.log('\nTest 5c — an admin can invite a member who can then sign in:');
    const companies = mongo.db(DB_NAME).collection('companies');
    await companies.insertOne({
      companyId: 'comp_invite',
      name: 'Invite Test Lab',
      usagePolicy: { defaultSimulationTokensPerUser: 7 },
      createdAt: new Date(),
    });
    await users.insertOne({
      username: 'inviteowner',
      email: 'owner@example.com',
      password: await bcrypt.hash('OwnerPass1!', 10),
      companyId: 'comp_invite',
      role: 'owner',
      verified: true,
      active: true,
      simulationTokens: 0,
      createdAt: new Date(),
    });
    const ownerLogin = await fetch(`${BASE}/api/signin`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'inviteowner', password: 'OwnerPass1!' }),
    });
    const ownerToken = (await ownerLogin.json().catch(() => ({}))).token;
    check('owner can sign in', ownerLogin.status === 200 && !!ownerToken, `(got ${ownerLogin.status})`);

    const inviteRes = await fetch(`${BASE}/api/company/members`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ownerToken}` },
      body: JSON.stringify({
        username: 'invitee', email: 'invitee@example.com', password: 'InviteePass1!',
      }),
    });
    const inviteBody = await inviteRes.json().catch(() => ({}));
    check('invite returns 201', inviteRes.status === 201, `(got ${inviteRes.status}: ${JSON.stringify(inviteBody)})`);

    const invited = await users.findOne({ username: 'invitee' });
    check('invited member exists', !!invited, '(no user row)');
    check(
      'invited member inherits the company',
      invited?.companyId === 'comp_invite',
      `(got ${invited?.companyId})`
    );
    // The whole point of keeping the usage policy: an invited user who lands on
    // zero credits cannot run anything, and the UI only says "No simulation
    // tokens left" without explaining why.
    check(
      'invited member starts with the policy credit balance, not zero',
      invited?.simulationTokens === 7,
      `(got ${invited?.simulationTokens})`
    );

    const inviteeLogin = await fetch(`${BASE}/api/signin`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'invitee', password: 'InviteePass1!' }),
    });
    check('invited member can sign in', inviteeLogin.status === 200, `(got ${inviteeLogin.status})`);

    // A member must not be able to invite — otherwise closing signup bought nothing.
    const inviteeToken = (await inviteeLogin.json().catch(() => ({}))).token;
    const memberInvite = await fetch(`${BASE}/api/company/members`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${inviteeToken}` },
      body: JSON.stringify({ username: 'gatecrash', email: 'gatecrash@example.com' }),
    });
    check('a member cannot invite', memberInvite.status === 403, `(got ${memberInvite.status})`);

    // --- Test 5d: the demo session, and that it carries no password ---
    // The legacy page typed tester123/Tester!23 into the form from component
    // source that production served unminified. The button is a wanted feature
    // and stays; what must not come back is the credential in the client.
    console.log('\nTest 5d — demo session:');
    const demoOff = await fetch(`${BASE}/api/demo-session`);
    const demoOffBody = await demoOff.json().catch(() => ({}));
    check(
      'unset DEMO_USERNAME reports unavailable',
      demoOffBody.available === false,
      `(got ${JSON.stringify(demoOffBody)})`
    );
    const demoPostOff = await fetch(`${BASE}/api/demo-session`, { method: 'POST' });
    check(
      'POST with no demo configured returns 404, not a session',
      demoPostOff.status === 404,
      `(got ${demoPostOff.status})`
    );
    const demoOffPost = await demoPostOff.json().catch(() => ({}));
    check(
      'no token is issued when no demo is configured',
      !demoOffPost.token,
      '(a token came back)'
    );

    // --- Test 6: static serving (only with --assert-static) ---
    if (ASSERT_STATIC) {
      console.log('\nTest 6 — GET / serves built frontend HTML:');
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
