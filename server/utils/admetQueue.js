// ADMET job queue, backed by MongoDB.
//
// This replaces server/utils/rabbitMQUtils.js. The broker is gone; the reason is not
// fashion. ADMET has never once run in production: chem_beo has been publishing to
// CloudAMQP since the feature shipped, no consumer has ever connected, and every job any
// user ever queued is still `status: "queued"`. Nobody noticed for months, because
// noticing would have meant watching a broker's queue depth.
//
// A collection fixes exactly that. "How many jobs are stuck?" becomes a find(). The real
// workload is four docking results in three months, so a network broker between two
// processes was solving a problem that does not exist. Decided in docs/BOX-ARCHITECTURE.md
// §5 and confirmed by the owner 2026-07-30.
//
// Nothing here talks to the worker directly. The worker polls `admet_jobs`, claims one
// atomically, and PUTs its result back through /api/simulation/:key/admet — which already
// exists and is already authenticated by requireAdmetCallbackAuth.

export const ADMET_JOBS_COLLECTION = 'admet_jobs';

export const ADMET_JOB_STATUS = Object.freeze({
  QUEUED: 'queued',
  RUNNING: 'running',
  DONE: 'done',
  ERROR: 'error',
});

// A job is retried at most this many times before it is parked in `error` with the reason.
// Never retry forever silently — that is how the RabbitMQ version hid its own failure.
export const ADMET_MAX_ATTEMPTS = 3;

// How many times a user re-opening the ADMET view may resurrect a job that has already
// exhausted its attempts. Bounded for the reason in createAdmetTask: an unbounded revive
// resets the error away on every page load, so a permanently broken job costs GPU time
// forever and never shows up in the queue counts.
export const ADMET_MAX_REVIVALS = 3;

// Backoff before a failed job may be claimed again, indexed by attempt number. Without it
// `fail()` requeues and the worker's very next poll re-claims the same job, so a 20-second
// `systemctl restart` on 83 burns all three attempts — and three full GPU predictions —
// inside one restart window.
export const ADMET_RETRY_BACKOFF_MS = [30_000, 300_000, 900_000];

// A worker touches `heartbeatAt` while it predicts. If one is killed mid-job the row would
// otherwise sit in `running` forever, which is the precise failure this rewrite exists to
// make visible, so it must not be reintroduced in a new costume.
export const ADMET_STALE_AFTER_MS = 15 * 60 * 1000;

const VALID_PRIORITIES = new Set(['low', 'normal', 'high']);

/**
 * Percent-decode a stored SMILES, if that is what it is.
 *
 * ⚠ `simulation_logs.smiles` is stored URL-ENCODED, always. The client sends
 * `encodeURIComponent(_searchSmiles)` (client/src/pages/dashboard/simulation.jsx:689) and
 * the server then *enforces* the encoding on the way in — `server/index.js:3435` re-encodes
 * anything that arrived raw. docs/DOCKING-CONTRACT.md §4 records the stored values.
 *
 * That matters far more than it looks, because RDKit does not reject the encoded form —
 * it misreads it. Measured against this repo's own @rdkit/rdkit:
 *
 *   C%23Cc1ccc(cc1)C%23C                 -> PARSES as CC1CCc2ccc1cc2
 *   c1ccc2c(c1)nc(o2)SCC(%3DO)O          -> parse failure
 *   Cc1c(non1)OCCn2c(ncc2%5BN%2B%5D...)C -> parse failure
 *
 * The first one is the dangerous case: `%23` is read as ring-closure label 23, so
 * para-diethynylbenzene silently becomes a methylated bicyclic hydrocarbon. ADMET-AI would
 * return a complete, confident property set for a molecule the user never asked about, and
 * the dashboard would display it. No error, no log line, wrong science.
 *
 * ── The one ambiguity, and why decoding is still right ──────────────────────────────────
 * `%NN` is also SMILES' own syntax for ring-closure labels above 9, so `%23` is genuinely
 * ambiguous in isolation. It is not ambiguous here: every value reaching this function from
 * a simulation record has been through the re-encode at server/index.js:3435, so a `%23`
 * in storage IS an encoded `#`. A ring closure numbered 23 would also require 23 rings open
 * at once, which does not occur in this domain.
 *
 * The round-trip check below keeps that judgement narrow: a string is only decoded when
 * re-encoding the result reproduces the original exactly. A raw SMILES with no escapes is
 * left alone.
 */
export function decodeStoredSmiles(value) {
  if (typeof value !== 'string' || !value.includes('%')) return value;
  let decoded;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    // A malformed escape (`%` not followed by two hex digits) means this was never encoded.
    return value;
  }
  if (decoded === value) return value;
  return encodeURIComponent(decoded) === value ? decoded : value;
}

/**
 * Normalise whatever the caller passed into a clean array of SMILES.
 *
 * ⚠ This is load-bearing. The old path did
 *   `simulation.smiles.split(',').map(s => `"${s.trim()}"`)`
 * which wrapped every SMILES in literal double-quote CHARACTERS, then
 * rabbitMQUtils wrapped the result in another array, producing `[["\"CCO\""]]` on the
 * wire. That is why services/admet/admet_sender.py grew a regex for `"],["` — it was
 * decoding a bug rather than a format. Both ends are fixed here; the quotes never existed
 * in the data, only in the serialisation.
 *
 * Splitting happens on BOTH `,` and `;`. The client joins multiple ligands with a
 * semicolon — `searchCode.replace(',', ';')` at simulation.jsx:679 — which then survives
 * as `%3B` until the decode above turns it back. A comma-only split would hand the whole
 * multi-ligand string to RDKit as one molecule.
 */
export function normalizeSmiles(input) {
  const collected = [];

  const push = (value) => {
    if (typeof value !== 'string') return;
    // Decode BEFORE splitting: the separator itself may be percent-encoded.
    for (const part of decodeStoredSmiles(value).split(/[,;]/)) {
      const cleaned = part.trim().replace(/^["']+|["']+$/g, '').trim();
      if (cleaned) collected.push(cleaned);
    }
  };

  if (Array.isArray(input)) {
    for (const entry of input) push(entry);
  } else {
    push(input);
  }

  return [...new Set(collected)];
}

function jobsCollection(db) {
  return db.collection(ADMET_JOBS_COLLECTION);
}

/**
 * Create the indexes the queue depends on. Called from the server's startup index pass.
 *
 * The unique index on simulationKey is what makes enqueueing idempotent: the GET route
 * enqueues on every request for a simulation with no ADMET data, so without it a user
 * refreshing the page would queue the same work a dozen times.
 */
export async function ensureAdmetQueueIndexes(db) {
  const jobs = jobsCollection(db);
  await jobs.createIndex({ simulationKey: 1 }, { unique: true, name: 'admet_simulation_key' });
  // Name deliberately versioned: createIndex on an existing NAME with a different key spec
  // raises IndexOptionsConflict, and this whole block is inside a catch that only logs — so
  // a rename is what stops a silent "indexes already exist" from leaving the claim path
  // unindexed. The v1 spec was { status, createdAt }, before availableAt existed.
  await jobs.createIndex(
    { status: 1, availableAt: 1, createdAt: 1 },
    { name: 'admet_claim_v2' },
  );
  await jobs.createIndex({ status: 1, heartbeatAt: 1 }, { name: 'admet_stale' });
  return jobs;
}

/**
 * Enqueue an ADMET prediction, or return the job that already covers it.
 *
 * Re-queues a job that previously failed, because the reason it failed is usually that
 * no worker existed. It does NOT disturb a job that is queued, running, or done.
 */
export async function createAdmetTask(db, taskData) {
  const {
    simulationKey,
    smiles,
    pdbid = null,
    userId = 'system',
    priority = 'normal',
  } = taskData || {};

  if (!simulationKey || typeof simulationKey !== 'string') {
    throw new Error('simulationKey is required for an ADMET task');
  }

  const normalized = normalizeSmiles(smiles);
  if (normalized.length === 0) {
    throw new Error('at least one SMILES is required for an ADMET task');
  }

  const now = new Date();
  const jobs = jobsCollection(db);

  const insertResult = await upsertJob(jobs, simulationKey, {
    simulationKey,
    smiles: normalized,
    pdbid,
    userId,
    priority: VALID_PRIORITIES.has(priority) ? priority : 'normal',
    status: ADMET_JOB_STATUS.QUEUED,
    attempts: 0,
    revivals: 0,
    createdAt: now,
    updatedAt: now,
    availableAt: now,
    startedAt: null,
    finishedAt: null,
    heartbeatAt: null,
    workerId: null,
    error: null,
  });

  const job = insertResult;

  // An existing job in `error` is revived, with its attempt count reset — the overwhelming
  // cause of a failed ADMET job in this system's history is "no worker was running".
  //
  // ⚠ But NOT without limit. The ADMET GET route calls this on every request for a
  // simulation with no result, so an unbounded revive means a deterministically failing job
  // is reset to `queued, attempts: 0, error: null` on every page load: the operator sees
  // `counts.error: 0` while the GPU re-runs the same doomed prediction three more times per
  // click, and the failure never appears anywhere. That is precisely the invisibility this
  // module exists to remove — the same shape as the broker nobody watched, in a new costume.
  //
  // After ADMET_MAX_REVIVALS the job stays parked and keeps its error text.
  if (job && job.status === ADMET_JOB_STATUS.ERROR) {
    if ((job.revivals ?? 0) >= ADMET_MAX_REVIVALS) {
      return describeJob(job, { created: false, revived: false, exhausted: true });
    }
    const revived = await jobs.findOneAndUpdate(
      { simulationKey, status: ADMET_JOB_STATUS.ERROR },
      {
        $set: {
          status: ADMET_JOB_STATUS.QUEUED,
          smiles: normalized,
          attempts: 0,
          error: null,
          updatedAt: now,
          availableAt: now,
          startedAt: null,
          finishedAt: null,
          heartbeatAt: null,
          workerId: null,
        },
        $inc: { revivals: 1 },
      },
      { returnDocument: 'after' },
    );
    const revivedJob = revived?.value ?? revived;
    if (revivedJob) return describeJob(revivedJob, { created: false, revived: true });
  }

  return describeJob(job, { created: job?.attempts === 0 && job?.status === ADMET_JOB_STATUS.QUEUED });
}

/**
 * Clear a job so the prediction runs again from scratch.
 *
 * ⚠ Without this, `DELETE /api/simulation/:key/admet` silently stopped working. The unique
 * index means one job per simulation forever, `$setOnInsert` never touches an existing row,
 * and the revive branch above only fires for `error` — so a `done` job stayed `done`, no
 * worker would ever claim it (claim filters on `queued`), and the GET route reported
 * `processing.status: "queued"` indefinitely. Deleting the result to force a recompute is
 * that route's entire purpose, so it had none.
 */
export async function resetAdmetJob(db, simulationKey) {
  if (!simulationKey || typeof simulationKey !== 'string') return { reset: false };
  const now = new Date();
  const result = await jobsCollection(db).updateOne(
    { simulationKey },
    {
      $set: {
        status: ADMET_JOB_STATUS.QUEUED,
        attempts: 0,
        revivals: 0,
        error: null,
        result: null,
        updatedAt: now,
        availableAt: now,
        startedAt: null,
        finishedAt: null,
        heartbeatAt: null,
        workerId: null,
      },
    },
  );
  return { reset: (result?.modifiedCount ?? 0) > 0 };
}

/**
 * Upsert-or-read, tolerating the duplicate-key error a concurrent upsert can raise.
 *
 * An upsert against a unique index is NOT collision-proof: two requests that both miss the
 * document race to insert it and one gets E11000. That is the normal case here, not an
 * exotic one — the ADMET GET route enqueues on every page load, so two tabs are enough.
 * The losing caller simply reads the winner's document; the outcome it wanted already
 * happened.
 */
async function upsertJob(jobs, simulationKey, insertDocument) {
  try {
    const result = await jobs.findOneAndUpdate(
      { simulationKey },
      { $setOnInsert: insertDocument },
      { upsert: true, returnDocument: 'after' },
    );
    return result?.value ?? result;
  } catch (error) {
    if (error?.code === 11000) {
      return jobs.findOne({ simulationKey });
    }
    throw error;
  }
}

function describeJob(job, flags = {}) {
  return {
    success: true,
    taskId: job?._id ? String(job._id) : null,
    simulationKey: job?.simulationKey ?? null,
    status: job?.status ?? null,
    smiles: job?.smiles ?? [],
    attempts: job?.attempts ?? 0,
    revivals: job?.revivals ?? 0,
    error: job?.error ?? null,
    estimatedProcessingTime: '2-5 minutes',
    message: flags.exhausted
      ? 'ADMET prediction failed repeatedly and will not be retried automatically'
      : flags.revived
        ? 'Previously failed ADMET job re-queued'
        : flags.created
          ? 'ADMET processing task created successfully'
          : 'ADMET processing task already queued',
    ...flags,
  };
}

/**
 * Requeue jobs whose worker died mid-prediction, and park the ones that keep dying.
 *
 * Returns counts rather than throwing, so a status endpoint can call it safely.
 */
export async function reapStaleAdmetJobs(db, { staleAfterMs = ADMET_STALE_AFTER_MS, now = new Date() } = {}) {
  const jobs = jobsCollection(db);
  const cutoff = new Date(now.getTime() - staleAfterMs);

  const stale = await jobs
    .find({
      status: ADMET_JOB_STATUS.RUNNING,
      $or: [{ heartbeatAt: { $lt: cutoff } }, { heartbeatAt: null, startedAt: { $lt: cutoff } }],
    })
    .toArray();

  let requeued = 0;
  let parked = 0;

  for (const job of stale) {
    if ((job.attempts ?? 0) >= ADMET_MAX_ATTEMPTS) {
      await jobs.updateOne(
        { _id: job._id, status: ADMET_JOB_STATUS.RUNNING },
        {
          $set: {
            status: ADMET_JOB_STATUS.ERROR,
            error: `abandoned after ${job.attempts} attempts — worker stopped responding`,
            finishedAt: now,
            updatedAt: now,
          },
        },
      );
      parked += 1;
    } else {
      await jobs.updateOne(
        { _id: job._id, status: ADMET_JOB_STATUS.RUNNING },
        {
          $set: {
            status: ADMET_JOB_STATUS.QUEUED,
            workerId: null,
            heartbeatAt: null,
            updatedAt: now,
            // Same backoff a normal failure gets. A worker that died mid-job will usually
            // die again immediately; re-claiming instantly just spends the attempts.
            availableAt: new Date(
              now.getTime() +
                (ADMET_RETRY_BACKOFF_MS[Math.min(job.attempts ?? 0, ADMET_RETRY_BACKOFF_MS.length - 1)] ?? 0),
            ),
          },
        },
      );
      requeued += 1;
    }
  }

  return { requeued, parked, examined: stale.length };
}

/**
 * What the admin status endpoint reports. Every number here is a count the broker could
 * not give without a management API, which is the whole argument for the change.
 */
export async function getQueueStatus(db) {
  const jobs = jobsCollection(db);
  const now = new Date();

  const grouped = await jobs
    .aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }])
    .toArray();

  const counts = { queued: 0, running: 0, done: 0, error: 0 };
  for (const row of grouped) {
    if (row._id in counts) counts[row._id] = row.count;
  }

  const oldestQueued = await jobs
    .find({ status: ADMET_JOB_STATUS.QUEUED }, { projection: { createdAt: 1 } })
    .sort({ createdAt: 1 })
    .limit(1)
    .toArray();

  const staleRunning = await jobs.countDocuments({
    status: ADMET_JOB_STATUS.RUNNING,
    $or: [
      { heartbeatAt: { $lt: new Date(now.getTime() - ADMET_STALE_AFTER_MS) } },
      { heartbeatAt: null, startedAt: { $lt: new Date(now.getTime() - ADMET_STALE_AFTER_MS) } },
    ],
  });

  return {
    transport: 'mongodb',
    collection: ADMET_JOBS_COLLECTION,
    counts,
    total: counts.queued + counts.running + counts.done + counts.error,
    staleRunning,
    oldestQueuedAt: oldestQueued[0]?.createdAt ?? null,
    timestamp: now.toISOString(),
  };
}

/**
 * Health is "can this process read and write the job collection", not "is a broker up".
 */
export async function admetQueueHealthCheck(db) {
  const timestamp = new Date().toISOString();
  try {
    await jobsCollection(db).findOne({}, { projection: { _id: 1 } });
    return { status: 'healthy', transport: 'mongodb', connected: true, timestamp };
  } catch (error) {
    return {
      status: 'unhealthy',
      transport: 'mongodb',
      connected: false,
      error: error.message,
      timestamp,
    };
  }
}
