// Exercise the actual registered route and credit functions against HTTP fixtures.
// No Atlas, provider traffic or application boot. Inference qualification is separate.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import { once } from 'node:events';
import express from 'express';
import crypto from 'node:crypto';
import { configuredDiffDockPoseCount, completedDiffDockResult, resolveDiffDockUrl, resolveDockingUrl, persistedLigandServiceConfig, completedDockingResult, diffDockFailureResponse } from '../utils/diffdockResult.js';

const legacy = 'https://services.asinex.com:58000/molecular-docking/diffdock/generate';
assert.equal(resolveDiffDockUrl(legacy, 'http://127.0.0.1:18002/generate'), 'http://127.0.0.1:18002/generate');
assert.equal(resolveDiffDockUrl(legacy, undefined), legacy);
assert.equal(resolveDiffDockUrl('http://169.254.169.254/generate', 'http://127.0.0.1:18002/generate'), 'http://169.254.169.254/generate');
assert.equal(resolveDiffDockUrl('https://independent.example/generate', 'http://127.0.0.1:18002/generate'), 'https://independent.example/generate');

const source = readFileSync(new URL('../index.js', import.meta.url), 'utf8');
const deadlineDeclaration = source.match(/^const DIFFDOCK_HTTP_TIMEOUT_MS = .+;$/m)?.[0];
assert.ok(deadlineDeclaration, 'DiffDock has an independent application deadline');
const diffdockDeadline = new Function(`${deadlineDeclaration}; return DIFFDOCK_HTTP_TIMEOUT_MS;`)();
const composeSource = readFileSync(new URL('../../deploy/box/compose.3060.yml', import.meta.url), 'utf8');
const computeDeadline = Number(composeSource.match(/DIFFDOCK_TIMEOUT_SECONDS: "(\d+)"/)[1]) * 1000;
const proxySource = readFileSync(new URL('../../deploy/nginx/diffdock-timeouts.conf', import.meta.url), 'utf8');
const proxyDeadline = Number(proxySource.match(/proxy_read_timeout (\d+)s/)[1]) * 1000;
const clientSource = readFileSync(new URL('../../client/src/pages/dashboard/simulation.jsx', import.meta.url), 'utf8');
const browserExpression = clientSource.slice(clientSource.indexOf('diffDockControllerRef.current = controller;')).match(/controller.abort\(\), ([\d *]+)\);/)[1];
const browserDeadline = new Function(`return ${browserExpression}`)();
assert.equal(computeDeadline, 30 * 60 * 1000);
assert.ok(computeDeadline < diffdockDeadline && diffdockDeadline < proxyDeadline && proxyDeadline < browserDeadline, 'all DiffDock deadline layers leave time for the inner layer to answer');
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
    if (mode === 'refund-failed' && update.$inc.simulationTokens === 1) throw new Error('fixture database outage');
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
  if (mode === 'timeout') return; // Real upstream socket accepts work but never answers.
  res.setHeader('Content-Type', 'application/json');
  const count = mode === 'partial' ? body.num_poses - 1 : body.num_poses;
  if (mode === 'auth') { res.statusCode = 401; return res.end('{}'); }
  if (mode === 'busy' || mode === 'refund-failed') { res.statusCode = 503; return res.end(JSON.stringify({ code: 'DIFFDOCK_BUSY' })); }
  if (mode === 'engine-timeout') return res.end(JSON.stringify({ ...pose, status: 'failed', details: 'DIFFDOCK_TIMEOUT: DiffDock exceeded 540s' }));
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
  configuredDiffDockPoseCount, completedDiffDockResult, diffDockFailureResponse, crypto,
  getRequestLigandServiceConfig: async () => ({ diffdockApiUrl: `${upstream}/diffdock` }),
  ...credits, logToFile() {}, SDF_CONVERTER_URL: `${upstream}/converter`, DIFFDOCK_HTTP_TIMEOUT_MS: diffdockDeadline,
  fetchWithTimeout: (url, options = {}) => {
    if (url === `${upstream}/diffdock`) assert.equal(options.timeoutMs, diffdockDeadline);
    const budget = mode === 'timeout' && url === `${upstream}/diffdock` ? 50 : 2000;
    return fetch(url.includes('files.rcsb.org/download/') ? `${upstream}/pdb` : url.includes('files.rcsb.org/ligands/') ? `${upstream}/ligand` : url, { ...options, signal: AbortSignal.timeout(budget) });
  },
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
  assert.equal(refunds, expectedStatus === 502 || scenario === 'busy' ? 1 : 0);
  assert.equal(submitted.length, expectedCalls);
  if (scenario === 'busy' || scenario === 'timeout' || scenario === 'engine-timeout') {
    assert.equal(result.code, scenario === 'busy' ? 'DIFFDOCK_BUSY' : 'DIFFDOCK_TIMEOUT');
    assert.match(result.error, /No credits were charged/);
    assert.match(result.requestId, /^[a-f0-9-]{36}$/);
  }
  if (scenario === 'refund-failed') {
    assert.equal(result.refundStatus, 'unconfirmed');
    assert.match(result.error, /refund could not be confirmed/);
    assert.ok(result.error.includes(result.requestId), 'support reference must be visible in the existing client error text');
    assert.doesNotMatch(result.error, /No credits were charged/);
  }
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
  await run('10', 'busy', 503, 0);
  await run('10', 'timeout', 502, 0);
  await run('10', 'engine-timeout', 502, 0);
  await run('10', 'refund-failed', 503, 1);
  await run('10', 'retry', 200, 1, 2);
} finally {
  if (previous === undefined) delete process.env.DIFFDOCK_NUM_POSES;
  else process.env.DIFFDOCK_NUM_POSES = previous;
  for (const listener of [server, fixture]) {
    listener.closeAllConnections();
    await new Promise(resolve => listener.close(resolve));
  }
}
