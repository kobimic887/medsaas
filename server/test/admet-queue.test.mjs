// ADMET job queue regression suite.
//
// ADMET has never run in production: chem_beo published to CloudAMQP, nothing ever
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
  ADMET_STALE_AFTER_MS,
  createAdmetTask,
  ensureAdmetQueueIndexes,
  getQueueStatus,
  normalizeSmiles,
  reapStaleAdmetJobs,
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

// ── enqueueing ──────────────────────────────────────────────────────────────

await test('enqueues a job in queued state', async () => {
  await reset();
  const result = await createAdmetTask(db, { simulationKey: 'sim-a', smiles: 'CCO' });
  assert.equal(result.status, 'queued');

  const stored = await jobs.findOne({ simulationKey: 'sim-a' });
  assert.deepEqual(stored.smiles, ['CCO']);
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
