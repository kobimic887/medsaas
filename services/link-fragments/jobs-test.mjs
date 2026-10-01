import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, stat, symlink, link } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Database } from 'bun:sqlite';
import { createJobManager } from './jobs.mjs';
import { createJobStore } from './job-store.mjs';
import { prepareQuery } from './engine.mjs';

const query = await readFile(new URL('fixtures/query.sdf', import.meta.url), 'utf8');
const input = { sdf: query, attachments: [1, 1], maxRmsd: 0.75, limit: 10 };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function fixture(directory, copies = 1) {
  const archive = join(directory, 'library.zip'), indexPath = join(directory, 'linkers.sqlite');
  execFileSync('python3', ['-c', 'import sys,zipfile,pathlib; s=pathlib.Path(sys.argv[1]).read_text(); z=zipfile.ZipFile(sys.argv[2],"w",zipfile.ZIP_DEFLATED); z.writestr("linker-conformers.sdf",s*int(sys.argv[3])); z.close()', fileURLToPath(new URL('fixtures/linker.sdf', import.meta.url)), archive, String(copies)]);
  execFileSync('python3', [fileURLToPath(new URL('build.py', import.meta.url)), '--input', archive, '--out', indexPath, '--expected-rows', String(copies)]);
  return indexPath;
}
async function until(manager, owner, id, condition) {
  const end = Date.now() + 15_000;
  for (;;) {
    const job = manager.get(owner, id);
    if (condition(job)) return job;
    assert(Date.now() < end, `Timeout waiting for job: ${JSON.stringify(job)}`);
    await sleep(20);
  }
}

test('durable full search retains input, owner isolation, result provenance and refinement after restart', { timeout: 30_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'linker-history-'));
  let manager, db;
  try {
    const indexPath = fixture(directory);
    db = new Database(indexPath, { readonly: true });
    const prepared = await prepareQuery(query, input.attachments);
    assert.throws(() => createJobManager({ indexPath, db, storePath: indexPath }), /separate/);
    db.close();
    const symlinkPath = join(directory, 'alias.sqlite'), hardlinkPath = join(directory, 'hard-alias.sqlite');
    await symlink(indexPath, symlinkPath); await link(indexPath, hardlinkPath);
    assert.throws(() => createJobManager({ indexPath, db, storePath: symlinkPath }), /separate/);
    assert.throws(() => createJobManager({ indexPath, db, storePath: hardlinkPath }), /separate/);
    await rm(hardlinkPath); await rm(symlinkPath);
    db = new Database(indexPath, { readonly: true });
    assert.equal(db.query("SELECT name FROM sqlite_master WHERE name='jobs'").get(), null);
    manager = createJobManager({ indexPath, db, workers: 1, storeOptions: { maxJobBytes: 64 * 1024 } });
    const id = manager.submit('owner-A', input, prepared).id;
    const completed = await until(manager, 'owner-A', id, (job) => job.finishedAt);
    assert.equal(completed.complete, true);
    const resultId = completed.results[0].id;
    const source = manager.findResult('owner-A', id, resultId).entry.detail.sdf;
    const refinement = { ok: true, sdf: source, report: { forceField: 'MMFF94', converged: true, energyUnits: 'kcal/mol' } };
    assert.equal(manager.recordRefinement('owner-B', id, resultId, refinement), false);
    assert.equal(manager.recordRefinement('owner-A', id, resultId, { ok: false }), false);
    assert.equal(manager.recordRefinement('owner-A', id, resultId, refinement, { forceField: 'auto', receptorPdb: 'saved receptor' }), true);
    for (let i = 0; i < 10; i++) {
      manager.recordRefinement('owner-A', id, resultId, refinement, { receptorPdb: `replacement receptor ${i}` });
      assert.equal(Object.keys(manager.findResult('owner-A', id, resultId).job.refinementReceptors).length, 1, 'superseded receptor is released from memory');
    }
    manager.recordRefinement('owner-A', id, resultId, refinement, { forceField: 'auto', receptorPdb: 'saved receptor' });
    assert.throws(() => manager.recordRefinement('owner-A', id, resultId, refinement, { receptorPdb: 'x'.repeat(64 * 1024) }), /could not save/);
    const rolledBack = manager.findResult('owner-A', id, resultId);
    assert.equal(Object.keys(rolledBack.job.refinementReceptors).length, 1);
    assert.equal(manager.resultDetail(rolledBack.job, rolledBack.entry, rolledBack.index).refinementInput.receptorPdb, 'saved receptor');
    await manager.close();
    manager = createJobManager({ indexPath, db, workers: 1 });
    const restored = manager.get('owner-A', id);
    assert.equal(restored.complete, true);
    assert.deepEqual(restored.input, input);
    const compact = manager.get('owner-A', id, { includeInput: false });
    assert.equal(compact.input, undefined);
    assert.deepEqual(compact.results, restored.results);
    assert.equal(manager.get('owner-B', id, { includeInput: false }), null);
    assert.equal(restored.results[0].refined, true);
    const found = manager.findResult('owner-A', id, resultId);
    const detail = manager.resultDetail(found.job, found.entry, found.index);
    assert.equal(detail.sdf, source);
    assert.deepEqual(detail.refinement, refinement);
    assert.equal(detail.refinementInput.receptorPdb, 'saved receptor');
    assert.equal(manager.get('owner-B', id), null);
    assert.equal(manager.findResult('owner-B', id, resultId), null);
    assert.deepEqual(manager.list('owner-B'), []);
    assert.equal(manager.list('owner-A')[0].input, undefined);
    assert.equal(manager.list('owner-A')[0].results, undefined);
    assert.equal((await stat(join(directory, 'jobs.sqlite'))).mode & 0o777, 0o600);
  } finally { await manager?.close(); db?.close(); await rm(directory, { recursive: true, force: true }); }
});

test('shutdown saves running and queued searches as failed partial history, never complete', { timeout: 30_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'linker-history-partial-'));
  let manager, db;
  try {
    const indexPath = fixture(directory, 12);
    db = new Database(indexPath, { readonly: true });
    const prepared = await prepareQuery(query, input.attachments);
    manager = createJobManager({ indexPath, db, workers: 1, chunkRows: 1, flushMs: 5, checkpointMs: 1, testHooks: { conformerDelayMs: 80 } });
    const running = manager.submit('owner-A', input, prepared).id;
    const queued = manager.submit('owner-B', input, prepared).id;
    await until(manager, 'owner-A', running, (job) => job.progress.examinedPairs > 0 && job.results.length > 0);
    await manager.close();
    manager = createJobManager({ indexPath, db, workers: 1 });
    for (const [owner, id] of [['owner-A', running], ['owner-B', queued]]) {
      const restored = manager.get(owner, id);
      assert.equal(restored.state, 'failed');
      assert.equal(restored.error.code, 'LINK_FRAGMENTS_INTERRUPTED');
      assert.equal(restored.partial, true);
      assert.equal(restored.complete, false);
      assert.equal(restored.input.sdf, query);
    }
    assert(manager.get('owner-A', running).results.length > 0);
    assert(manager.get('owner-A', running).progress.examinedPairs < 12);
    assert.equal(manager.stats().queued, 0);
    assert.equal(manager.stats().running, 0);
    // Also exercise an abrupt process-loss checkpoint, rather than only clean shutdown.
    await manager.close(); manager = null;
    const store = createJobStore(join(directory, 'jobs.sqlite'));
    const interrupted = store.load().find((job) => job.id === running);
    interrupted.state = 'running'; interrupted.finishedAt = null; interrupted.finishedMs = 0; interrupted.error = null;
    store.save(interrupted); store.close();
    manager = createJobManager({ indexPath, db, workers: 1 });
    assert.equal(manager.get('owner-A', running).error.code, 'LINK_FRAGMENTS_INTERRUPTED');
    assert.equal(manager.get('owner-A', running).complete, false);
  } finally { await manager?.close(); db?.close(); await rm(directory, { recursive: true, force: true }); }
});

test('history retention and byte budgets remove old terminal jobs but never active jobs', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'linker-history-bounds-'));
  const store = createJobStore(join(directory, 'jobs.sqlite'), { maxBytes: 1400, maxJobBytes: 900 });
  try {
    const value = (id, finishedMs, owner = 'A') => ({ id, owner, state: finishedMs ? 'completed' : 'running', finishedMs, text: 'x'.repeat(400) });
    store.save(value('old', 1)); store.save(value('new', 2));
    assert.deepEqual(store.save(value('active', 0)), ['old']);
    assert.deepEqual(store.load().map((job) => job.id).sort(), ['active', 'new']);
    assert.throws(() => store.save({ ...value('oversized', 0), text: 'x'.repeat(1000) }), /per-job/);
    assert.deepEqual(store.prune({ now: 100, ttlMs: 50, retainPerOwner: 30, retainTotal: 200 }), ['new']);
    assert.deepEqual(store.load().map((job) => job.id), ['active']);
    assert.throws(() => { store.save(value('active2', 0)); store.save(value('active3', 0)); }, /Active linker jobs/);
    assert.equal(store.load().some((job) => job.id === 'active3'), false, 'failed transaction rolls back new row');
  } finally { store.close(); await rm(directory, { recursive: true, force: true }); }
});
