// Staging Simulation contract: supplier catalog routes refuse locally with
// zero fixture supplier hits. Configured Pyxis macrocycle searches and owned
// scientific providers keep working; missing sources never fall back.
//
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
const hits = { catalog: 0, dock: 0, api4bas: 0, macro: [] };
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
  if (/^\/(?:api\/(?:all|id|exact)|api4)\//.test(pathname)) hits.catalog += 1;
  const send = (status, payload, contentType = 'application/json') => {
    res.writeHead(status, { 'Content-Type': contentType });
    res.end(typeof payload === 'string' ? payload : JSON.stringify(payload));
  };
  const readBody = (cb) => {
    let data = '';
    req.on('data', (chunk) => { data += chunk; });
    req.on('end', () => { try { cb(JSON.parse(data || '{}')); } catch { cb({}); } });
  };

  if (pathname === '/v1/datasets' && req.method === 'GET') {
    // The real corpus stands in for a format-2 (count-capable) index; virtual
    // stands in for a format-1 index that must still answer binary Tanimoto
    // only.
    return send(200, { datasets: [
      { id: 4, name: 'Stock compounds — 2026-09-01', row_count: 630646 },
      { id: 18, name: 'Macrocycles real stock — 2026-09-23', row_count: 18190, metrics: ['tanimoto', 'count_tanimoto', 'count_dice'] },
      { id: 19, name: 'Macrocycles virtual — 2026-09-23', row_count: 2350440 },
    ] });
  }
  if (pathname === '/v1/search/similarity' && req.method === 'GET') {
    const datasetId = Number(url.searchParams.get('dataset_id'));
    const datasetIds = url.searchParams.get('dataset_ids');
    hits.macro.push({
      datasetId, datasetIds,
      smiles: url.searchParams.get('smiles'),
      metric: url.searchParams.get('similarity_metric'),
    });
    if (datasetIds === '18,19') return send(200, {
      found: true, count: 2, query_smiles: url.searchParams.get('smiles'),
      results: [
        { molecule_id: 181, source: 'real', canonical_smiles: 'C1CCCCC1', similarity: 0.9, metadata: { ID: 'RPX 181', MAIN_BAS: 'RPX 181', PRICE_1MG: 123 } },
        { molecule_id: 181, source: 'virtual', canonical_smiles: 'C1CCCCC1', similarity: 0.8, metadata: { ID: 'VPX 181', MAIN_BAS: 'VPX 181', PRICE_1MG: 456 } },
      ],
    });
    if (![18, 19].includes(datasetId)) return send(400, { error: 'wrong dataset' });
    if (url.searchParams.get('smiles') === 'AUTHFAIL') return send(401, { detail: 'upstream key rejected' });
    const isReal = datasetId === 18;
    return send(200, {
      found: true, count: 1, query_smiles: url.searchParams.get('smiles'),
      results: [{
        molecule_id: isReal ? 181 : 191,
        canonical_smiles: 'C1CCCCC1', similarity: 0.83,
        metadata: { ID: isReal ? 'REAL-181' : 'VIRTUAL-191', PRICE_1MG: 123 },
      }],
    });
  }

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
        hits.api4bas += 1;
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
    MACROCYCLE_SEARCH_BASE: fixtureBase,
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

    // Every retired catalog path is a local refusal, including unregistered aliases.
    for (const [method, route] of [
      ['GET', '/api/asinex/all/0_10'], ['GET', '/api/asinex/id/ASN1'],
      ['GET', '/api/asinex/exact/CCO'], ['GET', '/api/asinex/health'],
      ['POST', '/api/asinex/search'], ['GET', '/api/all/0_10'],
      ['GET', '/api/id/ASN1'], ['GET', '/api/exact/CCO'],
      ...['bas', 'structure', 'substructure', 'similarity', 'mw', 'bogus'].map((name) => ['POST', `/api/api4/${name}`]),
      ['POST', '/api/shop'],
    ]) {
      r = await api(method, route, { token: demoToken, body: method === 'POST' ? {} : undefined });
      check(`${route} -> local CATALOG_RETIRED`, r.status === 503 && r.json?.code === 'CATALOG_RETIRED');
    }
    r = await api('GET', '/api/asinex/all/0_10');
    check('retired catalog retains session auth', r.status === 401);
    check('no catalog request reaches fixture supplier', hits.catalog === 0 && hits.api4bas === 0, JSON.stringify(hits));

    // --- 3. Stock search honest-unavailable + neighbours refused ---------------
    console.log('\nTest 3 — stock search honesty + refusals:');
    r = await api('GET', '/api/stock-search/status', { token: demoToken });
    check('stock status -> 503 STOCK_SEARCH_UNAVAILABLE', r.status === 503 && r.json?.code === 'STOCK_SEARCH_UNAVAILABLE', `got ${r.status} ${r.text.slice(0, 120)}`);
    r = await api('GET', '/api/stock-search/similarity?smiles=c1ccccc1', { token: demoToken });
    check('stock similarity -> 503 STOCK_SEARCH_UNAVAILABLE', r.status === 503 && r.json?.code === 'STOCK_SEARCH_UNAVAILABLE', `got ${r.status}`);
    r = await api('GET', '/api/macrocycles/status?source=real', { token: demoToken });
    check('real macrocycle status resolves only its named dataset', r.status === 200 && r.json?.available === true && r.json?.dataset?.id === 18 && r.json?.dataset?.rowCount === 18190, `got ${r.status} ${r.text.slice(0, 150)}`);
    check('count-capable dataset advertises the count metrics', r.status === 200
      && r.json?.capabilities?.similarityMetrics?.map((m) => m.value).join(',') === 'tanimoto,count_tanimoto,count_dice'
      && r.json.capabilities.similarityMetrics.every((m) => /binary|frequency-weighted/.test(m.label))
      && r.json.countMetricsAvailable === true,
      `got ${r.status} ${JSON.stringify(r.json?.capabilities?.similarityMetrics)}`);
    r = await api('GET', '/api/macrocycles/status?source=virtual', { token: demoToken });
    check('virtual macrocycle status resolves only its named dataset', r.status === 200 && r.json?.available === true && r.json?.dataset?.id === 19 && r.json?.dataset?.rowCount === 2350440, `got ${r.status} ${r.text.slice(0, 150)}`);
    check('binary-only dataset advertises Tanimoto alone', r.status === 200
      && r.json?.capabilities?.similarityMetrics?.length === 1
      && r.json.capabilities.similarityMetrics[0].value === 'tanimoto'
      && r.json.countMetricsAvailable === false, `got ${r.status} ${JSON.stringify(r.json?.capabilities)}`);
    r = await api('GET', '/api/macrocycles/status?source=both', { token: demoToken });
    check('combined macrocycle status counts both datasets and advertises only common metrics',
      r.status === 200 && r.json?.available === true && r.json?.dataset?.rowCount === 2368630
      && r.json?.capabilities?.similarityMetrics?.map((m) => m.value).join(',') === 'tanimoto',
      `got ${r.status} ${r.text.slice(0, 230)}`);
    r = await api('GET', '/api/macrocycles/similarity?source=both&smiles=C1CCCCC1&threshold=0.5', { token: demoToken });
    check('combined search keeps both source rows and strips untrusted price fields',
      r.status === 200 && hits.macro.at(-1)?.datasetIds === '18,19'
      && r.json?.results?.map((hit) => hit.source).join(',') === 'real,virtual'
      && r.json?.results?.[0]?.metadata?.source === 'macrocycle_real'
      && r.json?.results?.[1]?.metadata?.source === 'macrocycle_virtual'
      && r.json.results.every((hit) => !('PRICE_1MG' in hit.metadata)),
      `got ${r.status} ${r.text.slice(0, 260)}`);
    r = await api('GET', '/api/macrocycles/similarity?source=real&smiles=C1CCCCC1&threshold=0.5', { token: demoToken });
    check('real macrocycle search uses its dataset and no cart price', r.status === 200 && hits.macro.at(-1)?.datasetId === 18 && r.json?.results?.[0]?.metadata?.source === 'macrocycle_real' && !('price_1mg' in (r.json?.results?.[0]?.metadata || {})) && !('PRICE_1MG' in (r.json?.results?.[0]?.metadata || {})), `got ${r.status} ${r.text.slice(0, 230)}`);
    r = await api('GET', '/api/macrocycles/similarity?source=virtual&smiles=C1CCCCC1&threshold=0.5', { token: demoToken });
    check('virtual macrocycle search uses its separate dataset', r.status === 200 && hits.macro.at(-1)?.datasetId === 19 && r.json?.results?.[0]?.metadata?.source === 'macrocycle_virtual', `got ${r.status} ${r.text.slice(0, 230)}`);
    r = await api('GET', '/api/macrocycles/similarity?source=real&smiles=C1CCCCC1&threshold=0.5&similarity_metric=count_tanimoto', { token: demoToken });
    check('count metric is forwarded to the count-capable dataset', r.status === 200
      && hits.macro.at(-1)?.metric === 'count_tanimoto' && r.json?.method?.similarity_metric === 'count_tanimoto'
      && r.json?.results?.[0]?.metadata?.source === 'macrocycle_real', `got ${r.status} ${r.text.slice(0, 200)}`);
    const macroHitsBeforeRejections = hits.macro.length;
    r = await api('GET', '/api/macrocycles/similarity?source=both&smiles=C1CCCCC1&similarity_metric=count_tanimoto', { token: demoToken });
    check('combined view refuses a metric missing from either dataset before upstream',
      r.status === 400 && hits.macro.length === macroHitsBeforeRejections,
      `got ${r.status} ${r.text.slice(0, 200)}`);
    r = await api('GET', '/api/macrocycles/similarity?source=virtual&smiles=C1CCCCC1&similarity_metric=count_tanimoto', { token: demoToken });
    check('count metric is refused before upstream when the index has no count stream',
      r.status === 400 && /count fingerprints/.test(r.json?.error || '') && hits.macro.length === macroHitsBeforeRejections,
      `got ${r.status} ${r.text.slice(0, 200)}`);
    r = await api('GET', '/api/macrocycles/similarity?source=real&smiles=C1CCCCC1&similarity_metric=ctanimoto', { token: demoToken });
    check('an MOE metric name is never accepted as a Pyxis metric', r.status === 400 && hits.macro.length === macroHitsBeforeRejections, `got ${r.status}`);
    r = await api('GET', '/api/macrocycles/similarity?source=stock&smiles=C1CCCCC1', { token: demoToken });
    check('unknown macrocycle source cannot select stock dataset', r.status === 400 && hits.macro.length === macroHitsBeforeRejections, `got ${r.status}`);
    r = await api('GET', '/api/macrocycles/similarity?source=real&smiles=AUTHFAIL', { token: demoToken });
    check('upstream auth failure is 502, never a demo-session 401', r.status === 502, `got ${r.status}`);
    r = await api('GET', '/api/macrocycles/status?source=real');
    check('macrocycle status requires staging session', r.status === 401, `got ${r.status}`);
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
