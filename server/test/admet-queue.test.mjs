// ADMET job queue regression suite.
//
// ADMET has never run in production (still true on 84 pyxis-web, 2026-08-23):
// chem_beo published to CloudAMQP, nothing ever
// consumed, and every job any user queued is still `queued`. The transport is a Mongo
// collection now (docs/BOX-ARCHITECTURE.md §5), and these tests pin the properties that
// make the failure visible instead of silent.
//
// Runs against a real in-memory MongoDB, not a double — the whole point of the design is
// the atomicity of findOneAndUpdate and the unique index, and neither survives being faked.
//
// Run: SERVER_RUNTIME=bun bun test/admet-queue.test.mjs

import assert from 'node:assert/strict';
import { MongoClient } from 'mongodb';
import { MongoMemoryServer } from 'mongodb-memory-server';

import {
  ADMET_JOBS_COLLECTION,
  ADMET_MAX_ATTEMPTS,
  ADMET_MAX_REVIVALS,
  ADMET_STALE_AFTER_MS,
  createAdmetTask,
  decodeStoredSmiles,
  ensureAdmetQueueIndexes,
  getQueueStatus,
  normalizeSmiles,
  reapStaleAdmetJobs,
  resetAdmetJob,
} from '../utils/admetQueue.js';

let passed = 0;
const failures = [];

async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failures.push({ name, error });
    console.error(`  ✗ ${name}\n    ${error.message}`);
  }
}

const mongod = await MongoMemoryServer.create();
const client = new MongoClient(mongod.getUri());
await client.connect();
const db = client.db('admet_queue_test');
const jobs = db.collection(ADMET_JOBS_COLLECTION);

await ensureAdmetQueueIndexes(db);

async function reset() {
  await jobs.deleteMany({});
}

console.log('ADMET queue');

// ── normalizeSmiles: the quoting bug ────────────────────────────────────────

await test('strips the literal quote characters the old producer added', () => {
  // `.map(s => `"${s.trim()}"`)` put real `"` characters into the data, and the worker
  // grew a regex to undo it. The quotes were never part of any SMILES.
  assert.deepEqual(normalizeSmiles(['"CCO"', '"CCN"']), ['CCO', 'CCN']);
});

await test('splits a comma-separated string the way the simulation record stores it', () => {
  assert.deepEqual(normalizeSmiles('CCO, CCN ,CCC'), ['CCO', 'CCN', 'CCC']);
});

await test('flattens and de-duplicates', () => {
  assert.deepEqual(normalizeSmiles(['CCO,CCN', ' CCO ']), ['CCO', 'CCN']);
});

await test('drops empties rather than queueing a blank molecule', () => {
  assert.deepEqual(normalizeSmiles(['', '  ', '""']), []);
});

// ── the percent-encoding, which is the one that produces wrong science ───────

await test('decodes the URL-encoded form every production SMILES is stored in', () => {
  // client sends encodeURIComponent(...) (simulation.jsx:689) and server/index.js:3435
  // re-encodes anything that arrived raw, so storage is ALWAYS encoded.
  // Values below are the ones docs/DOCKING-CONTRACT.md §4 recorded from production.
  assert.deepEqual(normalizeSmiles('C%23Cc1ccc(cc1)C%23C'), ['C#Cc1ccc(cc1)C#C']);
  assert.deepEqual(normalizeSmiles('c1ccc2c(c1)nc(o2)SCC(%3DO)O'), ['c1ccc2c(c1)nc(o2)SCC(=O)O']);
  assert.deepEqual(
    normalizeSmiles('Cc1c(non1)OCCn2c(ncc2%5BN%2B%5D(%3DO)%5BO-%5D)C'),
    ['Cc1c(non1)OCCn2c(ncc2[N+](=O)[O-])C'],
  );
});

await test('C%23C… must not survive as a parseable but WRONG molecule', () => {
  // RDKit does not reject the encoded form — it misreads `%23` as ring-closure 23, so
  // para-diethynylbenzene parses cleanly as CC1CCc2ccc1cc2 and ADMET returns a confident
  // property set for a molecule nobody asked about. Measured with this repo's own RDKit.
  const [decoded] = normalizeSmiles('C%23Cc1ccc(cc1)C%23C');
  assert.equal(decoded, 'C#Cc1ccc(cc1)C#C');
  assert.ok(!decoded.includes('%'), 'no percent escape may reach RDKit');
});

await test('a raw SMILES is left alone', () => {
  assert.deepEqual(normalizeSmiles('C#Cc1ccc(cc1)C#C'), ['C#Cc1ccc(cc1)C#C']);
  assert.deepEqual(normalizeSmiles('CC(=O)Oc1ccccc1C(=O)O'), ['CC(=O)Oc1ccccc1C(=O)O']);
});

await test('a raw SMILES using %NN ring closures is NOT decoded', () => {
  // The first version of this decoder only round-trip-checked, and `%NN` ring closures
  // round-trip perfectly. Verified against this repo's @rdkit/rdkit: C%10CCCCC%10 is valid
  // (canonically C1CCCCC1) and decoding turned it into a control character — parse failure —
  // while C%20CCCCC%20 decoded to "C CCCCC " and parsed as plain "C". That second one is the
  // original bug wearing the other face: a silently different molecule.
  for (const raw of ['C%10CCCCC%10', 'C%11CCCCC%11', 'C%20CCCCC%20', 'C%25CCCCC%25', 'C%99CCCCC%99']) {
    assert.deepEqual(normalizeSmiles(raw), [raw], `${raw} must survive untouched`);
  }
});

await test('the decoded result must be entirely SMILES-legal', () => {
  // The plausibility check, stated directly: a decode that yields a space, a control
  // character or a surviving bare `%` consumed a ring closure, not an escape.
  assert.equal(decodeStoredSmiles('C%20C'), 'C%20C');
  assert.equal(decodeStoredSmiles('C%25C'), 'C%25C');
  assert.equal(decodeStoredSmiles('C%23C'), 'C#C');
});

await test('a malformed escape is not mangled', () => {
  // decodeURIComponent throws on this; the value must pass through untouched rather than
  // taking down the enqueue.
  assert.equal(decodeStoredSmiles('C%ZZC'), 'C%ZZC');
  assert.deepEqual(normalizeSmiles('C%ZZC'), ['C%ZZC']);
});

await test('splits on the semicolon the client joins multiple ligands with', () => {
  // simulation.jsx:679 does searchCode.replace(',', ';'), which encodeURIComponent then
  // turns into %3B. A comma-only split hands the whole multi-ligand string to RDKit as one
  // molecule.
  assert.deepEqual(normalizeSmiles('CCO%3BCCN'), ['CCO', 'CCN']);
  assert.deepEqual(normalizeSmiles('CCO;CCN'), ['CCO', 'CCN']);
});

// ── enqueueing ──────────────────────────────────────────────────────────────

await test('enqueues a job in queued state', async () => {
  await reset();
  const result = await createAdmetTask(db, {
    simulationKey: 'sim-a',
    smiles: 'CCO',
    userId: 'researcher',
    companyId: 'company-a',
  });
  assert.equal(result.status, 'queued');

  const stored = await jobs.findOne({ simulationKey: 'sim-a' });
  assert.deepEqual(stored.smiles, ['CCO']);
  assert.equal(stored.userId, 'researcher');
  assert.equal(stored.companyId, 'company-a');
  assert.equal(stored.attempts, 0);
  assert.equal(stored.error, null);
});

await test('enqueueing the same simulation twice does not create two jobs', async () => {
  // The ADMET GET route enqueues on every request for a simulation without results, so a
  // user refreshing the page would otherwise queue the same work a dozen times.
  await reset();
  await createAdmetTask(db, { simulationKey: 'sim-b', smiles: 'CCO' });
  await createAdmetTask(db, { simulationKey: 'sim-b', smiles: 'CCO' });
  assert.equal(await jobs.countDocuments({ simulationKey: 'sim-b' }), 1);
});

await test('concurrent enqueues of the same simulation still produce one job', async () => {
  await reset();
  await Promise.all(
    Array.from({ length: 8 }, () => createAdmetTask(db, { simulationKey: 'sim-race', smiles: 'CCO' })),
  );
  assert.equal(await jobs.countDocuments({ simulationKey: 'sim-race' }), 1);
});

await test('a job that is already running is not disturbed', async () => {
  await reset();
  await createAdmetTask(db, { simulationKey: 'sim-c', smiles: 'CCO' });
  await jobs.updateOne({ simulationKey: 'sim-c' }, { $set: { status: 'running', attempts: 1 } });

  await createAdmetTask(db, { simulationKey: 'sim-c', smiles: 'CCO' });

  const stored = await jobs.findOne({ simulationKey: 'sim-c' });
  assert.equal(stored.status, 'running');
  assert.equal(stored.attempts, 1);
});

await test('a job parked in error is revived with its attempts reset', async () => {
  // The overwhelming cause of a failed ADMET job in this system's history is "no worker
  // was running", so a user asking again should get another go.
  await reset();
  await createAdmetTask(db, { simulationKey: 'sim-d', smiles: 'CCO' });
  await jobs.updateOne(
    { simulationKey: 'sim-d' },
    { $set: { status: 'error', attempts: ADMET_MAX_ATTEMPTS, error: 'no worker' } },
  );

  const result = await createAdmetTask(db, { simulationKey: 'sim-d', smiles: 'CCO' });
  assert.equal(result.revived, true);

  const stored = await jobs.findOne({ simulationKey: 'sim-d' });
  assert.equal(stored.status, 'queued');
  assert.equal(stored.attempts, 0);
  assert.equal(stored.error, null);
});

await test('reviving an error job is capped, so a broken job stops costing GPU time', async () => {
  // The GET route calls createAdmetTask on every request with no result, so an unbounded
  // revive resets `error` away on every page load: the operator sees counts.error 0 while
  // the same doomed prediction is re-run three more times per click. That is the same
  // invisibility as the broker nobody watched.
  await reset();
  await createAdmetTask(db, { simulationKey: 'sim-rev', smiles: 'CCO' });

  for (let i = 0; i < ADMET_MAX_REVIVALS; i += 1) {
    await jobs.updateOne(
      { simulationKey: 'sim-rev' },
      { $set: { status: 'error', attempts: ADMET_MAX_ATTEMPTS, error: 'callback 401' } },
    );
    const result = await createAdmetTask(db, { simulationKey: 'sim-rev', smiles: 'CCO' });
    assert.equal(result.revived, true, `revival ${i + 1} should be allowed`);
  }

  await jobs.updateOne(
    { simulationKey: 'sim-rev' },
    { $set: { status: 'error', attempts: ADMET_MAX_ATTEMPTS, error: 'callback 401' } },
  );
  const exhausted = await createAdmetTask(db, { simulationKey: 'sim-rev', smiles: 'CCO' });

  assert.equal(exhausted.revived, false);
  assert.equal(exhausted.exhausted, true);
  assert.equal(exhausted.status, 'error');
  assert.equal(exhausted.error, 'callback 401', 'the failure text must survive');

  const stored = await jobs.findOne({ simulationKey: 'sim-rev' });
  assert.equal(stored.status, 'error', 'and it must STAY parked');
});

await test('a permanently failing job stays visible in the queue counts', async () => {
  const status = await getQueueStatus(db);
  assert.equal(status.counts.error, 1);
});

await test('deleting the result re-queues the job so a recompute actually happens', async () => {
  // One job per simulation forever (unique index), $setOnInsert never touches an existing
  // row, and the revive branch only fires for `error` — so without resetAdmetJob a `done`
  // job stayed done, no worker could claim it, and the GET reported "queued" forever.
  await reset();
  await createAdmetTask(db, { simulationKey: 'sim-del', smiles: 'CCO' });
  await jobs.updateOne(
    { simulationKey: 'sim-del' },
    { $set: { status: 'done', result: { engine: 'stub' }, finishedAt: new Date() } },
  );

  // Re-enqueueing alone does nothing — this is the bug, asserted so it cannot come back.
  const untouched = await createAdmetTask(db, { simulationKey: 'sim-del', smiles: 'CCO' });
  assert.equal(untouched.status, 'done');

  const { reset: didReset } = await resetAdmetJob(db, 'sim-del');
  assert.equal(didReset, true);

  const stored = await jobs.findOne({ simulationKey: 'sim-del' });
  assert.equal(stored.status, 'queued');
  assert.equal(stored.attempts, 0);
  assert.equal(stored.revivals, 0);
  assert.equal(stored.result, null);
  assert.ok(stored.availableAt <= new Date(), 'and claimable immediately, not after a backoff');
});

await test('a RUNNING job is never reset out from under its worker', async () => {
  // Clearing workerId/startedAt mid-prediction lets the worker finish and write its now
  // stale result over the fresh state — silently undoing the very reset that was requested.
  await reset();
  await createAdmetTask(db, { simulationKey: 'sim-run', smiles: 'CCO' });
  await jobs.updateOne(
    { simulationKey: 'sim-run' },
    { $set: { status: 'running', workerId: 'box:1', heartbeatAt: new Date(), attempts: 1 } },
  );

  const { reset: didReset } = await resetAdmetJob(db, 'sim-run');
  assert.equal(didReset, false);

  const stored = await jobs.findOne({ simulationKey: 'sim-run' });
  assert.equal(stored.status, 'running');
  assert.equal(stored.workerId, 'box:1');
});

await test('a new job is claimable at once', async () => {
  await reset();
  await createAdmetTask(db, { simulationKey: 'sim-now', smiles: 'CCO' });
  const stored = await jobs.findOne({ simulationKey: 'sim-now' });
  assert.ok(stored.availableAt instanceof Date);
  assert.ok(stored.availableAt <= new Date());
});

await test('a reaped job serves a backoff instead of being re-claimed instantly', async () => {
  await reset();
  await createAdmetTask(db, { simulationKey: 'sim-backoff', smiles: 'CCO' });
  await jobs.updateOne(
    { simulationKey: 'sim-backoff' },
    {
      $set: {
        status: 'running',
        attempts: 1,
        heartbeatAt: new Date(Date.now() - ADMET_STALE_AFTER_MS - 60_000),
      },
    },
  );

  await reapStaleAdmetJobs(db);
  const stored = await jobs.findOne({ simulationKey: 'sim-backoff' });
  assert.equal(stored.status, 'queued');
  assert.ok(stored.availableAt > new Date(), 'must not be immediately claimable');
});

await test('a job with no usable SMILES is refused rather than queued', async () => {
  await reset();
  await assert.rejects(
    () => createAdmetTask(db, { simulationKey: 'sim-e', smiles: '  ,  ' }),
    /at least one SMILES/,
  );
  assert.equal(await jobs.countDocuments({}), 0);
});

await test('a missing simulationKey is refused', async () => {
  await reset();
  await assert.rejects(() => createAdmetTask(db, { smiles: 'CCO' }), /simulationKey/);
});

// ── reaping ─────────────────────────────────────────────────────────────────

await test('a job abandoned by a dead worker is returned to the queue', async () => {
  await reset();
  await createAdmetTask(db, { simulationKey: 'sim-f', smiles: 'CCO' });
  await jobs.updateOne(
    { simulationKey: 'sim-f' },
    {
      $set: {
        status: 'running',
        attempts: 1,
        heartbeatAt: new Date(Date.now() - ADMET_STALE_AFTER_MS - 60_000),
      },
    },
  );

  const reaped = await reapStaleAdmetJobs(db);
  assert.equal(reaped.requeued, 1);
  assert.equal((await jobs.findOne({ simulationKey: 'sim-f' })).status, 'queued');
});

await test('a job that keeps being abandoned is parked, not requeued forever', async () => {
  await reset();
  await createAdmetTask(db, { simulationKey: 'sim-g', smiles: 'CCO' });
  await jobs.updateOne(
    { simulationKey: 'sim-g' },
    {
      $set: {
        status: 'running',
        attempts: ADMET_MAX_ATTEMPTS,
        heartbeatAt: new Date(Date.now() - ADMET_STALE_AFTER_MS - 60_000),
      },
    },
  );

  const reaped = await reapStaleAdmetJobs(db);
  assert.equal(reaped.parked, 1);

  const stored = await jobs.findOne({ simulationKey: 'sim-g' });
  assert.equal(stored.status, 'error');
  assert.match(stored.error, /abandoned/);
});

await test('a healthy running job is left alone', async () => {
  await reset();
  await createAdmetTask(db, { simulationKey: 'sim-h', smiles: 'CCO' });
  await jobs.updateOne(
    { simulationKey: 'sim-h' },
    { $set: { status: 'running', attempts: 1, heartbeatAt: new Date() } },
  );

  const reaped = await reapStaleAdmetJobs(db);
  assert.equal(reaped.requeued, 0);
  assert.equal(reaped.parked, 0);
  assert.equal((await jobs.findOne({ simulationKey: 'sim-h' })).status, 'running');
});

await test('an old QUEUED job is never mistaken for an abandoned one', async () => {
  await reset();
  await createAdmetTask(db, { simulationKey: 'sim-i', smiles: 'CCO' });
  await jobs.updateOne(
    { simulationKey: 'sim-i' },
    { $set: { createdAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } },
  );

  const reaped = await reapStaleAdmetJobs(db);
  assert.equal(reaped.examined, 0);
  assert.equal((await jobs.findOne({ simulationKey: 'sim-i' })).status, 'queued');
});

// ── status ──────────────────────────────────────────────────────────────────

await test('queue status counts every state — the question the broker could not answer', async () => {
  await reset();
  await createAdmetTask(db, { simulationKey: 'q1', smiles: 'CCO' });
  await createAdmetTask(db, { simulationKey: 'q2', smiles: 'CCN' });
  await createAdmetTask(db, { simulationKey: 'q3', smiles: 'CCC' });
  await jobs.updateOne({ simulationKey: 'q2' }, { $set: { status: 'running', heartbeatAt: new Date() } });
  await jobs.updateOne({ simulationKey: 'q3' }, { $set: { status: 'done' } });

  const status = await getQueueStatus(db);
  assert.equal(status.transport, 'mongodb');
  assert.equal(status.counts.queued, 1);
  assert.equal(status.counts.running, 1);
  assert.equal(status.counts.done, 1);
  assert.equal(status.total, 3);
  assert.ok(status.oldestQueuedAt instanceof Date);
});

await test('queue status reports how many running jobs have gone quiet', async () => {
  await reset();
  await createAdmetTask(db, { simulationKey: 'q4', smiles: 'CCO' });
  await jobs.updateOne(
    { simulationKey: 'q4' },
    {
      $set: {
        status: 'running',
        heartbeatAt: new Date(Date.now() - ADMET_STALE_AFTER_MS - 60_000),
      },
    },
  );

  const status = await getQueueStatus(db);
  assert.equal(status.staleRunning, 1);
});

await client.close();
await mongod.stop();

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) process.exit(1);
