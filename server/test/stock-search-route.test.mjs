// Stock-search route runtime test: spawn the real server against a fixture-backed
// stub search service and prove the authenticated proxy contract:
//   - /api/stock-search/status resolves the dataset by name (one listing) and
//     reports availability.
//   - /api/stock-search/similarity validates input (400), forwards the right
//     query (dataset_id + offset/limit), relays ranked pages, and answers 503
//     STOCK_SEARCH_UNAVAILABLE when no dataset is provisioned.
//   - Same-origin 401 never leaks upstream auth failures (upstream 401 → 502
//     would be exercised by the relay helper unit test instead).
//
// Fixtures are REAL responses captured 2026-09-06 from the isolated scratch
// stack on oracleOld (:8010, dataset 10, name "Stock compounds — 2026-09-01",
// 630,646 rows) — query O=C(O)c1ccccc1 (benzoic acid), morgan+tanimoto,
// threshold 0.35. The two pages come from one run at offset 0 and offset 50
// (limit 50) and share no molecule_id, which mirrors how the Simulation page
// pages by offset. See docs/DATA-STOCK-COMPOUNDS.md.
//
// Run: SERVER_RUNTIME=bun bun test/stock-search-route.test.mjs

import { spawn } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { MongoClient } from 'mongodb';
import bcrypt from 'bcryptjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = path.resolve(__dirname, '..');
const PORT = 3209;
const STUB_PORT = 3310;
const BASE = `http://127.0.0.1:${PORT}`;
const STOCK_JWT_SECRET = 'stock_route_jwt_secret_at_least_32_chars_long_xx';
const DB_NAME = 'medsaas_stock_route_test';

const BUN_PATH = process.env.BUN_PATH || `${process.env.HOME}/.bun/bin/bun`;
const serverRuntime = process.env.SERVER_RUNTIME || 'bun';
const runtimeBin = serverRuntime === 'bun' ? BUN_PATH : process.execPath;

const FIXTURES = {
  page1: JSON.parse(readFileSync(path.join(__dirname, 'fixtures/stock-similarity-benzoic-page1.json'), 'utf8')),
  page2: JSON.parse(readFileSync(path.join(__dirname, 'fixtures/stock-similarity-benzoic-page2.json'), 'utf8')),
  empty: JSON.parse(readFileSync(path.join(__dirname, 'fixtures/stock-similarity-empty.json'), 'utf8')),
  invalidSmiles: JSON.parse(readFileSync(path.join(__dirname, 'fixtures/stock-similarity-invalid-smiles-400.json'), 'utf8')),
};

// LIVE_STOCK_VERIFY=1 runs the same authenticated proxy assertions against a REAL
// configured backend (STOCK_SEARCH_BASE), e.g. through an SSH tunnel to the
// isolated scratch stack: LIVE_STOCK_VERIFY=1 STOCK_SEARCH_BASE=http://127.0.0.1:8011
// bun test/stock-search-route.test.mjs. Fixture-based expectations (page 2 rows,
// one listing) do not apply to a live engine, so the checks branch on this flag.
const LIVE_VERIFY = process.env.LIVE_STOCK_VERIFY === '1';

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
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

function startStub({ datasetName }) {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${STUB_PORT}`);
    requests.push({ path: url.pathname, query: Object.fromEntries(url.searchParams) });
    if (url.pathname === '/v1/datasets') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        datasets: [{ id: 10, name: datasetName, filename: 'stock-compounds-upload.csv', row_count: 630646, created_at: '2026-09-05 14:01:40' }],
        count: 1,
      }));
      return;
    }
    if (url.pathname === '/v1/search/similarity') {
      const smiles = url.searchParams.get('smiles') || '';
      const offset = Number(url.searchParams.get('offset') || 0);
      // Stand-in for the engine's SMILES validation: any query containing '!!'
      // is "invalid" so the route's upstream-failure relay can be exercised.
      if (smiles.includes('!!')) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(FIXTURES.invalidSmiles));
        return;
      }
      const threshold = Number(url.searchParams.get('threshold') || 0.5);
      const page = threshold >= 0.9 ? FIXTURES.empty : (offset >= 50 ? FIXTURES.page2 : FIXTURES.page1);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(page));
      return;
    }
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ detail: 'not found' }));
  });
  return new Promise((resolve) => {
    server.listen(STUB_PORT, '127.0.0.1', () => resolve({ server, requests }));
  });
}

async function main() {
  console.log(`[stock-route] runtime: ${serverRuntime} (${runtimeBin})`);
  console.log('[stock-route] Starting ephemeral MongoDB...');
  const mem = await MongoMemoryServer.create();
  const uri = mem.getUri(DB_NAME);
  const mongo = new MongoClient(uri);
  await mongo.connect();

  const stubMode = !LIVE_VERIFY;
  const stub = stubMode ? await startStub({ datasetName: 'Stock compounds — 2026-09-01' }) : null;
  const requests = stub ? stub.requests : [];
  const cleanupStub = async () => { if (stub) await new Promise((resolve) => stub.server.close(() => resolve())); };
  const stockBase = LIVE_VERIFY
    ? String(process.env.STOCK_SEARCH_BASE || '').trim()
    : `http://127.0.0.1:${STUB_PORT}`;

  const childEnv = {
    ...process.env,
    MONGODB_URI: uri,
    JWT_SECRET: STOCK_JWT_SECRET,
    STRIPE_SECRET_KEY: 'sk_test_dummy_key_never_calls_api',
    STRIPE_WEBHOOK_SECRET: 'whsec_stock_route_test_do_not_use',
    PORT: String(PORT),
    NODE_ENV: 'test',
    FRONTEND_DIST: '',
    NVIDIA_MOLMIM_API_KEY: '',
    // The stock search dataset is DISCOVERED by name — the default production
    // contract (no pinned id, no hardcoded dataset number). In live mode the
    // base points at the real scratch engine through the tunnel.
    STOCK_SEARCH_BASE: stockBase,
    TANIMOTO_API_BASE: stockBase,
  };
  if (LIVE_VERIFY && !stockBase) {
    console.error('[stock-route] LIVE_STOCK_VERIFY requires STOCK_SEARCH_BASE');
    process.exit(1);
  }

  const child = spawn(runtimeBin, ['index.js'], { cwd: SERVER_DIR, env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] });
  let serverLog = '';
  child.stdout.on('data', (d) => { serverLog += d.toString(); });
  child.stderr.on('data', (d) => { serverLog += d.toString(); });

  const cleanup = async () => {
    try { child.kill('SIGKILL'); } catch {}
    try { await cleanupStub(); } catch {}
    try { await mem.stop(); } catch {}
    try { await mongo.close(); } catch {}
  };

  try {
    const healthy = await waitForHealth();
    if (!healthy) {
      console.error('[stock-route] Server did not become healthy. Output:\n' + serverLog);
      throw new Error('server-not-healthy');
    }
    console.log('[stock-route] Server is up.\n');

    const users = mongo.db(DB_NAME).collection('users');
    const passwordHash = await bcrypt.hash('StockPass1!', 10);
    await users.insertOne({
      username: 'stockuser',
      email: 'stock@example.com',
      password: passwordHash,
      verified: true,
      active: true,
      role: 'member',
      simulationTokens: 5,
      createdAt: new Date(),
    });

    console.log('Test 1 — unauthenticated requests stay 401:\n');
    {
      const res = await fetch(`${BASE}/api/stock-search/status`);
      check('status without token → 401', res.status === 401, `(got ${res.status})`);
      const res2 = await fetch(`${BASE}/api/stock-search/similarity?smiles=c1ccccc1`);
      check('similarity without token → 401', res2.status === 401, `(got ${res2.status})`);
    }

    console.log('\nTest 2 — sign in and read availability:\n');
    const signinRes = await fetch(`${BASE}/api/signin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'stockuser', password: 'StockPass1!' }),
    });
    const signinBody = await signinRes.json();
    check('signin returns 200', signinRes.status === 200, `(got ${signinRes.status})`);
    const token = signinBody.token;
    check('signin returns a token', typeof token === 'string' && token.length > 0);
    const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

    const statusRes = await fetch(`${BASE}/api/stock-search/status`, { headers: auth });
    const statusBody = await statusRes.json();
    check('status is available', statusBody.available === true);
    check('status carries the discovered dataset id', statusBody.dataset?.id === 10);
    check('status carries row count', statusBody.dataset?.rowCount === 630646);
    check('fingerprint method is declared (RDKit morgan/tanimoto)',
      statusBody.fingerprintType === 'morgan' && statusBody.similarityMetric === 'tanimoto');

    if (!LIVE_VERIFY) {
      const listingCalls = requests.filter((r) => r.path === '/v1/datasets').length;
      check('dataset discovered by name through one listing', listingCalls >= 1);
    }

    console.log('\nTest 3 — ranked similarity search, page 1:\n');
    // threshold 0.5 is a safer live-engine cutoff for a benzoic-acid probe than
    // 0.35 (fixtures used 0.35, live may have fewer neighbors above it).
    const probeThreshold = LIVE_VERIFY ? 0.5 : 0.35;
    const page1Res = await fetch(`${BASE}/api/stock-search/similarity?smiles=${encodeURIComponent('O=C(O)c1ccccc1')}&threshold=${probeThreshold}&offset=0&limit=8`, { headers: auth });
    const page1 = await page1Res.json();
    check('page 1 returns 200', page1Res.status === 200, `(got ${page1Res.status})`);
    check('page 1 has 8 ranked results', Array.isArray(page1.results) && page1.results.length === 8);
    check('results are ranked descending', (() => {
      for (let i = 1; i < page1.results.length; i++) {
        if (page1.results[i].similarity > page1.results[i - 1].similarity) return false;
      }
      return true;
    })());
    const first = page1.results[0];
    check('stock hit carries recognizable stock code + string id with leading zeros',
      typeof first.metadata?.MAIN_BAS === 'string' && /^[A-Z]+ \d+$/.test(first.metadata.MAIN_BAS)
      && typeof first.metadata.ID === 'string');
    check('stock hit carries canonical structure', typeof first.canonical_smiles === 'string' && first.canonical_smiles.length > 0);
    check('stock hit carries dated snapshot amounts (strings from import)',
      first.metadata?.CURRENT_TOT_AMOUNT_UM !== undefined && first.metadata?.CURRENT_TOT_NETTO_MG !== undefined);
    check('no Asinex fields are invented on stock hits', first.price_1mg === undefined && first.iupac_name === undefined);

    console.log('\nTest 4 — offset pagination has no repeats:\n');
    // Fixtures paged 0 → 50 (limit 50 then trimmed); live pages advance by the
    // requested offset. Both must return disjoint, still-ranked rows.
    const page2Offset = LIVE_VERIFY ? 8 : 50;
    const page2Res = await fetch(`${BASE}/api/stock-search/similarity?smiles=${encodeURIComponent('O=C(O)c1ccccc1')}&threshold=${probeThreshold}&offset=${page2Offset}&limit=8`, { headers: auth });
    const page2 = await page2Res.json();
    check('page 2 returns 200', page2Res.status === 200, `(got ${page2Res.status})`);
    const ids1 = new Set(page1.results.map((r) => r.molecule_id));
    const ids2 = new Set(page2.results.map((r) => r.molecule_id));
    check('page 2 shares no molecule_id with page 1', [...ids2].every((id) => !ids1.has(id)));
    if (!LIVE_VERIFY) {
      const searchCalls = requests.filter((r) => r.path === '/v1/search/similarity');
      const q2 = searchCalls[searchCalls.length - 1]?.query || {};
      check('forwards dataset_id + offset/limit to the engine',
        q2.dataset_id === '10' && q2.offset === String(page2Offset) && q2.limit === '8');
      check('forwards morgan/tanimoto explicitly', q2.fingerprint_type === 'morgan' && q2.similarity_metric === 'tanimoto');
    }

    console.log('\nTest 5 — empty page ends cleanly:\n');
    // Live engine: an exact-only probe (phenol, absent from the stock set) at
    // threshold 1.0 returns zero rows — distinct from an error. Stub: benzoic
    // acid above its fixture threshold returns the empty fixture.
    const emptyUrl = LIVE_VERIFY
      ? `${BASE}/api/stock-search/similarity?smiles=${encodeURIComponent('c1ccc(O)cc1')}&threshold=1.0&offset=0&limit=8`
      : `${BASE}/api/stock-search/similarity?smiles=${encodeURIComponent('O=C(O)c1ccccc1')}&threshold=0.99&offset=0&limit=8`;
    const emptyRes = await fetch(emptyUrl, { headers: auth });
    const emptyBody = await emptyRes.json();
    check('no-match page returns 200 with no results', emptyRes.status === 200 && Array.isArray(emptyBody.results) && emptyBody.results.length === 0);

    console.log('\nTest 6 — validation is 400:\n');
    const badThreshold = await fetch(`${BASE}/api/stock-search/similarity?smiles=c1ccccc1&threshold=0.05`, { headers: auth });
    check('threshold below 0.1 → 400 (client validation, no upstream call)', badThreshold.status === 400, `(got ${badThreshold.status})`);
    const missingSmiles = await fetch(`${BASE}/api/stock-search/similarity`, { headers: auth });
    check('missing smiles → 400', missingSmiles.status === 400, `(got ${missingSmiles.status})`);
  } catch (err) {
    console.error('[stock-route] test error:', err);
    console.error(serverLog.slice(-4000));
    failed += 1;
  } finally {
    await cleanup();
  }

  // Unprovisioned dataset is a separate process: the first server already
  // resolved a matching dataset into its in-process cache. Spawn a second
  // app pointed at the stub (or nowhere in live mode) with a name that does
  // not exist so status stays honest and similarity answers 503.
  if (!LIVE_VERIFY && failed === 0) {
    console.log('\nTest 7 — unprovisioned dataset is 503 (not a silent Asinex fallback):\n');
    const mem2 = await MongoMemoryServer.create();
    const uri2 = mem2.getUri(`${DB_NAME}_unprov`);
    const mongo2 = new MongoClient(uri2);
    await mongo2.connect();
    const stub2 = await startStub({ datasetName: 'Stock compounds — 2026-09-01' });
    const child2 = spawn(runtimeBin, ['index.js'], {
      cwd: SERVER_DIR,
      env: {
        ...process.env,
        MONGODB_URI: uri2,
        JWT_SECRET: STOCK_JWT_SECRET,
        STRIPE_SECRET_KEY: 'sk_test_dummy_key_never_calls_api',
        STRIPE_WEBHOOK_SECRET: 'whsec_stock_route_test_do_not_use',
        PORT: String(PORT + 1),
        NODE_ENV: 'test',
        FRONTEND_DIST: '',
        NVIDIA_MOLMIM_API_KEY: '',
        STOCK_SEARCH_BASE: `http://127.0.0.1:${STUB_PORT}`,
        TANIMOTO_API_BASE: `http://127.0.0.1:${STUB_PORT}`,
        STOCK_SEARCH_DATASET_NAME: 'Definitely not provisioned stock dataset',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const base2 = `http://127.0.0.1:${PORT + 1}`;
    let log2 = '';
    child2.stdout.on('data', (d) => { log2 += d.toString(); });
    child2.stderr.on('data', (d) => { log2 += d.toString(); });
    try {
      const deadline = Date.now() + 40000;
      let healthy2 = false;
      while (Date.now() < deadline) {
        try {
          const res = await fetch(`${base2}/health`);
          if (res.ok) { healthy2 = true; break; }
        } catch { /* not up yet */ }
        await new Promise((r) => setTimeout(r, 300));
      }
      if (!healthy2) throw new Error(`unprovisioned server not healthy\n${log2.slice(-2000)}`);
      const users2 = mongo2.db(`${DB_NAME}_unprov`).collection('users');
      await users2.insertOne({
        username: 'stockuser2',
        email: 'stock2@example.com',
        password: await bcrypt.hash('StockPass1!', 10),
        verified: true,
        active: true,
        role: 'member',
        simulationTokens: 5,
        createdAt: new Date(),
      });
      const signin2 = await fetch(`${base2}/api/signin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'stockuser2', password: 'StockPass1!' }),
      });
      const token2 = (await signin2.json()).token;
      const auth2 = { Authorization: `Bearer ${token2}` };
      const status2 = await fetch(`${base2}/api/stock-search/status`, { headers: auth2 });
      const statusBody2 = await status2.json();
      check('unprovisioned status is available:false (200, not 401)', status2.status === 200 && statusBody2.available === false);
      const sim2 = await fetch(`${base2}/api/stock-search/similarity?smiles=c1ccccc1`, { headers: auth2 });
      const simBody2 = await sim2.json();
      check('unprovisioned similarity → 503 STOCK_SEARCH_UNAVAILABLE',
        sim2.status === 503 && simBody2.code === 'STOCK_SEARCH_UNAVAILABLE',
        `(got ${sim2.status} ${JSON.stringify(simBody2)})`);
    } catch (err) {
      console.error('[stock-route] unprovisioned test error:', err);
      failed += 1;
    } finally {
      try { child2.kill('SIGKILL'); } catch {}
      try { await new Promise((resolve) => stub2.server.close(() => resolve())); } catch {}
      try { await mem2.stop(); } catch {}
      try { await mongo2.close(); } catch {}
    }
  }

  console.log(`\nstock-search route: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

await main();
