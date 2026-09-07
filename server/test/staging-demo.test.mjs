// Staging/demo-mode test: boots server/index.js with PYXIS_DEMO_MODE=true and
// NO database, then proves the demo/staging contract:
//
//   1. Demo sign-in + validate-token (server-controlled demo identity).
//   2. Fixture folding predict returns usable PDB/mmCIF placeholder structures
//      (labelled demo) with no outbound call; malformed input -> 400.
//   3. Folding history: save/list/get/search/rename/blob/delete, pagination,
//      blob-size limits with no partial save, and a truthful usable-result
//      story on save failure (client keeps the result; save just reports).
//   4. Privacy: conjunctive owner filter — same-company peers, different-company
//      users and company-less users all get 404/empty for each other's runs.
//   5. Cross-environment tokens rejected: a token signed with another secret
//      (the "production" secret) is a dead session (401) here.
//   6. Demo mode refuses paid providers/billing/outbound scientific endpoints
//      (403 DEMO_MODE_DISABLED) even when called by hand, and no /api path
//      silently falls through to a Mongo-backed handler (503 DEMO_MODE_UNAVAILABLE).
//
// Run: SERVER_RUNTIME=bun bun test/staging-demo.test.mjs
//      SERVER_RUNTIME=node node test/staging-demo.test.mjs

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import jwt from 'jsonwebtoken';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = path.resolve(__dirname, '..');

const PORT = 3299;
const BASE = `http://127.0.0.1:${PORT}`;
const DEMO_SECRET = 'staging_demo_test_secret_0123456789abcdefghijklmnop';
const PROD_SECRET = 'production_test_secret_9876543210zyxwvutsrqponmlkjih';
const BUN_PATH = process.env.BUN_PATH || `${process.env.HOME}/.bun/bin/bun`;
const serverRuntime = process.env.SERVER_RUNTIME || 'bun';
const runtimeBin = serverRuntime === 'bun' ? BUN_PATH : process.execPath;

let passed = 0;
let failed = 0;
function check(label, cond, extra = '') {
  if (cond) {
    console.log(`  ✓ ${label}`);
    passed += 1;
  } else {
    console.log(`  ✗ ${label} ${extra}`);
    failed += 1;
  }
}

async function waitForHealth(timeoutMs = 40000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/health`);
      if (res.ok) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

async function api(method, p, { token, body, raw } = {}) {
  const res = await fetch(`${BASE}${p}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined && !raw ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body !== undefined && !raw ? JSON.stringify(body) : raw,
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: res.status, json, text, headers: res.headers };
}

const PROTEIN_ENTITIES = [
  { type: 'protein', id: 'A', sequence: 'MGRTWKLV' },
];

function foldBody(entities = PROTEIN_ENTITIES, outputFormat = 'pdb', requestId = 't1') {
  return {
    request_id: requestId,
    inputs: [
      {
        input_id: requestId,
        molecules: entities,
        output_format: outputFormat,
      },
    ],
  };
}

function saveBody(name, structureText, extra = {}) {
  return {
    name,
    provider: 'pyxis-staging-demo-fixture',
    providerVersion: '1',
    source: 'demo-predict',
    demo: true,
    request: {
      requestId: 't1',
      outputFormat: 'pdb',
      entities: [{ id: 'A', type: 'protein', length: 8 }],
    },
    structures: [{ name: 's1', format: 'pdb', text: structureText }],
    ...extra,
  };
}

const DEMO_JWT = (secret = DEMO_SECRET, overrides = {}) =>
  jwt.sign(
    {
      userId: 'staging-tester-1',
      username: 'pyxis-staging-tester',
      companyId: null,
      role: 'member',
      demo: true,
      ...overrides,
    },
    secret,
    { expiresIn: '1h' }
  );

async function main() {
  console.log(`[staging-demo] runtime: ${serverRuntime}`);
  const childEnv = {
    ...process.env,
    PYXIS_DEMO_MODE: 'true',
    JWT_SECRET: DEMO_SECRET,
    PORT: String(PORT),
    BIND_HOST: '127.0.0.1',
    NODE_ENV: 'test',
    FRONTEND_DIST: '', // hermetic: no client build needed for these checks
    MONGODB_URI: '',   // demo mode must not need or use a database
    STRIPE_SECRET_KEY: '',
  };

  const child = spawn(runtimeBin, ['index.js'], {
    cwd: SERVER_DIR,
    env: childEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let serverLog = '';
  child.stdout.on('data', (d) => { serverLog += d.toString(); });
  child.stderr.on('data', (d) => { serverLog += d.toString(); });

  const cleanup = async () => {
    try { child.kill('SIGKILL'); } catch { /* ignore */ }
  };

  try {
    const healthy = await waitForHealth();
    if (!healthy) {
      console.error('[staging-demo] Server did not become healthy. Output:\n' + serverLog);
      throw new Error('server-not-healthy');
    }
    console.log('[staging-demo] Demo server is up.\n');

    // --- 1. Status / demo sign-in / validate-token ---------------------------
    console.log('Test 1 — demo status, sign-in and token validation:');
    let r = await api('GET', '/api/staging/status');
    check('status 200', r.status === 200);
    check('status reports demo + fixture + history', r.json?.demo === true && r.json?.provider === 'fixture' && r.json?.historyAvailable === true, JSON.stringify(r.json));

    r = await api('GET', '/api/demo-session');
    check('demo availability advertises true', r.json?.available === true, JSON.stringify(r.json));

    r = await api('POST', '/api/demo-session');
    const demoToken = r.json?.token;
    check('demo sign-in returns token', typeof demoToken === 'string' && demoToken.length > 10);
    check('demo user is the synthetic test account', r.json?.user?.username === 'pyxis-staging-tester' && r.json?.user?.companyId === null, JSON.stringify(r.json?.user));

    r = await api('POST', '/api/validate-token', { token: demoToken });
    check('validate-token accepts demo token', r.status === 200 && r.json?.valid === true, JSON.stringify(r.json));

    // --- 2. Fixture prediction ----------------------------------------------
    console.log('\nTest 2 — fixture predict (no outbound provider):');
    r = await api('POST', '/api/openfold3/predict', { token: demoToken, body: foldBody() });
    check('protein PDB predict 200', r.status === 200, `got ${r.status}`);
    const pdbText = r.json?.outputs?.[0]?.structures_with_scores?.[0]?.structure || '';
    check('response labelled demo', r.json?._pyxisDemo === true, JSON.stringify(r.json));
    check('PDB text has ATOM records', pdbText.includes('ATOM'));
    check('entity summary returned (A protein 8 aa)', JSON.stringify(r.json?._pyxisEntitySummary)?.includes('"length":8'), JSON.stringify(r.json?._pyxisEntitySummary));

    r = await api('POST', '/api/openfold3/predict', { token: demoToken, body: foldBody(PROTEIN_ENTITIES, 'mmcif', 't2') });
    const cifText = r.json?.outputs?.[0]?.structures_with_scores?.[0]?.structure || '';
    check('protein mmCIF predict starts with data_', cifText.trimStart().startsWith('data_'));

    r = await api('POST', '/api/openfold3/predict', { token: demoToken, body: foldBody([{ type: 'protein', id: 'A', sequence: '' }]) });
    check('empty chain predict -> 400', r.status === 400, `got ${r.status} ${r.text}`);

    r = await api('POST', '/api/openfold3/predict', { token: demoToken, body: { inputs: [] } });
    check('no molecules -> 400', r.status === 400);

    // --- 3. History CRUD, pagination, limits ---------------------------------
    console.log('\nTest 3 — history save/list/get/rename/search/blob/delete:');
    r = await api('POST', '/api/folding-history', { token: demoToken, body: saveBody('crambin-ish run', pdbText) });
    check('save run 201', r.status === 201, `got ${r.status} ${r.text}`);
    const runId = r.json?.run?.runId;
    check('run id present', typeof runId === 'string' && runId.length > 10);

    r = await api('POST', '/api/folding-history', { token: demoToken, body: saveBody('second run', pdbText) });
    check('save second run 201', r.status === 201);

    r = await api('POST', '/api/folding-history', { token: demoToken, body: saveBody('third run', pdbText) });
    check('save third run 201', r.status === 201);

    r = await api('GET', '/api/folding-history?page=1&pageSize=2', { token: demoToken });
    check('list pageSize=2 returns 2 items', r.json?.items?.length === 2, JSON.stringify(r.json));
    check('list reports total 3', r.json?.total === 3, JSON.stringify(r.json));
    check('list rows are small (no coordinate text)', r.json?.items?.every((i) => !('structuresWithText' in i) && !('blobs' in i) && typeof i.structureCount === 'number'));

    r = await api('GET', '/api/folding-history?page=2&pageSize=2', { token: demoToken });
    check('page 2 returns remaining 1', r.json?.items?.length === 1 && r.json?.total === 3, JSON.stringify(r.json));

    r = await api('GET', '/api/folding-history?search=crambin', { token: demoToken });
    check('search finds the named run', r.json?.total === 1, JSON.stringify(r.json));

    r = await api('GET', `/api/folding-history/${runId}`, { token: demoToken });
    check('get returns full run with coordinate text', r.json?.run?.structuresWithText?.[0]?.text?.includes('ATOM'), JSON.stringify(r.json?.run ? Object.keys(r.json.run) : null));

    r = await api('PATCH', `/api/folding-history/${runId}`, { token: demoToken, body: { name: 'renamed run' } });
    check('rename 200', r.status === 200 && r.json?.run?.name === 'renamed run', r.text);

    r = await api('GET', `/api/folding-history/${runId}/blob/0`, { token: demoToken });
    check('blob download 200 with disposition', r.status === 200 && r.headers.get('content-disposition')?.includes('.pdb'), `got ${r.status}`);
    check('blob download returns PDB text', r.text.includes('ATOM'));

    // Save failure leaves prior state intact and the client keeps the result:
    // the API answers a clear 413/400 without persisting a partial run.
    r = await api('POST', '/api/folding-history', { token: demoToken, body: saveBody('too big', 'A'.repeat(3 * 1024 * 1024 + 1)) });
    check('oversized structure save -> 413', r.status === 413 && r.json?.code === 'FOLD_STRUCTURE_TOO_LARGE', `got ${r.status} ${r.text.slice(0, 120)}`);
    r = await api('GET', '/api/folding-history', { token: demoToken });
    check('no partial run persisted after failed save', r.json?.total === 3, JSON.stringify(r.json));

    r = await api('POST', '/api/folding-history', { token: demoToken, body: saveBody('', pdbText) });
    check('empty name -> 400', r.status === 400 && r.json?.code === 'FOLD_NAME_REQUIRED');
    r = await api('POST', '/api/folding-history', { token: demoToken, body: { name: 'x', structures: [] } });
    check('no structures -> 400', r.status === 400 && r.json?.code === 'FOLD_NO_STRUCTURES');

    // --- 4. Privacy: conjunctive owner filter --------------------------------
    console.log('\nTest 4 — history privacy (owner only, same-company peers excluded):');
    const peerSameCompany = DEMO_JWT(DEMO_SECRET, { userId: 'u2', username: 'peer2', companyId: 'compX' });
    const peerSameCompany3 = DEMO_JWT(DEMO_SECRET, { userId: 'u3', username: 'peer3', companyId: 'compX' });
    const otherCompany = DEMO_JWT(DEMO_SECRET, { userId: 'u4', username: 'elsewhere', companyId: 'otherComp' });
    const noCompany = DEMO_JWT(DEMO_SECRET, { userId: 'u5', username: 'loner', companyId: null });

    r = await api('POST', '/api/folding-history', { token: peerSameCompany, body: saveBody('peer run', pdbText) });
    check('company peer can save own run', r.status === 201);

    r = await api('GET', '/api/folding-history', { token: peerSameCompany });
    check('owner sees own run only', r.json?.total === 1, JSON.stringify(r.json));

    // Same-company peer (different user) must not list/get/blob/rename/delete.
    r = await api('GET', '/api/folding-history', { token: peerSameCompany3 });
    check('same-company peer sees no runs', r.json?.total === 0, JSON.stringify(r.json));
    r = await api('GET', `/api/folding-history/${runId}`, { token: peerSameCompany3 });
    check('same-company peer get -> 404', r.status === 404, `got ${r.status}`);
    r = await api('GET', `/api/folding-history/${runId}/blob/0`, { token: peerSameCompany3 });
    check('same-company peer blob -> 404', r.status === 404);
    r = await api('PATCH', `/api/folding-history/${runId}`, { token: peerSameCompany3, body: { name: 'hijack' } });
    check('same-company peer rename -> 404', r.status === 404);
    r = await api('DELETE', `/api/folding-history/${runId}`, { token: peerSameCompany3 });
    check('same-company peer delete -> 404', r.status === 404);

    r = await api('GET', `/api/folding-history/${runId}`, { token: otherCompany });
    check('different-company user get -> 404', r.status === 404);
    r = await api('GET', '/api/folding-history', { token: noCompany });
    check('company-less user lists nothing of others', r.json?.total === 0);

    // Demo user (company null) still cannot touch the peer-company run.
    r = await api('GET', `/api/folding-history/${runId}`, { token: demoToken });
    check('run still owned by demo user', r.status === 200);

    // Owner delete works and is scoped.
    r = await api('DELETE', `/api/folding-history/${runId}`, { token: demoToken });
    check('owner delete 200', r.status === 200 && r.json?.ok === true);
    r = await api('GET', `/api/folding-history/${runId}`, { token: demoToken });
    check('deleted run gone', r.status === 404);

    // --- 5. Cross-environment tokens -----------------------------------------
    console.log('\nTest 5 — cross-environment token rejection:');
    const prodToken = jwt.sign(
      { userId: 'prod-owner', username: 'prod-user', companyId: 'prodCompany', role: 'owner' },
      PROD_SECRET,
      { expiresIn: '1h' }
    );
    r = await api('GET', '/api/folding-history', { token: prodToken });
    check('production-signed token rejected (401)', r.status === 401, `got ${r.status}`);
    r = await api('POST', '/api/openfold3/predict', { token: prodToken, body: foldBody() });
    check('production-signed token rejected on predict (401)', r.status === 401, `got ${r.status}`);
    r = await api('POST', '/api/validate-token', { token: prodToken });
    check('production-signed token rejected on validate-token (401)', r.status === 401, `got ${r.status}`);

    // --- 6. Demo mode refuses paid/outbound execution ------------------------
    console.log('\nTest 6 — demo mode refuses paid providers and billing:');
    for (const [method, p, body] of [
      ['POST', '/api/generate-molecules', { smiles: 'CCO' }], // NVIDIA MolMIM
      ['POST', '/create-checkout-session', { plan: 'Standard' }],
      ['POST', '/create-checkout-session-onetime', { plan: 'Standard' }],
      ['POST', '/api/shop', {}],
      ['POST', '/send-email', {}],
      ['POST', '/api/diffdock/generate_file', {}], // local-script flow stays off
    ]) {
      r = await api(method, p, { token: demoToken, body });
      check(`${method} ${p} refused 403`, r.status === 403 && r.json?.code === 'DEMO_MODE_DISABLED', `got ${r.status} ${r.text.slice(0, 80)}`);
    }

    // /api/simulation and /api/diffdock/generate are REAL docking routes on
    // staging (owner-authorized). An empty body must fail validation (400)
    // BEFORE any outbound call, never be refused or silently proxied.
    r = await api('POST', '/api/simulation', { token: demoToken, body: {} });
    check('POST /api/simulation {} -> 400 validation (route enabled)', r.status === 400 && !r.json?.code?.includes('DEMO'), `got ${r.status} ${r.text.slice(0, 80)}`);
    r = await api('POST', '/api/diffdock/generate', { token: demoToken, body: {} });
    check('POST /api/diffdock/generate {} -> 400 validation (route enabled)', r.status === 400 && !r.json?.code?.includes('DEMO'), `got ${r.status} ${r.text.slice(0, 80)}`);

    console.log('\nTest 7 — no silent fallthrough to a Mongo-backed API:');
    // Simulation history is served from the in-process store: honest empty list
    // (no DB, no 503 loop), populated only by real docking runs.
    r = await api('GET', '/api/simulation-logs', { token: demoToken });
    check('simulation-logs returns 200 empty list', r.status === 200 && Array.isArray(r.json) && r.json.length === 0, `got ${r.status} ${r.text.slice(0, 80)}`);
    r = await api('POST', '/api/openfold3/not-a-real-route', { token: demoToken, body: {} });
    check('unknown openfold3 sub-path -> 503 (never reaches a provider)', r.status === 503 && r.json?.code === 'DEMO_MODE_UNAVAILABLE', `got ${r.status} ${r.text.slice(0, 80)}`);
    r = await api('GET', '/api/company/branding', { token: demoToken });
    check('branding fallthrough -> 503 (no DB)', r.status === 503, `got ${r.status}`);

    r = await api('GET', '/health/db');
    check('health/db reports demo (no MongoDB)', r.status === 200 && r.json?.demo === true, JSON.stringify(r.json));

    // --- Summary --------------------------------------------------------------
    console.log(`\n[staging-demo] ${passed} passed, ${failed} failed`);
    if (failed > 0) {
      console.error('[staging-demo] Server output:\n' + serverLog.slice(-4000));
    }
    await cleanup();
    process.exit(failed > 0 ? 1 : 0);
  } catch (err) {
    console.error('[staging-demo] Fatal:', err.message);
    await cleanup();
    process.exit(1);
  }
}

main();
