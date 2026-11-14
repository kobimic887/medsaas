// Exercise the actual registered route and credit functions against HTTP fixtures.
// No Atlas, provider traffic or application boot. Inference qualification is separate.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import { once } from 'node:events';
import express from 'express';
import { configuredDiffDockPoseCount, completedDiffDockResult, resolveDiffDockUrl, resolveDockingUrl, persistedLigandServiceConfig, completedDockingResult } from '../utils/diffdockResult.js';

const legacy = 'https://services.asinex.com:58000/molecular-docking/diffdock/generate';
assert.equal(resolveDiffDockUrl(legacy, 'http://127.0.0.1:18002/generate'), 'http://127.0.0.1:18002/generate');
assert.equal(resolveDiffDockUrl(legacy, undefined), legacy);
assert.equal(resolveDiffDockUrl('http://169.254.169.254/generate', 'http://127.0.0.1:18002/generate'), 'http://169.254.169.254/generate');
assert.equal(resolveDiffDockUrl('https://independent.example/generate', 'http://127.0.0.1:18002/generate'), 'https://independent.example/generate');

const source = readFileSync(new URL('../index.js', import.meta.url), 'utf8');
assert.equal(resolveDockingUrl('https://services.asinex.com:8000/docking', 'http://127.0.0.1:18000/docking'), 'http://127.0.0.1:18000/docking');
assert.equal(resolveDockingUrl('http://169.254.169.254', 'http://127.0.0.1:18000/docking'), 'http://169.254.169.254');
assert.deepEqual(persistedLigandServiceConfig({ dockingApiUrl: 'http://127.0.0.1:18000/docking', diffdockApiUrl: 'https://custom.example/diffdock' }, { dockingApiUrl: 'http://127.0.0.1:18000/docking' }), { diffdockApiUrl: 'https://custom.example/diffdock' });
assert.throws(() => completedDockingResult({ error: 'upstream broken' }), /no receptor/);
assert.throws(() => completedDockingResult({ pdb: ' ', sdf: ' ' }), /no receptor/);
assert.deepEqual(completedDockingResult({ pdb: 'ATOM', sdf: 'pose' }), { pdb: 'ATOM', sdf: 'pose' });
// Execute the real backfill boundary; runtime defaults must never be written to Atlas.
let savedCompanyPatch;
const company = { _id: 'company', companyId: 'company', usagePolicy: {}, monthlyUsage: { monthKey: 'current' } };
const companySource = source.slice(source.indexOf('async function getCompanyRecord('), source.indexOf('async function incrementCompanyMonthlyUsage('));
const loadCompany = new Function('companiesCollection', 'toObjectIdSafe', 'normalizeUsagePolicy', 'normalizeMonthlyUsage', 'normalizeLigandServiceConfig', 'normalizeBrandPalette', companySource + '; return getCompanyRecord;')({
  async findOne() { return company; }, async updateOne(_query, update) { savedCompanyPatch = update.$set; },
}, () => null, x => x, x => x, x => ({ dockingApiUrl: 'http://127.0.0.1:18000/docking', ...x }), x => x);
const loaded = await loadCompany('company');
assert.deepEqual(savedCompanyPatch.ligandServiceConfig, {});
assert.equal(loaded.ligandServiceConfig.dockingApiUrl, 'http://127.0.0.1:18000/docking');

const creditSource = source.slice(source.indexOf('async function chargeSimulationToken('), source.indexOf('\nfunction secretsEqual('));
const start = source.indexOf('// Supplier catalog retirement does not disable the owner-authorized scientific providers.');
const routeSource = source.slice(start, source.indexOf('\n/**\n * @swagger\n * /api/diffdock/generate_file:', start));
assert.ok(routeSource.includes("app.post('/api/diffdock/generate'"));
const pose = JSON.parse(readFileSync(new URL('../../deploy/box/diffdock/reference/response-success-1pose.json', import.meta.url))).response;
let balance = 10;
let refunds = 0;
const credits = new Function('usersCollection', 'recordAuditEvent', `${creditSource}\nreturn { consumeSimulationToken, refundSimulationToken };`)({
  async updateOne(_filter, update) {
    balance += update.$inc.simulationTokens;
    if (update.$inc.simulationTokens === 1) refunds++;
    return { matchedCount: 1 };
  },
}, async () => {});
let mode = 'success';
const submitted = [];
const fixture = http.createServer(async (req, res) => {
  if (req.url === '/pdb') return res.end('ATOM      1  N   MET A   1       0.000   0.000   0.000\nEND\n');
  if (req.url === '/ligand') return res.end(pose.ligand);
  let raw = '';
  for await (const chunk of req) raw += chunk;
  const body = JSON.parse(raw);
  submitted.push(body);
  res.setHeader('Content-Type', 'application/json');
  const count = mode === 'partial' ? body.num_poses - 1 : body.num_poses;
  if (mode === 'auth') { res.statusCode = 401; return res.end('{}'); }
  if (mode === 'failed' || (mode === 'retry' && submitted.length === 1)) {
    return res.end(JSON.stringify({ ...pose, status: 'failed', ligand_positions: [''], details: mode === 'retry' ? 'Fail to read ligand molecule description' : 'no poses' }));
  }
  res.end(JSON.stringify({ ...pose, ligand_positions: Array(count).fill(mode === 'empty' ? '' : pose.ligand_positions[0]), position_confidence: Array(count).fill(mode === 'invalid-confidence' ? null : -0.5) }));
});
fixture.listen(0, '127.0.0.1');
await once(fixture, 'listening');
const upstream = `http://127.0.0.1:${fixture.address().port}`;
const app = express();
app.use(express.json());
const pass = (_req, _res, next) => next();
const identity = (req, _res, next) => { req.user = { username: 'test', companyId: 'test' }; next(); };
const deps = {
  app, ensureMongoConnected: pass, authenticateToken: identity, requireActiveUser: pass,
  configuredDiffDockPoseCount, completedDiffDockResult,
  getRequestLigandServiceConfig: async () => ({ diffdockApiUrl: `${upstream}/diffdock` }),
  ...credits, logToFile() {}, SDF_CONVERTER_URL: `${upstream}/converter`, EXTERNAL_HTTP_TIMEOUT_LONG_MS: 1000,
  fetchWithTimeout: (url, options = {}) => fetch(url.includes('files.rcsb.org/download/') ? `${upstream}/pdb` : url.includes('files.rcsb.org/ligands/') ? `${upstream}/ligand` : url, { ...options, signal: AbortSignal.timeout(2000) }),
};
new Function(...Object.keys(deps), routeSource)(...Object.values(deps));
const server = app.listen(0, '127.0.0.1');
await once(server, 'listening');
const base = `http://127.0.0.1:${server.address().port}`;
const previous = process.env.DIFFDOCK_NUM_POSES;
async function run(setting, scenario, expectedStatus, charged, expectedCalls = 1) {
  if (setting === undefined) delete process.env.DIFFDOCK_NUM_POSES;
  else process.env.DIFFDOCK_NUM_POSES = setting;
  mode = scenario; submitted.length = 0; balance = 10; refunds = 0;
  const response = await fetch(`${base}/api/diffdock/generate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ protein: '2rh1', ligand: 'E20' }) });
  const result = await response.json();
  assert.equal(response.status, expectedStatus, JSON.stringify(result));
  assert.equal(balance, 10 - charged);
  assert.equal(refunds, expectedStatus === 502 ? 1 : 0);
  assert.equal(submitted.length, expectedCalls);
  if (expectedStatus === 200) {
    const count = setting === undefined ? 100 : Number(setting);
    assert.equal(submitted[0].num_poses, count);
    assert.equal(result.requested_poses, count);
    assert.equal(result.generated_poses, count);
    assert.equal(result.ligand_positions.length, count);
  }
  console.log(`PASS ${scenario}, poses=${setting ?? 'default'}, status=${expectedStatus}, balance=${balance}`);
}
try {
  await run('10', 'success', 200, 1);
  await run(undefined, 'success', 200, 1);
  for (const invalid of ['0', '101', '1.5', '10junk']) await run(invalid, 'success', 503, 0, 0);
  await run('10', 'failed', 502, 0);
  await run('10', 'partial', 502, 0);
  await run('10', 'empty', 502, 0);
  await run('10', 'invalid-confidence', 502, 0);
  await run('10', 'auth', 502, 0);
  await run('10', 'retry', 200, 1, 2);
} finally {
  if (previous === undefined) delete process.env.DIFFDOCK_NUM_POSES;
  else process.env.DIFFDOCK_NUM_POSES = previous;
  for (const listener of [server, fixture]) {
    listener.closeAllConnections();
    await new Promise(resolve => listener.close(resolve));
  }
}
