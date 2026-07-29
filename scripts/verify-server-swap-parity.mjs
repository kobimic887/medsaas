#!/usr/bin/env node
/**
 * Runbook 5.0 step 5 — response-shape parity, route by route, while BOTH servers are live.
 *
 * This is the Release A gate that cannot be run after the fact: once port 5173 changes hands
 * there is only one server left to ask. Run it on 83, from a rehearsal rig, before cutting over.
 *
 *   Left  : chem_beo,          https://127.0.0.1:3000  (self-signed cert — verification off)
 *   Right : this repo's server, http://127.0.0.1:5199  (the rig)
 *
 * Same Atlas on both sides, so a difference is the server and nothing else.
 *
 * READ-ONLY BY CONSTRUCTION. Nothing here spends a credit, writes a document, or sends mail.
 * /api/simulation is exercised only as a CACHE HIT on a record that already exists — free by
 * definition, and if it ever missed it would dock and charge, so the script asserts the stored
 * simulationKey came back unchanged rather than assuming it.
 *
 * It compares STRUCTURE, never values: `shape()` reduces a body to its keys and their types.
 * Two servers reading the same database legitimately return different bytes; they must not
 * return different shapes.
 *
 * SETUP
 * -----
 * Stand the rig up first — a checkout plus a `client/dist` built on a dev machine, its own
 * `.env` on an unused high port, pointed at real Atlas. Then:
 *
 *   node scripts/verify-server-swap-parity.mjs [username]
 *
 * `node`, not `bun`: this pulls in the `mongodb` driver, whose bson calls
 * `node:v8 isBuildingSnapshot`, unimplemented in Bun 1.3.12.
 *
 * It reads the rig's JWT_SECRET from /root/pyxis-release-a/.env and mints its own tokens for
 * both sides, so no password and no account creation is needed. chem_beo's side uses the
 * secret it actually runs with — see LEGACY_SECRET below, and docs/NEXT-SESSION.md §0.
 *
 * Last run 2026-07-29: 17 routes, 4 differences, all explained in docs/NEXT-SESSION.md §1.
 */
import fs from 'node:fs';
import jwt from 'jsonwebtoken';
import { MongoClient } from 'mongodb';

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'; // chem_beo terminates TLS with a cert for another name

const RIG_ENV = Object.fromEntries(
  fs.readFileSync('/root/pyxis-release-a/.env', 'utf8')
    .split('\n').filter((l) => l && !l.startsWith('#') && l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)])
);

const LEGACY = 'https://127.0.0.1:3000';
const RIG = 'http://127.0.0.1:5199';

// chem_beo:1049 is `jwt.sign({username}, process.env.JWT_SECRET || 'secret', {expiresIn:'1d'})`
// and its .env sets no JWT_SECRET — so production tokens are signed with the literal string
// "secret". That is the vulnerability in docs/NEXT-SESSION.md §0, not a convenience for this
// script. If it is ever fixed, pass the real one in LEGACY_JWT_SECRET and this keeps working.
const LEGACY_SECRET = process.env.LEGACY_JWT_SECRET || 'secret';
const RIG_SECRET = RIG_ENV.JWT_SECRET;

const USER = process.argv[2] || 'tester123';

const legacyToken = jwt.sign({ username: USER }, LEGACY_SECRET, { expiresIn: '1h' });
const rigToken = jwt.sign({ username: USER }, RIG_SECRET, { expiresIn: '1h' });

/** Structural fingerprint: keys and types, never values. Values differ legitimately. */
function shape(v, depth = 0) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return depth > 3 ? 'array' : `[${v.length ? shape(v[0], depth + 1) : ''}]`;
  if (typeof v === 'object') {
    if (depth > 3) return 'object';
    return `{${Object.keys(v).sort().map((k) => `${k}:${shape(v[k], depth + 1)}`).join(',')}}`;
  }
  return typeof v;
}

async function call(base, path, token, init = {}) {
  const headers = { ...(init.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (init.body) headers['Content-Type'] = 'application/json';
  try {
    const r = await fetch(base + path, { ...init, headers, signal: AbortSignal.timeout(90_000) });
    const text = await r.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    return {
      status: r.status,
      ctype: (r.headers.get('content-type') || '').split(';')[0],
      shape: json === null ? `<non-json ${text.length}b>` : shape(json),
      json,
      text,
    };
  } catch (e) {
    return { status: 'ERR', ctype: '', shape: `ERROR ${e.message}`, json: null, text: '' };
  }
}

const rows = [];
async function compare(name, legacyPath, rigPath, opts = {}) {
  const { init = {}, auth = true, only } = opts;
  const l = only === 'rig' ? null : await call(LEGACY, legacyPath, auth ? legacyToken : null, init);
  const r = only === 'legacy' ? null : await call(RIG, rigPath, auth ? rigToken : null, init);
  rows.push({ name, legacyPath, rigPath, l, r });
  const statusMatch = !l || !r ? '—' : l.status === r.status ? 'ok' : 'DIFF';
  const shapeMatch = !l || !r ? '—' : l.shape === r.shape ? 'ok' : 'DIFF';
  console.log(`\n### ${name}`);
  console.log(`  legacy ${legacyPath}`);
  console.log(`     -> ${l ? `${l.status} ${l.ctype}` : '(skipped)'}`);
  console.log(`     -> ${l ? l.shape.slice(0, 400) : ''}`);
  console.log(`  rig    ${rigPath}`);
  console.log(`     -> ${r ? `${r.status} ${r.ctype}` : '(skipped)'}`);
  console.log(`     -> ${r ? r.shape.slice(0, 400) : ''}`);
  console.log(`  status:${statusMatch}  shape:${shapeMatch}`);
  return { l, r };
}

// A real record to exercise the cache path against.
const mc = new MongoClient(RIG_ENV.MONGODB_URI);
await mc.connect();
const log = await mc.db('test').collection('simulation_logs').findOne({ 'user.username': USER });
await mc.close();
if (!log) { console.error(`No simulation_logs for ${USER}`); process.exit(2); }
const { pdbid, smiles, simulationKey } = log;
console.log(`user=${USER}  cache probe: pdbid=${pdbid} smiles=${smiles} key=${simulationKey}`);

console.log('\n========== UNAUTHENTICATED ==========');
await compare('health', '/health', '/health', { auth: false });
await compare('signin, wrong password', '/api/signin', '/api/signin', {
  auth: false,
  init: { method: 'POST', body: JSON.stringify({ username: '__no_such_user__', password: 'x' }) },
});
await compare('authed route with NO token', '/api/simulation-logs', '/api/simulation-logs', { auth: false });
await compare('authed route, GARBAGE token', '/api/simulation-logs', '/api/simulation-logs', {
  auth: false, init: { headers: { Authorization: 'Bearer not.a.jwt' } },
});

console.log('\n========== AUTHENTICATED, READ-ONLY ==========');
await compare('simulation-logs', '/api/simulation-logs', '/api/simulation-logs');
await compare('activity', '/api/activity', '/api/activity');
await compare('mol-price-stats', '/api/mol-price-stats', '/api/mol-price-stats');
await compare('mol-price search', `/api/mol-price/search?smiles=${encodeURIComponent('CCO')}&limit=5`,
                                  `/api/mol-price/search?smiles=${encodeURIComponent('CCO')}&limit=5`);
await compare('simulation, missing params (400 shape)', '/api/simulation', '/api/simulation');
const cache = await compare('simulation CACHE HIT (must not charge)',
  `/api/simulation?pdbid=${pdbid}&smiles=${encodeURIComponent(smiles)}`,
  `/api/simulation?pdbid=${pdbid}&smiles=${encodeURIComponent(smiles)}`);
await compare('sanitizedminimalsdf', `/api/sanitizedminimalsdf/${simulationKey}`, `/api/sanitizedminimalsdf/${simulationKey}`);
await compare('sanitizedpdb', `/api/sanitizedpdb/${simulationKey}`, `/api/sanitizedpdb/${simulationKey}`);
await compare('sanitizedspecificsdf', `/api/sanitizedspecificsdf/${simulationKey}/${encodeURIComponent(smiles)}`,
                                      `/api/sanitizedspecificsdf/${simulationKey}/${encodeURIComponent(smiles)}`);

console.log('\n========== UPSTREAM PROXIES (Asinex Moscow / Tanimoto Oracle) ==========');
await compare('asinex catalog page', '/api/asinex/all/0_5', '/api/asinex/all/0_5');
await compare('asinex exact', `/api/asinex/exact/${encodeURIComponent('CCO')}`, `/api/asinex/exact/${encodeURIComponent('CCO')}`);
// chem_beo mounts tanimoto under /api; this repo mounts it at the top level. Both are checked
// on their own path — a 404 on the other server's path is the finding, not a bug in this script.
await compare('tanimoto exact', `/api/tanimoto/v1/search/exact?smiles=${encodeURIComponent('CCO')}`,
                                `/tanimoto/v1/search/exact?smiles=${encodeURIComponent('CCO')}`);
await compare('tanimoto exact ON THE OTHER PATH', `/tanimoto/v1/search/exact?smiles=${encodeURIComponent('CCO')}`,
                                                  `/api/tanimoto/v1/search/exact?smiles=${encodeURIComponent('CCO')}`);

console.log('\n\n========== SUMMARY ==========');
let diffs = 0;
for (const { name, l, r } of rows) {
  if (!l || !r) continue;
  const s = l.status === r.status;
  const h = l.shape === r.shape;
  if (!s || !h) { diffs++; console.log(`DIFF  ${name}: status ${l.status}/${r.status}  shape ${s ? 'same' : 'differs'}${h ? '' : ''}`); }
}
console.log(`\n${rows.length} routes compared, ${diffs} with a status or shape difference.`);

if (cache.l?.json && cache.r?.json) {
  const lk = cache.l.json.simulationKey, rk = cache.r.json.simulationKey;
  console.log(`\nCACHE CHECK: legacy key ${lk} / rig key ${rk} / stored ${simulationKey}`);
  console.log(lk === simulationKey && rk === simulationKey
    ? 'Both served the STORED record. No dock ran, no credit spent.'
    : 'WARNING: at least one side did NOT serve the stored record — it may have re-docked and charged.');
}
