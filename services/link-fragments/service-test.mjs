import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as sdfModule from './sdf.mjs';
import { createLinkerServer, refinementFailureStatus } from './serve.mjs';
import { TopProducts, mergeProducts, conformerMatchesOf } from './jobs.mjs';
import { prepareQuery, linkerDescriptor, fitAndJoinReference } from './engine.mjs';
import { scoreReceptor, inspectReceptor } from './receptor.mjs';

const OWNER_A = 'a'.repeat(64);
const OWNER_B = 'b'.repeat(64);
const OWNER_C = 'c'.repeat(64);
const linkerPath = fileURLToPath(new URL('fixtures/linker.sdf', import.meta.url));
const query = await readFile(new URL('fixtures/query.sdf', import.meta.url), 'utf8');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// The fixture linker has two He labels: every copy contributes one indexed pair.
// `source` optionally replaces the fixture with another SDF of `records` records.
function buildIndex(directory, copies, source = linkerPath, records = 1) {
  const archive = path.join(directory, `linkers-${copies}.zip`);
  const indexPath = path.join(directory, `linkers-${copies}.sqlite`);
  execFileSync('python3', ['-c', 'import sys,zipfile,pathlib; record=pathlib.Path(sys.argv[1]).read_text(); archive=zipfile.ZipFile(sys.argv[2],"w",zipfile.ZIP_DEFLATED); archive.writestr("linker-conformers.sdf",record*int(sys.argv[3])); archive.close()', source, archive, String(copies)]);
  const report = JSON.parse(execFileSync('python3', [fileURLToPath(new URL('build.py', import.meta.url)), '--input', archive, '--out', indexPath, '--expected-rows', String(copies * records)], { encoding: 'utf8' }).trim().split('\n').pop());
  return { indexPath, report };
}
async function start(indexPath, jobOptions, serverOptions = {}) {
  const server = await createLinkerServer({ indexPath, jobOptions: { workers: 2, ...jobOptions }, ...serverOptions });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  const call = async (route, { owner = OWNER_A, method = 'GET', body } = {}) => {
    const headers = { 'Content-Type': 'application/json' };
    if (owner) headers['X-Pyxis-Owner'] = owner;
    const response = await fetch(`${url}${route}`, { method, headers, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };
  const poll = async (id, done, owner = OWNER_A, timeoutMs = 60_000) => {
    const until = Date.now() + timeoutMs;
    for (;;) {
      const { body } = await call(`/jobs/${id}`, { owner });
      if (done(body.job)) return body.job;
      if (Date.now() > until) throw new Error(`Job did not reach the expected state: ${JSON.stringify(body.job)}`);
      await sleep(50);
    }
  };
  return { server, call, poll };
}
async function stop(server) {
  if (!server) return;
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
const reference = { sdf: query, attachments: [1, 1], maxRmsd: 0.75, limit: 10 };

test('HTTP receptor preflight and full worker scan apply receptor ranking before retaining hits', { timeout: 120_000 }, async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'pyxis-linker-receptor-job-'));
  let server;
  try {
    const { indexPath } = buildIndex(temporary, 260);
    const prepared = await prepareQuery(query, [1, 1]);
    const original = await fitAndJoinReference(prepared, linkerDescriptor(await readFile(linkerPath, 'utf8')));
    const obstruction = sdfModule.parseSdf(original.sdf)[0].atoms[original.fragmentAtomCount].xyz;
    const pdb = xyz => `ATOM      1  CA  ALA A   1    ${xyz.map(v => v.toFixed(3).padStart(8)).join('')}  1.00 20.00           C  \nEND\n`;
    const receptorPdb = pdb(obstruction);
    const runtime = await start(indexPath, { workers: 1, chunkRows: 10 }); server = runtime.server;
    const preflight = await runtime.call('/receptor/inspect', { method: 'POST', body: { sdf: query, receptorPdb } });
    assert.equal(preflight.status, 200, JSON.stringify(preflight.body));
    assert.equal(preflight.body.report.screeningDuringSearch, true);
    const bad = { ...reference, receptorPdb: pdb([1000, 1000, 1000]) };
    assert.equal((await runtime.call('/receptor/inspect', { method: 'POST', body: bad })).body.code, 'RECEPTOR_FRAME');
    assert.equal((await runtime.call('/jobs', { method: 'POST', body: bad })).status, 422, 'job submit validates even if preflight was bypassed');
    const created = await runtime.call('/jobs', { method: 'POST', body: { ...reference, limit: 1, receptorPdb } });
    assert.equal(created.status, 202, JSON.stringify(created.body));
    const finished = await runtime.poll(created.body.job.id, job => job.finishedAt);
    assert.equal(finished.state, 'completed', JSON.stringify(finished));
    assert.equal(finished.progress.examinedPairs, 260, 'including all duplicate candidates beyond the former cap');
    assert.equal(finished.progress.validPlacements, 260);
    assert.equal(finished.results[0].conformerMatches, 260, 'no geometry-only deferral in receptor mode');
    assert.equal(finished.results[0].receptor.severeClashes, 0);
    assert.equal(server.jobs.findResult(OWNER_A, finished.id, finished.results[0].id).job.receptor, null, 'terminal history releases the parsed receptor spatial index');
    const checked = inspectReceptor(receptorPdb, prepared.fragments);
    assert(scoreReceptor(checked.context, sdfModule.parseSdf(original.sdf)[0].atoms).severeClashes > 0, 'geometry-only placement clashes');
    assert.equal(finished.input.receptorPdb, receptorPdb);
    assert.equal((await runtime.call('/jobs')).body.jobs[0].input, undefined, 'history listing stays small');
    await stop(server); server = null;
    const reopened = await start(indexPath, { workers: 1 }); server = reopened.server;
    const saved = await reopened.call(`/jobs/${finished.id}`);
    assert.equal(saved.body.job.complete, true);
    assert.equal(saved.body.job.input.sdf, query);
    assert.equal(saved.body.job.results[0].receptor.severeClashes, 0);
    assert.equal((await reopened.call(`/jobs/${finished.id}`, { owner: OWNER_B })).status, 404);
  } finally { await stop(server); await rm(temporary, { recursive: true, force: true }); }
});

test('full-scan job: duplicate candidates, results, exact coordinates, owner isolation and status', { timeout: 120_000 }, async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'pyxis-linker-jobs-'));
  let server;
  try {
    const { indexPath, report } = buildIndex(temporary, 2);
    assert.equal(report.records, 2);
    assert.equal(report.pairs, 2);
    let call, poll;
    ({ server, call, poll } = await start(indexPath, { chunkRows: 1 }));
    const status = await call('/status', { owner: null });
    assert.equal(status.status, 200);
    assert.equal(status.body.available, true);
    assert.equal(status.body.records, 2);
    assert.equal(status.body.pairs, 2);
    assert(status.body.method && status.body.limitations.length);
    assert.deepEqual(Object.keys(status.body.jobs).sort(), ['queued', 'running', 'workers']);
    assert.equal(typeof status.body.refinement.available, 'boolean');
    assert(status.body.refinement.available ? status.body.refinement.forceFields.includes('MMFF94') : status.body.refinement.reason);

    assert.equal((await call('/jobs', { owner: null })).body.code, 'OWNER_REQUIRED');
    assert.equal((await call('/jobs', { owner: OWNER_A.toUpperCase() })).status, 400);
    assert.equal((await call('/inspect', { owner: null, method: 'POST', body: { sdf: query } })).status, 400);
    assert.equal((await call('/jobs', { method: 'POST', body: '{bad json' })).status, 400);
    assert.equal((await call('/jobs', { method: 'POST', body: { ...reference, attachments: [0, 1] } })).status, 400);
    assert.equal((await call('/jobs', { method: 'POST', body: { ...reference, maxRmsd: 3 } })).status, 400);
    assert.equal((await call('/jobs', { method: 'POST', body: { ...reference, limit: 51 } })).status, 400);
    const inspected = await call('/inspect', { method: 'POST', body: { sdf: query } });
    assert.equal(inspected.status, 200, JSON.stringify(inspected.body));
    assert.equal(inspected.body.fragments.length, 2);

    const created = await call('/jobs', { method: 'POST', body: reference });
    assert.equal(created.status, 202, JSON.stringify(created.body));
    const { id } = created.body.job;
    assert.match(id, /^[0-9a-f-]{36}$/);
    assert.equal(created.body.job.complete, false);
    assert.equal(created.body.job.partial, true);
    const job = await poll(id, (value) => value.finishedAt);
    assert.equal(job.state, 'completed', JSON.stringify(job));
    assert.equal(job.complete, true);
    assert.equal(job.partial, false);
    assert.equal(job.error, null);
    // Both copies of the record share one anchor distance; both are examined.
    assert.equal(job.progress.totalPairs, 2);
    assert.equal(job.progress.examinedPairs, 2);
    assert.equal(job.progress.fraction, 1);
    assert.equal(job.progress.conformersExamined, 2);
    assert.equal(job.progress.validPlacements, 2);
    assert(job.progress.distanceWindow.lo < job.query.distance && job.progress.distanceWindow.hi > job.query.distance);
    assert.equal(job.results.length, 1, JSON.stringify(job.results));
    const [summary] = job.results;
    assert.equal(summary.rank, 1);
    assert.equal(summary.conformerId, 1);
    assert.equal(summary.conformerMatches, 2);
    assert.match(summary.id, /^1-\d+-\d+$/);
    assert(summary.linkerId && summary.smiles && summary.linkerAtoms.length === 2 && summary.heavyAtoms > 0);
    assert(summary.rmsd > 0 && summary.rmsd < 0.75);
    assert.equal(summary.refined, false);
    assert.equal(job.resultsRetained, 1);

    const detail = await call(`/jobs/${id}/results/${summary.id}`);
    assert.equal(detail.status, 200);
    const product = sdfModule.parseSdf(detail.body.result.sdf);
    assert.equal(product.length, 1);
    const original = sdfModule.parseSdf(query).flatMap((fragment) => fragment.atoms);
    // Reference attachments use implicit H: every uploaded atom survives, in order.
    original.forEach((atom, index) => { assert.deepEqual(product[0].atoms[index].xyz, atom.xyz); });
    if (typeof sdfModule.withSdfData === 'function') assert.match(detail.body.result.sdf, /<PYXIS_CONFORMER_ID>\s*\n1\n/);
    assert.equal(detail.body.result.refinement, null);
    assert.equal((await call(`/jobs/${id}/results/9-9-9`)).body.code, 'RESULT_NOT_FOUND');
    assert.equal((await call(`/jobs/${id}/results/${summary.id}/refine`, { method: 'POST', body: { forceField: 'GAFF' } })).status, 400);

    // Other owners cannot see, read, cancel or refine this job.
    assert.equal((await call(`/jobs/${id}`, { owner: OWNER_B })).status, 404);
    assert.equal((await call(`/jobs/${id}/cancel`, { owner: OWNER_B, method: 'POST' })).status, 404);
    assert.equal((await call(`/jobs/${id}/results/${summary.id}`, { owner: OWNER_B })).body.code, 'JOB_NOT_FOUND');
    assert.equal((await call(`/jobs/${id}/results/${summary.id}/refine`, { owner: OWNER_B, method: 'POST', body: {} })).status, 404);
    assert.deepEqual((await call('/jobs', { owner: OWNER_B })).body.jobs, []);
    assert.deepEqual((await call('/jobs')).body.jobs.map((value) => value.id), [id]);
    assert.equal((await call('/jobs')).body.jobs[0].results, undefined);
    // Cancel of a finished job is idempotent and leaves it complete.
    const late = await call(`/jobs/${id}/cancel`, { method: 'POST' });
    assert.equal(late.body.job.state, 'completed');
    assert.equal(late.body.job.complete, true);

    const refine = await call(`/jobs/${id}/results/${summary.id}/refine`, { method: 'POST', body: { forceField: 'auto' } });
    if (status.body.refinement.available) {
      assert.equal(refine.status, 200, JSON.stringify(refine.body));
      assert.equal(refine.body.refinement.ok, true);
      assert(['MMFF94', 'UFF'].includes(refine.body.refinement.forceField));
      const after = await call(`/jobs/${id}`);
      assert.equal(after.body.job.results[0].refined, true);
    } else assert.equal(refine.body.code, 'REFINEMENT_UNAVAILABLE');
    assert.equal((await call('/unknown')).status, 404);
  } finally {
    await stop(server);
    await rm(temporary, { recursive: true, force: true });
  }
});

test('cancel, per-owner and global queue limits, worker failure and wall-time limit stay partial', { timeout: 120_000 }, async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'pyxis-linker-jobs-'));
  const servers = [];
  try {
    const { indexPath } = buildIndex(temporary, 40);
    const slow = await start(indexPath, { chunkRows: 2, queueLimit: 1, testHooks: { conformerDelayMs: 100 } });
    servers.push(slow.server);
    const first = (await slow.call('/jobs', { method: 'POST', body: reference })).body.job;
    // The owner's own active scan is a distinct refusal that names that scan.
    const busy = await slow.call('/jobs', { method: 'POST', body: reference });
    assert.equal(busy.status, 429);
    assert.equal(busy.body.code, 'LINK_FRAGMENTS_OWNER_BUSY');
    assert.equal(busy.body.jobId, first.id);
    assert(busy.body.error);
    const queued = await slow.call('/jobs', { owner: OWNER_B, method: 'POST', body: reference });
    assert.equal(queued.status, 202);
    assert.equal(queued.body.job.state, 'queued');
    const full = await slow.call('/jobs', { owner: OWNER_C, method: 'POST', body: reference });
    assert.equal(full.status, 429);
    assert.equal(full.body.code, 'LINK_FRAGMENTS_QUEUE_FULL');
    const running = await slow.poll(first.id, (value) => value.progress.examinedPairs > 0);
    assert.equal(running.state, 'running');
    assert.equal(running.progress.totalPairs, 40);
    if (running.results[0]) {
      const premature = await slow.call(`/jobs/${first.id}/results/${running.results[0].id}/refine`, { method: 'POST', body: {} });
      assert.deepEqual([premature.status, premature.body.code], [409, 'LINK_FRAGMENTS_SEARCH_ACTIVE']);
    }
    assert.equal((await slow.call('/status', { owner: null })).body.jobs.running, 1);
    const canceled = await slow.call(`/jobs/${first.id}/cancel`, { method: 'POST' });
    assert.equal(canceled.status, 200);
    assert.equal(canceled.body.job.state, 'canceled');
    assert.equal(canceled.body.job.complete, false);
    assert.equal(canceled.body.job.partial, true);
    assert(canceled.body.job.progress.examinedPairs < 40);
    assert.equal((await slow.call(`/jobs/${first.id}/cancel`, { method: 'POST' })).body.job.state, 'canceled');
    // The queued job now runs; canceling it again leaves it partial.
    const next = await slow.poll(queued.body.job.id, (value) => value.state === 'running', OWNER_B);
    const nextCanceled = (await slow.call(`/jobs/${next.id}/cancel`, { owner: OWNER_B, method: 'POST' })).body.job;
    assert.equal(nextCanceled.state, 'canceled');
    assert.equal(nextCanceled.complete, false);
    await sleep(400);
    const settled = (await slow.call(`/jobs/${first.id}`)).body.job;
    assert.equal(settled.state, 'canceled');
    assert.equal(settled.complete, false);
    assert.equal(settled.progress.examinedPairs, canceled.body.job.progress.examinedPairs);
    // A queued job can be canceled before it starts.
    const blocker = (await slow.call('/jobs', { owner: OWNER_C, method: 'POST', body: reference })).body.job;
    const waiting = (await slow.call('/jobs', { method: 'POST', body: reference })).body.job;
    assert.equal(waiting.state, 'queued');
    const dropped = (await slow.call(`/jobs/${waiting.id}/cancel`, { method: 'POST' })).body.job;
    assert.equal(dropped.state, 'canceled');
    assert.equal(dropped.startedAt, null);
    await slow.call(`/jobs/${blocker.id}/cancel`, { owner: OWNER_C, method: 'POST' });

    const failing = await start(indexPath, { chunkRows: 2, testHooks: { failAtConformer: 7 } });
    servers.push(failing.server);
    const broken = (await failing.call('/jobs', { method: 'POST', body: reference })).body.job;
    const failed = await failing.poll(broken.id, (value) => value.finishedAt);
    assert.equal(failed.state, 'failed');
    assert.equal(failed.complete, false);
    assert.equal(failed.partial, true);
    assert.equal(failed.error.code, 'LINK_FRAGMENTS_SCAN_FAILED');
    assert(failed.progress.examinedPairs < failed.progress.totalPairs);

    const crashing = await start(indexPath, { chunkRows: 2, testHooks: { crashAtConformer: 9 } });
    servers.push(crashing.server);
    const crashed = await crashing.poll((await crashing.call('/jobs', { method: 'POST', body: reference })).body.job.id, (value) => value.finishedAt);
    assert.equal(crashed.state, 'failed');
    assert.equal(crashed.complete, false);
    assert.equal(crashed.error.code, 'LINK_FRAGMENTS_WORKER_FAILED');
    // The lost worker is replaced for later jobs.
    for (let tries = 0; (await crashing.call('/status', { owner: null })).body.jobs.workers < 2; tries++) { assert(tries < 200); await sleep(50); }

    const limited = await start(indexPath, { chunkRows: 2, maxJobMs: 300, testHooks: { conformerDelayMs: 100 } });
    servers.push(limited.server);
    const timed = (await limited.call('/jobs', { method: 'POST', body: reference })).body.job;
    const expired = await limited.poll(timed.id, (value) => value.finishedAt);
    assert.equal(expired.state, 'failed');
    assert.equal(expired.complete, false);
    assert.equal(expired.error.code, 'LINK_FRAGMENTS_TIME_LIMIT');
  } finally {
    for (const server of servers) await stop(server);
    await rm(temporary, { recursive: true, force: true });
  }
});

test('deferred placements: counted as valid, never retained, and match counts flagged as lower bounds', { timeout: 120_000 }, async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'pyxis-linker-jobs-'));
  let server;
  try {
    // Same linker graph at several scales: one stereo product, distinct anchor
    // RMSDs. Written best-first so the one-slot top-K fills on conformer 1.
    const base = sdfModule.parseSdf(await readFile(linkerPath, 'utf8'))[0];
    const centroid = [0, 1, 2].map((k) => base.atoms.reduce((sum, a) => sum + a.xyz[k], 0) / base.atoms.length);
    const prepared = await prepareQuery(query, reference.attachments);
    const copies = [];
    for (const factor of [1, 0.995, 1.005, 0.99, 1.01, 0.985, 1.015]) {
      const scaled = structuredClone(base);
      for (const a of scaled.atoms) a.xyz = a.xyz.map((v, k) => centroid[k] + (v - centroid[k]) * factor);
      const text = sdfModule.writeSdf(scaled);
      const fit = await fitAndJoinReference(prepared, linkerDescriptor(text), { maxRmsd: reference.maxRmsd });
      if (fit.ok) copies.push({ text, fit });
    }
    copies.sort((x, y) => x.fit.rmsd - y.fit.rmsd);
    assert(copies.length >= 4, `only ${copies.length} valid scaled copies`);
    assert(new Set(copies.map((c) => c.fit.smiles)).size === 1);
    assert(copies.every((c, i) => !i || c.fit.rmsd > copies[i - 1].fit.rmsd));
    const source = path.join(temporary, 'graded.sdf');
    await writeFile(source, copies.map((c) => c.text).join(''));
    const { indexPath, report } = buildIndex(temporary, 1, source, copies.length);
    assert.equal(report.records, copies.length);
    let call, poll;
    // One worker and one-row chunks: conformer 1 is merged (threshold set)
    // before any later conformer is fitted, so every later one is deferred.
    ({ server, call, poll } = await start(indexPath, { workers: 1, chunkRows: 1 }));
    const run = async (limit) => {
      const created = await call('/jobs', { method: 'POST', body: { ...reference, limit } });
      assert.equal(created.status, 202, JSON.stringify(created.body));
      return poll(created.body.job.id, (value) => value.finishedAt);
    };
    const deferred = await run(1);
    const exact = await run(10);
    for (const job of [deferred, exact]) {
      assert.equal(job.state, 'completed', JSON.stringify(job));
      assert.equal(job.progress.examinedPairs, copies.length);
      assert.equal(job.progress.validPlacements, copies.length);
      assert.equal(job.progress.distinctProducts, 1);
      assert.equal(job.results.length, 1);
      assert.equal(job.results[0].conformerId, 1);
      assert.equal(job.results[0].rmsd, copies[0].fit.rmsd);
      assert.equal(job.results[0].smiles, copies[0].fit.smiles);
      assert.equal(job.results[0].minimumNonbondedRadiusRatio, copies[0].fit.minimumNonbondedRadiusRatio);
    }
    // With limit 1 the later conformers never computed a SMILES.
    assert.equal(deferred.progress.conformerMatchesExact, false);
    assert.equal(deferred.results[0].conformerMatches, 1);
    // With limit 10 the top-K never fills, nothing is deferred and counts are exact.
    assert.equal(exact.progress.conformerMatchesExact, true);
    assert.equal(exact.results[0].conformerMatches, copies.length);
    const detail = await call(`/jobs/${deferred.id}/results/${deferred.results[0].id}`);
    assert.equal(detail.status, 200);
    assert.deepEqual(
      sdfModule.parseSdf(detail.body.result.sdf)[0].atoms.map((a) => a.xyz),
      sdfModule.parseSdf(copies[0].fit.sdf)[0].atoms.map((a) => a.xyz),
    );
  } finally {
    await stop(server);
    await rm(temporary, { recursive: true, force: true });
  }
});

test('matchCounts cap: a retained product first seen after the cap keeps its own conformer count', () => {
  const placement = (smiles, rmsd, conformerId, conformers) => ({ smiles, rmsd, ratio: null, conformerId, pair: [1, 2], conformers, detail: { sdf: smiles } });
  const state = { top: new TopProducts(3), matchCounts: new Map(), matchCountsExact: true };
  // Cap of one tracked SMILES: 'A' fills it; 'B' and 'C' arrive later and are untracked.
  assert.equal(mergeProducts(state, [placement('A', 0.5, 1, 2)], 1), true);
  assert.equal(state.matchCountsExact, true);
  mergeProducts(state, [placement('B', 0.4, 2, 3), placement('C', 0.6, 3, 1)], 1);
  assert.equal(state.matchCountsExact, false);
  assert.deepEqual([...state.matchCounts.keys()], ['A']);
  // Re-offers: a better placement replaces B's entry, a worse one is not admitted; both add matches.
  mergeProducts(state, [placement('B', 0.3, 4, 2), placement('B', 0.45, 5, 4), placement('A', 0.55, 6, 1)], 1);
  const counts = Object.fromEntries(state.top.entries.map((entry) => [entry.smiles, conformerMatchesOf(state.matchCounts, entry)]));
  assert.deepEqual(counts, { B: 9, A: 3, C: 1 });
  assert.equal(state.top.bySmiles.get('B').conformerId, 4);
  // After a finished job drops matchCounts, the carried count still answers.
  assert.equal(conformerMatchesOf(null, state.top.bySmiles.get('B')), 9);
  // An evicted untracked product that re-enters counts only from re-admission (a flagged lower bound).
  mergeProducts(state, [placement('D', 0.1, 7, 5)], 1);
  assert.equal(state.top.bySmiles.has('C'), false);
  mergeProducts(state, [placement('C', 0.05, 8, 2)], 1);
  assert.equal(conformerMatchesOf(state.matchCounts, state.top.bySmiles.get('C')), 2);
});

test('refinement failures keep their code with the right status', () => {
  for (const [code, status] of [
    ['REFINEMENT_UNSUPPORTED', 422], ['RECEPTOR_FRAME', 422], ['RECEPTOR_OVERLAP', 422], ['RECEPTOR_TOO_LARGE', 422],
    ['INVALID_REFINEMENT_INPUT', 400], ['REFINEMENT_TIMEOUT', 504],
    ['REFINEMENT_FAILED', 503], ['REFINEMENT_BUSY', 503], ['REFINEMENT_UNAVAILABLE', 503], ['REFINEMENT_ABORTED', 503], ['SOMETHING_NEW', 503], [undefined, 503],
  ]) assert.equal(refinementFailureStatus(code), status, String(code));
});

test('refine route with a stub refiner: status mapping, busy lock, and client abort kills the run and frees the lock', { timeout: 120_000 }, async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'pyxis-linker-refine-'));
  const stubPath = path.join(temporary, 'refine-stub.mjs');
  await writeFile(stubPath, [
    "export async function refinementStatus() { return { available: true, rdkitVersion: 'stub', forceFields: ['MMFF94', 'UFF'] }; }",
    'export function refineProduct(input) { return globalThis.__pyxisRefineStub(input); }',
  ].join('\n'));
  let server;
  try {
    const { indexPath } = buildIndex(temporary, 2);
    let call, poll;
    ({ server, call, poll } = await start(indexPath, { chunkRows: 1 }, { refineModulePath: pathToFileURL(stubPath).href }));
    const created = await call('/jobs', { method: 'POST', body: reference });
    const job = await poll(created.body.job.id, (value) => value.finishedAt);
    assert.equal(job.state, 'completed');
    const route = `/jobs/${job.id}/results/${job.results[0].id}/refine`;
    const ok = { ok: true, forceField: 'MMFF94', sdf: 'stub' };

    for (const [code, status] of [
      ['REFINEMENT_UNSUPPORTED', 422], ['RECEPTOR_FRAME', 422], ['INVALID_REFINEMENT_INPUT', 400], ['REFINEMENT_TIMEOUT', 504],
      ['REFINEMENT_FAILED', 503], ['REFINEMENT_BUSY', 503], ['REFINEMENT_UNAVAILABLE', 503],
    ]) {
      globalThis.__pyxisRefineStub = async () => ({ ok: false, errors: [{ code, message: `stub ${code}` }] });
      const response = await call(route, { method: 'POST', body: {} });
      assert.equal(response.status, status, code);
      assert.equal(response.body.code, code);
      assert.equal(response.body.error, `stub ${code}`);
      assert.equal(response.body.details[0].code, code);
    }
    globalThis.__pyxisRefineStub = async () => ({ ok: false, errors: [] });
    const codeless = await call(route, { method: 'POST', body: {} });
    assert.deepEqual([codeless.status, codeless.body.code], [503, 'REFINEMENT_FAILED']);
    globalThis.__pyxisRefineStub = async () => { throw new Error('boom'); };
    assert.equal((await call(route, { method: 'POST', body: {} })).body.code, 'REFINEMENT_UNAVAILABLE');

    // A caller that disconnects mid-refinement aborts the run; the lock is then free.
    const seen = { entered: false, aborted: false, timeoutMs: null };
    globalThis.__pyxisRefineStub = (input) => new Promise((resolve) => {
      seen.entered = true;
      seen.timeoutMs = input.timeoutMs;
      input.signal.addEventListener('abort', () => { seen.aborted = true; resolve({ ok: false, errors: [{ code: 'REFINEMENT_ABORTED', message: 'aborted' }] }); });
    });
    const controller = new AbortController();
    const url = `http://127.0.0.1:${server.address().port}${route}`;
    const pending = fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Pyxis-Owner': OWNER_A }, body: '{}', signal: controller.signal }).catch((error) => error);
    for (let tries = 0; !seen.entered; tries++) { assert(tries < 200, 'stub never entered'); await sleep(25); }
    assert.equal(seen.timeoutMs, Number(process.env.LINK_FRAGMENTS_REFINE_TIMEOUT_MS) || 90_000);
    // While it runs, a second refinement is refused as busy (503, not 422).
    const busy = await call(route, { method: 'POST', body: {} });
    assert.deepEqual([busy.status, busy.body.code], [503, 'REFINEMENT_BUSY']);
    controller.abort();
    assert.equal((await pending).name, 'AbortError');
    for (let tries = 0; !seen.aborted; tries++) { assert(tries < 200, 'client abort never reached the refiner'); await sleep(25); }
    globalThis.__pyxisRefineStub = async () => ok;
    let after = await call(route, { method: 'POST', body: {} });
    for (let tries = 0; after.body.code === 'REFINEMENT_BUSY'; tries++) {
      assert(tries < 40, 'lock not released');
      await sleep(25);
      after = await call(route, { method: 'POST', body: {} });
    }
    assert.equal(after.status, 200, JSON.stringify(after.body));
    assert.equal(after.body.refinement.ok, true);
    assert.equal((await call(`/jobs/${job.id}`)).body.job.results[0].refined, true);
  } finally {
    delete globalThis.__pyxisRefineStub;
    await stop(server);
    await rm(temporary, { recursive: true, force: true });
  }
});
