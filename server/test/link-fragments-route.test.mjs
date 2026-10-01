import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import test from 'node:test';
import express from 'express';
import { parseSdf, writeSdf } from '../../services/link-fragments/sdf.mjs';
import { REFINE_REQUEST_TIMEOUT_MS } from '../../client/src/utils/linkFragmentsRequest.js';
import { createLinkFragmentsRouter, LINK_FRAGMENTS_TIMEOUTS, relayStatus } from '../routes/linkFragments.js';

// The service's refinement Python child is limited to 90 s (services/link-fragments).
const SERVICE_REFINE_CHILD_MS = 90000;

test('refinement timeouts nest: service child < relay < browser, with answer margins', () => {
  assert.equal(LINK_FRAGMENTS_TIMEOUTS.refine, 140000);
  assert.equal(REFINE_REQUEST_TIMEOUT_MS, 150000);
  assert(SERVICE_REFINE_CHILD_MS + 30000 <= LINK_FRAGMENTS_TIMEOUTS.refine, 'the relay outlives the Python child plus RDKit setup and the coded answer');
  assert(LINK_FRAGMENTS_TIMEOUTS.refine < REFINE_REQUEST_TIMEOUT_MS, 'the browser outlives the relay, so it sees the relay\'s coded 504 rather than its own abort');
});

test('relay status mapping keeps the session and coded service answers', () => {
  assert.equal(relayStatus(401), 502, 'upstream credential refusal never logs the user out');
  for (const status of [500, 502]) assert.equal(relayStatus(status), 502);
  for (const status of [200, 202, 400, 403, 404, 422, 429, 503, 504]) assert.equal(relayStatus(status), status);
});

const JOB = '0b5f8f0e-6f4c-4c7e-9a51-3c1d2e4f5a6b';
const OTHER_JOB = '11111111-2222-4333-8444-555555555555';
const ownerKey = (companyId, username) => createHash('sha256').update(`${companyId || ''}\0${username}`).digest('hex');

test('real Express relay: owner scoping, validation, inspection merge, jobs, refinement and status translation', async () => {
  const input = await readFile(new URL('../../services/link-fragments/fixtures/query.sdf', import.meta.url), 'utf8');
  const parsed = parseSdf(input);
  parsed[0].title = 'First fragment'; parsed[1].title = 'Second fragment';
  const sdf = parsed.map(molecule => writeSdf(molecule)).join('');
  const requests = [];
  let inspectMode = 'ok';
  let jobsMode = 'ok';
  const upstream = http.createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    requests.push({ url: req.url, method: req.method, owner: req.headers['x-pyxis-owner'], body: body ? JSON.parse(body) : null });
    res.setHeader('Content-Type', 'application/json');
    const send = (status, value) => { res.statusCode = status; res.end(JSON.stringify(value)); };
    if (req.url.startsWith('/unauthorized')) return send(401, { error: 'Scientific credentials rejected' });
    if (req.url === '/status') return send(200, { available: true, records: 2, pairs: 2, method: 'fixture', limitations: ['fixture only'], jobs: { running: 0, queued: 0, workers: 1 } });
    if (req.url === '/inspect') {
      if (inspectMode === 'down') return send(500, { error: 'boom' });
      if (inspectMode === 'refused') return send(400, { error: 'Unsupported element Xe.', details: [{ code: 'UNSUPPORTED_ELEMENT', message: 'Unsupported element Xe.' }] });
      if (inspectMode === 'huge') return res.end(JSON.stringify({ padding: 'x'.repeat(9 * 1024 * 1024) }));
      const site = (atom, element, extra = {}) => ({ atom, element, charge: 0, isotope: null, aromatic: false, heavy: element !== 'H', eligible: false, reason: element === 'H' ? `Select the heavy atom bonded to H${atom}.` : 'No hydrogen to replace.', implicitHydrogens: 0, explicitHydrogens: [], recommendedHydrogenAtom: null, requiresHydrogenSelection: false, ...extra });
      return send(200, { ok: true, fragments: parsed.map((fragment, index) => ({ name: fragment.title, atoms: fragment.atoms.map((atom, j) => index === 1 && j === 5
        ? site(6, 'C', { aromatic: true, eligible: true, reason: null, explicitHydrogens: [7], recommendedHydrogenAtom: 7 })
        : j === 0 ? site(1, atom.element, { eligible: true, reason: null, implicitHydrogens: 3 }) : site(j + 1, atom.element)) })) });
    }
    if (req.url === '/receptor/inspect') return send(422, { code: 'RECEPTOR_FRAME', error: 'No receptor atom lies within 8 A of the query.' });
    if (req.url === '/jobs' && req.method === 'POST' && jobsMode === 'busy') return send(429, { error: 'You already have a linker scan queued or running.', code: 'LINK_FRAGMENTS_OWNER_BUSY', jobId: JOB });
    if (req.url === '/jobs' && req.method === 'POST') return send(202, { job: { id: JOB, state: 'queued', complete: false, partial: true } });
    if (req.url === '/jobs') return send(200, { jobs: [{ id: JOB, state: 'running' }] });
    if (req.url === `/jobs/${JOB}`) return send(200, { job: { id: JOB, state: 'running', complete: false, partial: true, results: [] } });
    if (req.url === `/jobs/${JOB}/cancel`) return send(200, { job: { id: JOB, state: 'canceled', complete: false, partial: true } });
    if (req.url === `/jobs/${JOB}/results/12-3-4`) return send(200, { result: { id: '12-3-4', sdf: 'product' } });
    if (req.url === `/jobs/${JOB}/results/12-3-4/refine`) return send(200, { refinement: { ok: true, forceField: 'MMFF94' } });
    if (req.url === `/jobs/${JOB}/results/12-3-5/refine`) return send(422, { code: 'RECEPTOR_FRAME_MISMATCH', error: 'Receptor is far from the ligand.' });
    if (req.url === `/jobs/${JOB}/results/12-3-6/refine`) return send(503, { code: 'REFINEMENT_BUSY', error: 'Refinement is busy.' });
    if (req.url === `/jobs/${JOB}/results/12-3-7/refine`) return send(504, { code: 'REFINEMENT_TIMEOUT', error: 'Refinement exceeded 90 s and was stopped.' });
    if (req.url === `/jobs/${JOB}/results/12-3-8/refine`) return send(503, { code: 'REFINEMENT_UNAVAILABLE', error: 'RDKit is not installed.' });
    if (req.url === `/jobs/${JOB}/results/9-9-9`) return send(500, { error: 'crash' });
    return send(404, { code: 'JOB_NOT_FOUND', error: 'Search job not found.' });
  });
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
  const app = express();
  app.use(express.json({ limit: '8mb' }));
  // Stand-in for authenticateToken: the route must use only this verified user.
  app.use((req, _res, next) => { req.user = JSON.parse(req.headers['x-test-user'] || 'null'); next(); });
  app.use('/unconfigured', createLinkFragmentsRouter());
  const upstreamUrl = `http://127.0.0.1:${upstream.address().port}`;
  app.use('/ready', createLinkFragmentsRouter({ baseUrl: upstreamUrl }));
  app.use('/bad-auth', createLinkFragmentsRouter({ baseUrl: `${upstreamUrl}/unauthorized` }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const anna = { username: 'anna', companyId: 'company-a' };
  const call = (url, { body, user = anna, headers = {} } = {}) => fetch(base + url, {
    method: body ? 'POST' : 'GET',
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(user ? { 'X-Test-User': JSON.stringify(user) } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = async response => ({ status: response.status, body: await response.json() });
  try {
    // Unconfigured deployments: status/jobs 503, inspection still works locally.
    assert.equal((await call('/unconfigured/status')).status, 503);
    assert.equal((await call('/unconfigured/jobs', { body: { sdf, attachments: [1, 1] } })).status, 503);
    const local = await json(await call('/unconfigured/inspect', { body: { sdf } }));
    assert.equal(local.status, 200, JSON.stringify(local.body));
    assert.equal(local.body.eligibility, 'unavailable');
    assert.match(local.body.eligibilityError, /not configured/);
    assert.deepEqual(local.body.fragments.map(fragment => fragment.name), ['First fragment', 'Second fragment']);
    const localAtom6 = local.body.fragments[1].atoms[5];
    assert.deepEqual(localAtom6, { number: 6, element: 'C', x: parsed[1].atoms[5].xyz[0], y: parsed[1].atoms[5].xyz[1], z: parsed[1].atoms[5].xyz[2], charge: 0, isotope: null, eligible: null, reason: null, implicitHydrogens: null, explicitHydrogens: [7], recommendedHydrogenAtom: null, requiresHydrogenSelection: false });

    // Owner key: server-derived from the verified user only.
    const forged = 'f'.repeat(64);
    const checked = await json(await call('/ready/inspect', { body: { sdf }, headers: { 'X-Pyxis-Owner': forged } }));
    assert.equal(checked.status, 200);
    assert.equal(checked.body.eligibility, 'checked');
    assert.equal(requests.at(-1).owner, ownerKey('company-a', 'anna'));
    assert.notEqual(requests.at(-1).owner, forged, 'client-supplied owner header is ignored');
    assert.deepEqual(requests.at(-1).body, { sdf });
    const merged6 = checked.body.fragments[1].atoms[5];
    assert.equal(merged6.eligible, true); assert.equal(merged6.reason, null);
    assert.deepEqual(merged6.explicitHydrogens, [7]); assert.equal(merged6.recommendedHydrogenAtom, 7);
    assert.equal(merged6.x, parsed[1].atoms[5].xyz[0], 'viewer coordinates come from the uploaded file');
    assert.match(checked.body.fragments[1].atoms[6].reason, /heavy atom bonded to H7/);
    assert.equal(checked.body.fragments[0].atoms[0].implicitHydrogens, 3);
    await call('/ready/jobs');
    assert.equal(requests.at(-1).owner, ownerKey('company-a', 'anna'), 'same user keeps the same owner key');
    await call('/ready/jobs', { user: { username: 'anna', companyId: 'company-b' } });
    assert.equal(requests.at(-1).owner, ownerKey('company-b', 'anna'));
    assert.notEqual(requests.at(-1).owner, ownerKey('company-a', 'anna'), 'same username in another company is another owner');
    await call('/ready/jobs', { user: { username: 'solo' } });
    assert.equal(requests.at(-1).owner, ownerKey('', 'solo'));
    assert.match(requests.at(-1).owner, /^[0-9a-f]{64}$/);

    // Authorization failures are 403 (never 401) and never reach upstream.
    const before = requests.length;
    for (const user of [null, { companyId: 'company-a' }, { username: '' }]) {
      assert.equal((await call('/ready/jobs', { user })).status, 403);
      assert.equal((await call('/ready/inspect', { user, body: { sdf } })).status, 403);
    }
    // Validation failures stay local.
    const badJobs = [
      { sdf: writeSdf(parsed[0]), attachments: [1, 1] },
      { sdf: sdf.replaceAll('3D', '2D'), attachments: [1, 1] },
      { sdf: sdf.replaceAll('V2000', 'V3000'), attachments: [1, 1] },
      { sdf: 'x'.repeat(800001), attachments: [1, 1] },
      ...[[0, 1], [1, 201], [1.5, 1], [1], ['1', 1], [1, 12 + 7], [1, 7], [1, { atom: 6, hydrogenAtom: 5 }], [1, { atom: 6, hydrogenAtom: 6 }], [1, { atom: '6' }], [1, [6]], [1, null]].map(attachments => ({ sdf, attachments })),
      { sdf, attachments: [1, 1], maxRmsd: 0.05 }, { sdf, attachments: [1, 1], maxRmsd: '0.5' }, { sdf, attachments: [1, 1], maxRmsd: 1.5 },
      { sdf, attachments: [1, 1], limit: 0 }, { sdf, attachments: [1, 1], limit: 51 }, { sdf, attachments: [1, 1], limit: 1.5 },
    ];
    for (const body of badJobs) {
      const response = await json(await call('/ready/jobs', { body }));
      assert.equal(response.status, 400, JSON.stringify(body.attachments));
      assert.equal(typeof response.body.error, 'string');
    }
    assert.equal((await call('/ready/inspect', { body: { sdf: 'not an sdf' } })).status, 400);
    for (const url of ['/ready/jobs/not-a-uuid', `/ready/jobs/${JOB}/results/12-3`, `/ready/jobs/${JOB}/results/..%2F..%2Fstatus`, '/ready/jobs/..%2Fstatus/cancel']) {
      assert.equal((await call(url, url.endsWith('cancel') ? { body: {} } : {})).status, 400, url);
    }
    for (const body of [{ forceField: 'AMBER' }, { forceField: 'auto', receptorPdb: '' }, { forceField: 'auto', receptorPdb: 42 }, { receptorPdb: 'A'.repeat(5 * 1024 * 1024 + 1) }]) {
      assert.equal((await call(`/ready/jobs/${JOB}/results/12-3-4/refine`, { body })).status, 400);
    }
    assert.equal(requests.length, before, 'authorization and validation failures never reach the scientific service');

    // Jobs lifecycle relays.
    const created = await json(await call('/ready/jobs', { body: { sdf, attachments: [1, { atom: 6, hydrogenAtom: 7 }], extra: 'dropped' } }));
    assert.equal(created.status, 202); assert.equal(created.body.job.id, JOB);
    assert.deepEqual(requests.at(-1).body, { sdf, attachments: [1, { atom: 6, hydrogenAtom: 7 }], maxRmsd: 0.75, limit: 20 });
    await call('/ready/jobs', { body: { sdf, attachments: [{ atom: 1 }, 6], maxRmsd: 0.4, limit: 50 } });
    assert.deepEqual(requests.at(-1).body.attachments, [{ atom: 1 }, 6]);
    assert.equal(requests.at(-1).body.limit, 50);
    const polled = await json(await call(`/ready/jobs/${JOB.toUpperCase()}`));
    assert.equal(polled.status, 200); assert.equal(polled.body.job.state, 'running');
    assert.equal(requests.at(-1).url, `/jobs/${JOB}`);
    const canceled = await json(await call(`/ready/jobs/${JOB}/cancel`, { body: { owner: 'someone-else' } }));
    assert.equal(canceled.body.job.state, 'canceled');
    assert.deepEqual({ url: requests.at(-1).url, method: requests.at(-1).method, body: requests.at(-1).body }, { url: `/jobs/${JOB}/cancel`, method: 'POST', body: {} });
    const missing = await json(await call(`/ready/jobs/${OTHER_JOB}`));
    assert.deepEqual(missing, { status: 404, body: { code: 'JOB_NOT_FOUND', error: 'Search job not found.' } }, 'another owner\'s job stays 404');
    assert.equal((await json(await call(`/ready/jobs/${JOB}/results/12-3-4`))).body.result.sdf, 'product');
    assert.equal((await call(`/ready/jobs/${JOB}/results/9-9-9`)).status, 502, 'upstream crashes are gateway errors');
    assert.equal((await call('/ready/search', { body: { sdf, attachmentAtoms: [1, 1] } })).status, 404, 'the bounded synchronous search route is gone');

    // Refinement forwarding with a receptor.
    const receptorPdb = 'ATOM      1  N   ALA A   1     -12.000 -15.000  30.000  1.00  0.00           N\nEND\n';
    const preflight = await json(await call('/ready/receptor/inspect', { body: { sdf, receptorPdb, owner: 'forged' } }));
    assert.deepEqual([preflight.status, preflight.body.code], [422, 'RECEPTOR_FRAME']);
    assert.deepEqual(requests.at(-1).body, { sdf, receptorPdb });
    assert.equal(requests.at(-1).owner, ownerKey('company-a', 'anna'));
    assert.equal((await call('/ready/receptor/inspect', { body: { sdf, receptorPdb: '' } })).status, 400);
    assert.equal((await call('/ready/receptor/inspect', { body: { sdf, receptorPdb }, user: null })).status, 403);
    await call('/ready/jobs', { body: { sdf, attachments: [1, 1], receptorPdb } });
    assert.equal(requests.at(-1).body.receptorPdb, receptorPdb, 'the initial scan receives the receptor, not just refinement');
    assert.equal((await call('/ready/jobs', { body: { sdf, attachments: [1, 1], receptorPdb: 42 } })).status, 400);
    const refined = await json(await call(`/ready/jobs/${JOB}/results/12-3-4/refine`, { body: { forceField: 'MMFF94', receptorPdb } }));
    assert.equal(refined.status, 200); assert.equal(refined.body.refinement.forceField, 'MMFF94');
    assert.deepEqual(requests.at(-1).body, { forceField: 'MMFF94', receptorPdb });
    assert.equal(requests.at(-1).owner, ownerKey('company-a', 'anna'));
    await call(`/ready/jobs/${JOB}/results/12-3-4/refine`, { body: {} });
    assert.deepEqual(requests.at(-1).body, { forceField: 'auto' });
    const mismatch = await json(await call(`/ready/jobs/${JOB}/results/12-3-5/refine`, { body: { forceField: 'UFF', receptorPdb } }));
    assert.equal(mismatch.status, 422); assert.equal(mismatch.body.code, 'RECEPTOR_FRAME_MISMATCH');
    const busyRefine = await json(await call(`/ready/jobs/${JOB}/results/12-3-6/refine`, { body: {} }));
    assert.deepEqual([busyRefine.status, busyRefine.body.code], [503, 'REFINEMENT_BUSY']);
    // Regression: a service refinement timeout was reported as a 502 gateway error.
    const timedOut = await json(await call(`/ready/jobs/${JOB}/results/12-3-7/refine`, { body: {} }));
    assert.deepEqual(timedOut, { status: 504, body: { code: 'REFINEMENT_TIMEOUT', error: 'Refinement exceeded 90 s and was stopped.' } });
    const noRdkit = await json(await call(`/ready/jobs/${JOB}/results/12-3-8/refine`, { body: {} }));
    assert.deepEqual([noRdkit.status, noRdkit.body.code], [503, 'REFINEMENT_UNAVAILABLE'], '503 codes pass through');
    // Owner already has a scan: 429 with its job id passes through to the page.
    jobsMode = 'busy';
    const ownerBusy = await json(await call('/ready/jobs', { body: { sdf, attachments: [1, 1] } }));
    assert.deepEqual(ownerBusy, { status: 429, body: { error: 'You already have a linker scan queued or running.', code: 'LINK_FRAGMENTS_OWNER_BUSY', jobId: JOB } });
    jobsMode = 'ok';

    // Inspection fallbacks.
    inspectMode = 'down';
    const fallback = await json(await call('/ready/inspect', { body: { sdf } }));
    assert.equal(fallback.status, 200); assert.equal(fallback.body.eligibility, 'unavailable');
    assert(fallback.body.fragments.every(fragment => fragment.atoms.every(atom => atom.eligible === null)));
    inspectMode = 'huge';
    assert.equal((await json(await call('/ready/inspect', { body: { sdf } }))).body.eligibility, 'unavailable', 'oversized upstream bodies are refused');
    inspectMode = 'refused';
    const refused = await json(await call('/ready/inspect', { body: { sdf } }));
    assert.equal(refused.status, 400); assert.match(refused.body.error, /Xe/);

    // Scientific credential refusal must not log out the application session.
    const status = await json(await call('/ready/status'));
    assert.equal(status.status, 200); assert.equal(status.body.records, 2);
    assert.equal(requests.at(-1).owner, undefined, 'status does not need an owner');
    assert.equal((await call('/bad-auth/status')).status, 502);
    assert.equal((await call(`/bad-auth/jobs/${JOB}`)).status, 502);
    assert.equal((await json(await call('/bad-auth/inspect', { body: { sdf } }))).body.eligibility, 'unavailable');
  } finally {
    server.closeAllConnections(); upstream.closeAllConnections();
    await Promise.all([new Promise(resolve => server.close(resolve)), new Promise(resolve => upstream.close(resolve))]);
  }
});
