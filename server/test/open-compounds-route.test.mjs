// Open-compounds route smoke: auth + validation + stubbed ChEMBL proxy.
// Run: SERVER_RUNTIME=bun bun test/open-compounds-route.test.mjs
//
 // LIVE_OPEN_VERIFY=1 hits real ChEMBL (network) for the reference SMILES.

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
const PORT = 3211;
const STUB_PORT = 3312;
const BASE = `http://127.0.0.1:${PORT}`;
const JWT_SECRET = 'open_compounds_route_jwt_secret_at_least_32_chars';
const DB_NAME = 'medsaas_open_compounds_route_test';
const REF = 'c1ccc2c(c1)nc(s2)SCC(=O)O';
const LIVE = process.env.LIVE_OPEN_VERIFY === '1';

const BUN_PATH = process.env.BUN_PATH || `${process.env.HOME}/.bun/bin/bun`;
const serverRuntime = process.env.SERVER_RUNTIME || 'bun';
const runtimeBin = serverRuntime === 'bun' ? BUN_PATH : process.execPath;

const FIXTURE = JSON.parse(readFileSync(path.join(__dirname, 'fixtures/open-chembl-reference-70.json'), 'utf8'));

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
    } catch { /* wait */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

function startStub() {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${STUB_PORT}`);
    requests.push({ path: url.pathname, query: Object.fromEntries(url.searchParams) });
    if (url.pathname.includes('/similarity/')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(FIXTURE));
      return;
    }
    res.writeHead(404).end('nope');
  });
  return new Promise((resolve) => {
    server.listen(STUB_PORT, '127.0.0.1', () => resolve({ server, requests }));
  });
}

async function main() {
  console.log(`[open-route] runtime: ${serverRuntime}`);
  const mem = await MongoMemoryServer.create();
  const uri = mem.getUri(DB_NAME);
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(DB_NAME);
  const passwordHash = await bcrypt.hash('OpenTest1!', 10);
  await db.collection('users').insertOne({
    username: 'open_tester',
    email: 'open@example.com',
    password: passwordHash,
    verified: true,
    active: true,
    role: 'member',
    simulationTokens: 10,
    createdAt: new Date(),
  });

  const stub = LIVE ? null : await startStub();
  const chemblBase = LIVE
    ? 'https://www.ebi.ac.uk/chembl/api/data'
    : `http://127.0.0.1:${STUB_PORT}`;

  const child = spawn(runtimeBin, ['index.js'], {
    cwd: SERVER_DIR,
    env: {
      ...process.env,
      PORT: String(PORT),
      MONGODB_URI: uri,
      JWT_SECRET,
      STRIPE_SECRET_KEY: 'sk_test_open_compounds_dummy_key_xxxxx',
      STRIPE_WEBHOOK_SECRET: 'whsec_open_compounds_test_do_not_use',
      NODE_ENV: 'test',
      FRONTEND_DIST: '',
      OPEN_COMPOUNDS_BASE: chemblBase,
      OPEN_COMPOUNDS_ENABLED: 'true',
      TANIMOTO_API_BASE: 'http://127.0.0.1:9',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logs = '';
  child.stdout.on('data', (d) => { logs += d.toString(); });
  child.stderr.on('data', (d) => { logs += d.toString(); });

  try {
    const up = await waitForHealth();
    check('server health', up, logs.slice(-500));
    if (!up) throw new Error('server failed to start');

    const login = await fetch(`${BASE}/api/signin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'open_tester', password: 'OpenTest1!' }),
    });
    const loginBody = await login.json();
    check('signin ok', login.ok && loginBody.token, JSON.stringify(loginBody).slice(0, 200));
    const token = loginBody.token;

    const unauth = await fetch(`${BASE}/api/open-compounds/status`);
    check('status requires auth (401)', unauth.status === 401);

    const status = await fetch(`${BASE}/api/open-compounds/status`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const statusBody = await status.json();
    check('status available', status.ok && statusBody.available === true);
    check('status declares external send', statusBody.sendsQueryExternally === true);
    check('AI disabled by default', statusBody.ai && statusBody.ai.enabled === false);

    const aiUnauth = await fetch(`${BASE}/api/open-compounds/ai-search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ smiles: REF, threshold: 0.7, maxResults: 10 }),
    });
    check('ai-search requires auth (401)', aiUnauth.status === 401);

    const aiOff = await fetch(`${BASE}/api/open-compounds/ai-search`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ smiles: REF, threshold: 0.7, maxResults: 10 }),
    });
    const aiOffBody = await aiOff.json().catch(() => ({}));
    check('ai-search unavailable without AI config (503)', aiOff.status === 503 && aiOffBody.code === 'OPEN_COMPOUNDS_AI_UNAVAILABLE');

    const bad = await fetch(`${BASE}/api/open-compounds/similarity?threshold=0.7`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    check('similarity without smiles -> 400', bad.status === 400);

    const low = await fetch(`${BASE}/api/open-compounds/similarity?smiles=${encodeURIComponent(REF)}&threshold=0.2`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    check('threshold below floor -> 400', low.status === 400);

    const sim = await fetch(
      `${BASE}/api/open-compounds/similarity?smiles=${encodeURIComponent(REF)}&threshold=0.7&limit=20&maxResults=100`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const simBody = await sim.json();
    check('similarity 200', sim.ok, JSON.stringify(simBody).slice(0, 300));
    check('returns ranked ChEMBL hits', Array.isArray(simBody.results) && simBody.results.length >= 1);
    check('top similarity is 1.0 for self-hit', simBody.results[0]?.similarity === 1);
    check('all results meet threshold', simBody.results.every((r) => r.similarity >= 0.7));
    check('public ids present', simBody.results.every((r) => /^CHEMBL\d+$/.test(r.chemblId)));
    check('source links present', simBody.results.every((r) => String(r.sourceUrl || '').includes('chembl')));
    check('fingerprint declared on payload', simBody.fingerprint?.nBits === 2048);
    check('honest ranking note', /retrieved candidates/i.test(simBody.retrieval?.rankingNote || ''));

    // Pagination: page size 2
    const page1 = await fetch(
      `${BASE}/api/open-compounds/similarity?smiles=${encodeURIComponent(REF)}&threshold=0.7&limit=2&offset=0&maxResults=100`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const p1 = await page1.json();
    const page2 = await fetch(
      `${BASE}/api/open-compounds/similarity?smiles=${encodeURIComponent(REF)}&threshold=0.7&limit=2&offset=2&maxResults=100`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const p2 = await page2.json();
    check('page1 has 2 rows', p1.results?.length === 2);
    check('pages share no chembl ids', {
      ok: p1.results.every((r) => !p2.results.some((x) => x.chemblId === r.chemblId)),
    }.ok);
    check('combined pages preserve global ranks', p1.results[0].rank === 1 && p2.results[0].rank === 3);

    const csvRes = await fetch(
      `${BASE}/api/open-compounds/export?format=csv&smiles=${encodeURIComponent(REF)}&threshold=0.7&maxResults=100`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const csvText = await csvRes.text();
    check('csv export ok', csvRes.ok && csvText.includes('chembl_id') && csvText.includes('CHEMBL1373993'));

    const sdfRes = await fetch(
      `${BASE}/api/open-compounds/export?format=sdf&smiles=${encodeURIComponent(REF)}&threshold=0.7&maxResults=100`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const sdfText = await sdfRes.text();
    check('sdf export ok', sdfRes.ok && sdfText.includes('$$$$') && sdfText.includes('DOCKING_READY'));
  } finally {
    child.kill('SIGTERM');
    stub?.server.close();
    await client.close();
    await mem.stop();
  }

  console.log(`\n[open-route] ${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
