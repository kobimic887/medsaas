// Staging Simulation test: boots server/index.js with PYXIS_DEMO_MODE=true, no
// database, and fixture upstream services for the ASINEX catalog, docking and
// SDF conversion. Proves the Simulation surface is usable on staging WITHOUT
// any real outbound call:
//
//   1. Catalog browse pagination + single-compound lookups (passthrough of the
//      live-read-only Asinex mirror).
//   2. BAS / substructure / similarity / molecular-weight search genuinely
//      operate on the upstream collection — no canned results, no invented
//      scores; an arbitrary query returns [] exactly like the upstream.
//   3. Unsupported /api4 methods are rejected; stock search honestly reports
//      503 STOCK_SEARCH_UNAVAILABLE (never a silent Asinex fallback).
//   4. Real docking POST /api/simulation stores a run in the in-process store
//      (simulation_logs ownership semantics), answers artifacts from it, and
//      serves a cache hit WITHOUT a second provider call.
//   5. Privacy: different users cannot list/get/download each other's runs.
//   6. Paid/unimplemented neighbours (ADMET sub-route, diffdock/generate_file,
//      checkout) stay refused with explanatory 403s.
//
// DiffDock's happy path needs files.rcsb.org outbound so it is NOT exercised
// here — validation and refusal coverage only (see docs/STAGING.md).
//
// Run: SERVER_RUNTIME=bun bun test/staging-simulation.test.mjs
//      SERVER_RUNTIME=node node test/staging-simulation.test.mjs

import { spawn } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import jwt from 'jsonwebtoken';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = path.resolve(__dirname, '..');

const PORT = 3301;
const BASE = `http://127.0.0.1:${PORT}`;
const DEMO_SECRET = 'staging_sim_test_secret_0123456789abcdefghijklmnopqrstuvwxy';
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

async function waitForHealth(timeoutMs = 40000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/health`);
      if (res.ok) return true;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

const DEMO_JWT = (secret = DEMO_SECRET, overrides = {}) =>
  jwt.sign(
    { userId: 'staging-tester-1', username: 'pyxis-staging-tester', companyId: null, role: 'member', demo: true, ...overrides },
    secret,
    { expiresIn: '1h' }
  );

// ---------------------------------------------------------------- fixtures ----
const SMILES_POOL = [
  'c1ccccc1',                     // benzene
  'CC(=O)Oc1ccccc1C(=O)O',        // aspirin
  'CCO',                          // ethanol
  'CC',                           // ethane
  'c1ccc(cc1)O',                  // phenol
  'O=C(O)c1ccccc1',               // benzoic acid
  'CCCCO',                        // butanol
];
const FORMULA_POOL = ['C6H6', 'C9H8O4', 'C2H6O', 'C2H6', 'C6H6O', 'C7H6O2', 'C4H10O'];

function makeRow(i) {
  const n = i + 1;
  const code = String(n).padStart(8, '0');
  return {
    id: n,
    ASINEX_ID: `ASN ${code}`,
    BAS_CODE: `BAS ${code}`,
    SMILES_STRING: SMILES_POOL[i % SMILES_POOL.length],
    BRUTTO_FORMULA: FORMULA_POOL[i % FORMULA_POOL.length],
    MW_STRUCTURE: 60 + n,
    AVAILABLE_MG: 1000,
    PRICE_1MG: 10 + n,
    PRICE_5MG: 40 + n,
    PRICE_10MG: 70 + n,
    IUPAC_NAME: `sample molecule ${n}`,
    INCHI: `InChI=sample-${n}`,
    INCHIKEY: `SAMPLEKEY${n}`,
  };
}
const ROWS = Array.from({ length: 25 }, (_, i) => makeRow(i));

// One fixture server stands in for every staging upstream. Path routing keeps
// each env URL distinct: ASINEX_API_BASE = http://127.0.0.1:<port>,
// ASINEX_DOCKING_API_URL = .../dock, DIFFDOCK_API_URL = .../diffdock,
// SDF_CONVERTER_URL = .../convertSTR.
const hits = { dock: 0 };
let lastDockBody = null;

function rowMatchesCode(row, code) {
  const wanted = code.trim().replace(/^(ASN|BAS)\s+/i, '').toLowerCase();
  const candidates = [row.ASINEX_ID, row.BAS_CODE].map((c) =>
    String(c || '').replace(/^(ASN|BAS)\s+/i, '').toLowerCase()
  );
  return candidates.includes(wanted);
}

function dockSdf() {
  // Two blocks share a smiles (scores -5.0 and -6.3) plus one unique block, so
  // the minimal-SDF reduce must keep the best (-6.3) and dedupe the other.
  const block = (smiles, score) =>
    [
      'fixture block',
      'M  END',
      `>  <smiles>`,
      smiles,
      `>  <SCORE>`,
      Number(score).toFixed(1),
      '',
    ].join('\n');
  const blocks = [
    block('CC(=O)O', -5.0),
    block('CC(=O)O', -6.3),
    block('CCO', -4.1),
  ];
  return blocks.join('\n$$$$\n') + '\n$$$$\n';
}

const fixtureServer = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  const pathname = url.pathname;
  const send = (status, payload, contentType = 'application/json') => {
    res.writeHead(status, { 'Content-Type': contentType });
    res.end(typeof payload === 'string' ? payload : JSON.stringify(payload));
  };
  const readBody = (cb) => {
    let data = '';
    req.on('data', (chunk) => { data += chunk; });
    req.on('end', () => { try { cb(JSON.parse(data || '{}')); } catch { cb({}); } });
  };

  // ---- catalog: /api/all/{page}_{size} --------------------------------------
  if (pathname.startsWith('/api/all/')) {
    const m = /^\/api\/all\/(\d+)_(\d+)$/.exec(pathname);
    if (!m) return send(400, { error: 'bad page' });
    const page = Number(m[1]);
    const size = Number(m[2]);
    const start = page * size;
    return send(200, ROWS.slice(start, start + size));
  }
  // ---- catalog: /api/id/{id_number} -----------------------------------------
  const idMatch = /^\/api\/id\/(.+)$/.exec(pathname);
  if (idMatch && req.method === 'GET') {
    const row = ROWS.find((r) => rowMatchesCode(r, decodeURIComponent(idMatch[1])));
    if (!row) return send(404, { error: 'not found' });
    return send(200, row);
  }
  // ---- catalog: /api/exact/{smiles} ------------------------------------------
  const exactMatch = /^\/api\/exact\/(.+)$/.exec(pathname);
  if (exactMatch && req.method === 'GET') {
    const smiles = decodeURIComponent(exactMatch[1]).toLowerCase();
    const row = ROWS.find((r) => r.SMILES_STRING.toLowerCase() === smiles);
    if (!row) return send(404, { error: 'no exact match' });
    return send(200, row);
  }
  // ---- catalog: /api4/{method} (search really operates on the collection) ----
  const api4 = /^\/api4\/([a-z]+)$/.exec(pathname);
  if (api4 && req.method === 'POST') {
    return readBody((body) => {
      const method = api4[1];
      if (method === 'bas') {
        const codes = String(body.bas || '').split(',').map((s) => s.trim()).filter(Boolean);
        const rows = codes.flatMap((code) => ROWS.filter((r) => rowMatchesCode(r, code)));
        return send(200, rows);
      }
      if (method === 'substructure' || method === 'structure') {
        const query = String(body.smiles || '').trim().toLowerCase();
        if (!query) return send(200, []);
        const rows = ROWS.filter((r) => r.SMILES_STRING.toLowerCase().includes(query));
        return send(200, rows);
      }
      if (method === 'similarity') {
        const query = String(body.smiles || '').trim().toLowerCase();
        // Self/exact hits only — matches the documented near-empty behaviour of
        // the catalog similarity endpoint. Never returns scores for strangers.
        const rows = ROWS.filter((r) => r.SMILES_STRING.toLowerCase() === query)
          .map((r) => ({ ...r, SIMILARITY: 1.0 }));
        return send(200, rows);
      }
      if (method === 'mw') {
        const from = Number(body.mwFrom ?? 0);
        const to = Number(body.mwTo ?? 1000);
        return send(200, ROWS.filter((r) => r.MW_STRUCTURE >= from && r.MW_STRUCTURE <= to));
      }
      return send(400, { error: `unknown fixture method ${method}` });
    });
  }
  // ---- docking provider ------------------------------------------------------
  if (pathname === '/dock' && req.method === 'POST') {
    return readBody((body) => {
      hits.dock += 1;
      lastDockBody = body;
      return send(200, {
        status: 'completed',
        energy: -8.5,
        pdb: [
          'HEADER    FIXTURE                          ',
          'ATOM      1  N   ALA A   1       1.000   1.000   1.000  1.00 20.00           N',
          'END',
          '',
        ].join('\n'),
        sdf: dockSdf(),
      });
    });
  }
  if (pathname === '/convertSTR' && req.method === 'POST') {
    return readBody((body) =>
      send(200, {
        sdf: ['fixture block', 'M  END', '>  <smiles>', body.smiles || '', '>  <SCORE>', '-3.2', '', '$$$$'].join('\n'),
      })
    );
  }
  if (pathname === '/diffdock' && req.method === 'POST') {
    return readBody(() => send(200, { status: 'completed', ligand_positions: [], position_confidence: [] }));
  }
  return send(404, { error: `fixture 404 ${req.method} ${pathname}` });
});

async function main() {
  console.log(`[staging-simulation] runtime: ${serverRuntime}`);
  await new Promise((resolve) => fixtureServer.listen(0, '127.0.0.1', resolve));
  const fixturePort = fixtureServer.address().port;
  const fixtureBase = `http://127.0.0.1:${fixturePort}`;

  const childEnv = {
    ...process.env,
    PYXIS_DEMO_MODE: 'true',
    JWT_SECRET: DEMO_SECRET,
    PORT: String(PORT),
    BIND_HOST: '127.0.0.1',
    NODE_ENV: 'test',
    FRONTEND_DIST: '',
    MONGODB_URI: '',
    STRIPE_SECRET_KEY: '',
    ASINEX_API_BASE: fixtureBase,
    ASINEX_DOCKING_API_URL: `${fixtureBase}/dock`,
    DIFFDOCK_API_URL: `${fixtureBase}/diffdock`,
    SDF_CONVERTER_URL: `${fixtureBase}/convertSTR`,
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
    fixtureServer.close();
  };

  try {
    const healthy = await waitForHealth();
    if (!healthy) {
      console.error('[staging-simulation] Server did not become healthy. Output:\n' + serverLog);
      throw new Error('server-not-healthy');
    }
    console.log('[staging-simulation] Demo server is up.\n');

    let r = await api('POST', '/api/demo-session');
    const demoToken = r.json?.token;
    check('demo sign-in works', typeof demoToken === 'string');
    const peerToken = DEMO_JWT(DEMO_SECRET, { userId: 'u2', username: 'pyxis-staging-tester-2', companyId: null });
    const otherCompanyToken = DEMO_JWT(DEMO_SECRET, { userId: 'u3', username: 'elsewhere-user', companyId: 'otherComp' });

    // --- 1. Catalog browse + pagination ---------------------------------------
    console.log('Test 1 — catalog browse (live-read-only mirror):');
    r = await api('GET', '/api/asinex/all/0_10', { token: demoToken });
    check('page 0 size 10 -> 10 rows', r.status === 200 && Array.isArray(r.json) && r.json.length === 10, `got ${r.status}`);
    check('browse rows carry catalog fields', r.json?.[0]?.ASINEX_ID && r.json?.[0]?.SMILES_STRING && r.json?.[0]?.PRICE_1MG != null, JSON.stringify(r.json?.[0]));
    r = await api('GET', '/api/asinex/all/1_10', { token: demoToken });
    check('page 1 continues after page 0', r.json?.[0]?.id === 11 && r.json.length === 10, JSON.stringify(r.json?.[0]));
    r = await api('GET', '/api/asinex/all/2_10', { token: demoToken });
    check('last page returns remaining 5', r.json?.length === 5);
    r = await api('GET', '/api/asinex/all/0_10');
    check('browse without token -> 401', r.status === 401, `got ${r.status}`);

    r = await api('GET', `/api/asinex/id/${encodeURIComponent('ASN 00000003')}`, { token: demoToken });
    check('single-compound lookup by id', r.status === 200 && r.json?.source === 'asinex' && r.json?.data?.id === 3, `got ${r.status}`);
    r = await api('GET', `/api/asinex/exact/${encodeURIComponent('CCO')}`, { token: demoToken });
    check('exact lookup wrapper shape (Control Panel price)', r.status === 200 && r.json?.searchType === 'exact' && r.json?.data?.SMILES_STRING === 'CCO', `got ${r.status}`);

    // --- 2. Search genuinely operates on the collection -----------------------
    console.log('\nTest 2 — BAS / substructure / similarity / MW search:');
    r = await api('POST', '/api/api4/bas', { token: demoToken, body: { fromId: 0, pageSize: 10, bas: 'ASN 00000001,ASN 00000003' } });
    check('BAS lookup returns exactly the requested codes', r.status === 200 && r.json?.length === 2 && [1, 3].every((id) => r.json.some((row) => row.id === id)), `got ${r.status} ${r.text.slice(0, 160)}`);
    r = await api('POST', '/api/api4/bas', { token: demoToken, body: { bas: 'ASN 99999999' } });
    check('unknown BAS code -> empty, not canned', r.status === 200 && Array.isArray(r.json) && r.json.length === 0);

    r = await api('POST', '/api/api4/substructure', { token: demoToken, body: { fromId: 0, pageSize: 10, smiles: 'c1ccccc1' } });
    const benzeneRows = ROWS.filter((row) => row.SMILES_STRING.includes('c1ccccc1'));
    check('substructure returns only genuine matches', r.status === 200 && r.json?.length === benzeneRows.length && r.json?.every((row) => row.SMILES_STRING.includes('c1ccccc1')), `got ${r.text.slice(0, 160)}`);
    r = await api('POST', '/api/api4/substructure', { token: demoToken, body: { smiles: 'zzzzz-not-a-structure' } });
    check('substructure with no matches -> empty, not canned', r.status === 200 && Array.isArray(r.json) && r.json.length === 0);

    r = await api('POST', '/api/api4/similarity', { token: demoToken, body: { fromId: 0, pageSize: 10, smiles: 'c1ccccc1', threshold: 0.7 } });
    check('similarity self-hit carries the upstream score (not invented)', r.status === 200 && r.json?.length >= 1 && r.json?.[0]?.SMILES_STRING === 'c1ccccc1' && r.json?.[0]?.SIMILARITY === 1.0, `got ${r.text.slice(0, 160)}`);
    r = await api('POST', '/api/api4/similarity', { token: demoToken, body: { smiles: 'C#C#C#C#C-not-real', threshold: 0.7 } });
    check('similarity arbitrary query -> empty (never fake hits/scores)', r.status === 200 && Array.isArray(r.json) && r.json.length === 0, `got ${r.text.slice(0, 160)}`);

    r = await api('POST', '/api/api4/mw', { token: demoToken, body: { smiles: '', mwFrom: 61, mwTo: 63 } });
    check('molecular-weight range filters on MW', r.status === 200 && r.json?.every((row) => row.MW_STRUCTURE >= 61 && row.MW_STRUCTURE <= 63) && r.json?.length > 0, `got ${r.text.slice(0, 160)}`);

    r = await api('POST', '/api/api4/bogus', { token: demoToken, body: {} });
    check('unsupported /api4 method rejected (400, no passthrough)', r.status === 400, `got ${r.status}`);

    // --- 3. Stock search honest-unavailable + neighbours refused ---------------
    console.log('\nTest 3 — stock search honesty + refusals:');
    r = await api('GET', '/api/stock-search/status', { token: demoToken });
    check('stock status -> 503 STOCK_SEARCH_UNAVAILABLE', r.status === 503 && r.json?.code === 'STOCK_SEARCH_UNAVAILABLE', `got ${r.status} ${r.text.slice(0, 120)}`);
    r = await api('GET', '/api/stock-search/similarity?smiles=c1ccccc1', { token: demoToken });
    check('stock similarity -> 503 STOCK_SEARCH_UNAVAILABLE', r.status === 503 && r.json?.code === 'STOCK_SEARCH_UNAVAILABLE', `got ${r.status}`);
    r = await api('GET', '/api/simulation/whatever/admet', { token: demoToken });
    check('ADMET sub-route refused with explanation', r.status === 403 && r.json?.code === 'DEMO_MODE_DISABLED', `got ${r.status} ${r.text.slice(0, 120)}`);
    r = await api('POST', '/api/diffdock/generate_file', { token: demoToken, body: {} });
    check('diffdock/generate_file refused', r.status === 403 && r.json?.code === 'DEMO_MODE_DISABLED', `got ${r.status}`);
    r = await api('POST', '/create-checkout-session', { token: demoToken, body: { plan: 'Standard' } });
    check('checkout refused', r.status === 403 && r.json?.code === 'DEMO_MODE_DISABLED', `got ${r.status}`);

    // --- 4. Real docking run -> store -> artifacts -> cache hit ---------------
    console.log('\nTest 4 — docking run, artifacts and cache hit:');
    const rawSmiles = 'CC(=O)Oc1ccccc1C(=O)O';
    const encodedSmiles = encodeURIComponent(rawSmiles); // the Simulation page sends encoded SMILES
    r = await api('POST', '/api/simulation', { token: demoToken, body: { pdbid: '1cx7', smiles: encodedSmiles } });
    check('docking POST 200 with simulationKey', r.status === 200 && typeof r.json?.simulationKey === 'string' && r.json?.simulationKey.length === 12, `got ${r.status} ${r.text.slice(0, 160)}`);
    const simulationKey = r.json?.simulationKey;
    check('provider payload includes stored result fields', r.json?.status === 'completed' && typeof r.json?.pdb === 'string' && typeof r.json?.sdf === 'string', `got ${r.status}`);
    check('docking provider received the request body', hits.dock === 1 && lastDockBody?.pdbID === '1cx7' && typeof lastDockBody?.smiles === 'string', JSON.stringify(lastDockBody));

    // Artifact endpoints mirror production shapes.
    r = await api('GET', `/api/sanitizedpdb/${simulationKey}`, { token: demoToken });
    check('sanitized pdb download', r.status === 200 && String(r.headers.get('content-type') || '').startsWith('chemical/x-pdb') && r.text.includes('ATOM') && r.headers.get('content-disposition')?.includes('.pdb'), `got ${r.status} ct=${r.headers.get('content-type')} cd=${r.headers.get('content-disposition')}`);
    r = await api('GET', `/api/sanitizedsdf/${simulationKey}`, { token: demoToken });
    check('sanitized full sdf download', r.status === 200 && String(r.headers.get('content-type') || '').startsWith('chemical/x-sdf') && r.text.includes('-5.0') && r.text.includes('-6.3'), `got ${r.status} ct=${r.headers.get('content-type')} has50=${r.text.includes('-5.0')} has63=${r.text.includes('-6.3')} len=${r.text.length} head=${r.text.slice(0, 120).replace(/\n/g, '|')}`);
    r = await api('GET', `/api/sanitizedminimalsdf/${simulationKey}`, { token: demoToken });
    const minimal = r.text;
    const smilesTagCount = (minimal.match(/>  <smiles>/g) || []).length;
    check('minimal sdf dedupes to unique smiles', r.status === 200 && smilesTagCount === 2, `tags=${smilesTagCount} ${minimal.slice(0, 200)}`);
    check('minimal sdf keeps the best score (-6.3 not -5.0)', minimal.includes('-6.3') && !minimal.includes('-5.0'), minimal.slice(0, 200));
    r = await api('GET', `/api/sanitizedspecificsdf/${simulationKey}/${encodeURIComponent('CCO')}`, { token: demoToken });
    check('specific-smiles sdf block returned', r.status === 200 && r.text.includes('CCO') && r.text.includes('-4.1'), `got ${r.status} ${r.text.slice(0, 120)}`);
    r = await api('GET', `/api/sanitizedspecificsdf/${simulationKey}/${encodeURIComponent('nope')}`, { token: demoToken });
    check('unknown smiles in sdf -> 404', r.status === 404, `got ${r.status}`);

    // History: exactly the run we made, without coordinate blobs in the list.
    r = await api('GET', '/api/simulation-logs', { token: demoToken });
    check('simulation-logs lists 1 run', r.status === 200 && r.json?.length === 1 && r.json?.[0]?.simulationKey === simulationKey, `got ${r.status} ${r.text.slice(0, 160)}`);
    check('list row has ownership + no giant result blob', r.json?.[0]?.username === 'pyxis-staging-tester' && !('result' in r.json[0]), JSON.stringify(Object.keys(r.json?.[0] || {})));

    // Cache hit: identical run must not call the provider a second time.
    const dockHitsAfterFirst = hits.dock;
    r = await api('POST', '/api/simulation', { token: demoToken, body: { pdbid: '1cx7', smiles: encodedSmiles } });
    check('identical run returns cached simulationKey', r.status === 200 && r.json?.simulationKey === simulationKey, `got ${r.status}`);
    check('cache hit made no second provider call', hits.dock === dockHitsAfterFirst, `dock calls=${hits.dock}`);
    r = await api('GET', '/api/simulation-logs', { token: demoToken });
    check('cache hit did not duplicate the log row', r.json?.length === 1, `len=${r.json?.length}`);

    // --- 5. Privacy -----------------------------------------------------------
    console.log('\nTest 5 — simulation history privacy:');
    r = await api('GET', '/api/simulation-logs', { token: peerToken });
    check('different company-less user lists nothing', r.status === 200 && Array.isArray(r.json) && r.json.length === 0);
    r = await api('GET', `/api/sanitizedpdb/${simulationKey}`, { token: peerToken });
    check('peer cannot download owner artifacts -> 404', r.status === 404, `got ${r.status}`);
    r = await api('GET', `/api/sanitizedminimalsdf/${simulationKey}`, { token: otherCompanyToken });
    check('other-company user cannot read blobs -> 404', r.status === 404, `got ${r.status}`);
    r = await api('GET', '/api/simulation-logs', { token: otherCompanyToken });
    check('other-company user lists nothing', r.status === 200 && r.json?.length === 0);

    console.log(`\n[staging-simulation] ${passed} passed, ${failed} failed`);
    if (failed > 0) {
      console.error('[staging-simulation] Server output:\n' + serverLog.slice(-4000));
    }
    await cleanup();
    process.exit(failed > 0 ? 1 : 0);
  } catch (err) {
    console.error('[staging-simulation] Fatal:', err.message);
    await cleanup();
    process.exit(1);
  }
}

main();
