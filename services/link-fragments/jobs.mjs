// Background full-scan coordinator (scientific host main thread). One job scans
// at a time; worker threads examine EVERY indexed (conformer, label pair) row in
// the provably safe anchor-distance window, in rowid (= conformer) order. There is
// no candidate cap, distance ranking or geometric pre-exclusion here: a scan is
// `completed` only when examinedPairs === totalPairs (the index count).
import { Worker } from 'node:worker_threads';
import { randomUUID } from 'node:crypto';
import * as engine from './engine.mjs';

const HOUR = 3600_000;
const INDEX_BOND = 1.5; // build.py indexes nominal 1.5 A anchors
const bondLengths = { C: 1.5, N: 1.45, O: 1.4, S: 1.8, P: 1.8 };
/**
 * Retention threshold shared with workers through an Int32 SharedArrayBuffer:
 * NO_THRESHOLD while fewer than `limit` distinct products are retained, then
 * ceil(K-th retained rmsd x 1e9). It only ever decreases (the K-th entry only
 * improves), so a stale read is looser and defers fewer placements.
 */
export const NO_THRESHOLD = 0x7fffffff;
export const encodeThreshold = (rmsd) => Math.min(NO_THRESHOLD, Math.ceil(rmsd * 1e9));
/**
 * Worker side: fitAndJoin's deferAbove for a raw threshold. (raw + 1) / 1e9
 * exceeds the retained K-th rmsd w strictly even after float rounding (raw >=
 * w x 1e9 up to 1 ulp; the +1 ns margin dwarfs it), so a deferred placement
 * (rmsd > deferAbove) is strictly worse in rmsd than w and can never be
 * admitted by TopProducts, now or later. Ties with w are always materialized.
 */
export const deferAboveOf = (raw) => (raw >= NO_THRESHOLD ? Infinity : (raw + 1) / 1e9);
const envInt = (name, fallback, min, max) => {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value >= min && value <= max ? value : fallback;
};

/** Used only when engine.candidateDistanceWindow is absent. Triangle inequality:
 * |d_elem - d_1.5| <= |l_a-1.5| + |l_b-1.5| and acceptance needs |d_elem - d_q|/2 <= maxRmsd. */
export function fallbackDistanceWindow(prepared, maxRmsd) {
  const deviation = prepared.attachments.reduce((sum, attachment) => {
    const length = bondLengths[attachment.element];
    if (!Number.isFinite(length)) throw new Error(`No proven anchor-distance bound for ${attachment.element}.`);
    return sum + Math.abs(length - INDEX_BOND);
  }, 0);
  const margin = 2 * maxRmsd + deviation + 1e-6;
  return { lo: Math.max(0, prepared.distance - margin), hi: prepared.distance + margin, margin };
}
export const distanceWindow = (prepared, maxRmsd) =>
  (typeof engine.candidateDistanceWindow === 'function' ? engine.candidateDistanceWindow : fallbackDistanceWindow)(prepared, maxRmsd);

// Ranking: rmsd asc, minimum nonbonded radius ratio desc (null = no contacts),
// conformer asc, then label pair for a total, deterministic order.
const ratioKey = (value) => (Number.isFinite(value) ? value : Infinity);
export function comparePlacements(x, y) {
  return x.rmsd - y.rmsd || ratioKey(y.ratio) - ratioKey(x.ratio) || x.conformerId - y.conformerId ||
    x.pair[0] - y.pair[0] || x.pair[1] - y.pair[1];
}
export const resultId = (placement) => `${placement.conformerId}-${placement.pair[0]}-${placement.pair[1]}`;

/** Top-K distinct products (by stereo SMILES), best placement each; at most K+1 transiently.
 * Eviction proof: an evicted SMILES ranked behind K retained products; retained keys
 * only improve, so it can re-enter only with a placement better than the current
 * K-th, i.e. better than any placement it had when evicted. */
export class TopProducts {
  constructor(limit) { this.limit = limit; this.entries = []; this.bySmiles = new Map(); }
  get size() { return this.entries.length; }
  worst() { return this.entries[this.entries.length - 1]; }
  admits(placement) {
    const existing = this.bySmiles.get(placement.smiles);
    if (existing) return comparePlacements(placement, existing) < 0;
    return this.entries.length < this.limit || comparePlacements(placement, this.worst()) < 0;
  }
  /** Returns true if the placement changed the retained set. Placement must carry detail when admitted. */
  offer(placement) {
    if (!this.admits(placement)) return false;
    if (!placement.detail) throw new Error('Admitted placement arrived without detail.');
    const entry = { ...placement, id: resultId(placement), refinement: null };
    const existing = this.bySmiles.get(placement.smiles);
    if (existing) this.entries.splice(this.entries.indexOf(existing), 1);
    this.entries.push(entry);
    this.bySmiles.set(entry.smiles, entry);
    this.entries.sort(comparePlacements);
    if (this.entries.length > this.limit) this.bySmiles.delete(this.entries.pop().smiles);
    return true;
  }
}

/**
 * Folds one worker flush's products into a job's {top, matchCounts, matchCountsExact}.
 * matchCounts tracks at most `matchCountLimit` distinct SMILES (memory bound); past the
 * cap a new SMILES is untracked and the counts become lower bounds. Every retained
 * entry also carries `seenConformers`, summed across re-offers (a replacement entry
 * inherits it), so a product first seen after the cap still reports its matches.
 * Returns true if the retained set changed.
 */
export function mergeProducts(state, products, matchCountLimit) {
  let changed = false;
  for (const product of products) {
    if (state.matchCounts.has(product.smiles) || state.matchCounts.size < matchCountLimit)
      state.matchCounts.set(product.smiles, (state.matchCounts.get(product.smiles) || 0) + product.conformers);
    else state.matchCountsExact = false;
    const seen = (state.top.bySmiles.get(product.smiles)?.seenConformers || 0) + product.conformers;
    if (state.top.offer(product)) changed = true;
    const retained = state.top.bySmiles.get(product.smiles);
    if (retained) retained.seenConformers = seen;
  }
  return changed;
}
/** Conformer matches for a retained entry: the tracked count, else its own carried count. */
export const conformerMatchesOf = (matchCounts, entry) => matchCounts?.get(entry.smiles) ?? entry.seenConformers ?? 0;

export function createJobManager({
  indexPath, db,
  workers = envInt('LINK_FRAGMENTS_WORKERS', 2, 1, 4),
  queueLimit = 4, retainPerOwner = 5, retainTotal = 50, ttlMs = 6 * HOUR,
  // A generous ceiling, not an expected duration. Measured on oracleOld: the
  // reference full scan (2,519,224 pairs) takes ~526 s with 2 workers (~4,800
  // pairs/s); an explicit-H query ran ~10,700 pairs/s. 6 h leaves room for far
  // wider windows, slower hosts and a contended box before a scan is cut short.
  maxJobMs = envInt('LINK_FRAGMENTS_MAX_JOB_SECONDS', 6 * 3600, 1, 48 * 3600) * 1000,
  chunkRows = 4096, flushMs = 1000, cancelGraceMs = 15_000, matchCountLimit = 200_000,
  testHooks = null,
} = {}) {
  workers = Math.min(4, Math.max(1, workers));
  const jobs = new Map();
  const queue = [];
  const pool = [];
  let running = null;
  let closed = false;
  let chunkSeq = 0;
  const windowStats = db.query('SELECT count(*) AS n, min(rowid) AS first, max(rowid) AS last FROM pairs WHERE distance BETWEEN ? AND ?');
  const conformerAt = db.query('SELECT conformer_id AS c FROM pairs WHERE rowid = ?');
  // At most C(8,2)=28 pairs per conformer, contiguous in rowid order.
  const conformerEnd = db.query('SELECT max(rowid) AS r FROM pairs WHERE rowid BETWEEN ? AND ? AND conformer_id = ?');

  function spawn(slot) {
    if (closed) return;
    const worker = new Worker(new URL('./search-worker.mjs', import.meta.url), { workerData: { indexPath, flushMs, testHooks } });
    const record = { slot, worker, task: null, alive: true, finished: 0 };
    pool[slot] = record;
    worker.on('message', (message) => onMessage(record, message));
    worker.on('error', (error) => onLost(record, error?.message || 'Worker error'));
    worker.on('exit', (code) => onLost(record, `Worker exited with code ${code}`));
  }
  function retire(record) {
    record.alive = false;
    record.worker.terminate().catch(() => {});
    // Back off when a fresh worker dies before finishing any chunk (for example, a broken engine import).
    if (!closed) setTimeout(() => { spawn(record.slot); pump(); }, record.finished ? 250 : 5000).unref?.();
  }
  function onLost(record, message) {
    if (!record.alive) return;
    const task = record.task;
    record.task = null;
    if (task) { const job = jobs.get(task.jobId); if (job) job.inFlight--; }
    retire(record);
    if (task && running && task.jobId === running.id)
      stop(running, 'failed', { code: 'LINK_FRAGMENTS_WORKER_FAILED', message: `A scan worker stopped unexpectedly (${message}).` });
    pump();
  }
  for (let slot = 0; slot < workers; slot++) spawn(slot);

  function sweep(now = Date.now()) {
    const finished = [...jobs.values()].filter((job) => job.finishedAt).sort((a, b) => b.finishedMs - a.finishedMs);
    const perOwner = new Map();
    let kept = 0;
    for (const job of finished) {
      const ownerCount = (perOwner.get(job.owner) || 0) + 1;
      perOwner.set(job.owner, ownerCount);
      if (now - job.finishedMs > ttlMs || ownerCount > retainPerOwner || ++kept > retainTotal) jobs.delete(job.id);
    }
  }
  function publishThreshold(job) {
    const value = job.top.size >= job.top.limit ? encodeThreshold(job.top.worst().rmsd) : NO_THRESHOLD;
    Atomics.store(job.threshold, 0, value);
  }
  function snapshotCounts(job) {
    for (const entry of job.top.entries) entry.seenConformers = conformerMatchesOf(job.matchCounts, entry);
  }
  function stop(job, state, error = null) {
    if (job.finishedAt) return;
    job.state = state;
    job.error = error;
    job.finishedMs = Date.now();
    job.finishedAt = new Date(job.finishedMs).toISOString();
    Atomics.store(job.cancel, 0, 1);
    clearTimeout(job.timer);
    snapshotCounts(job);
    job.distinctProducts = job.matchCounts.size;
    job.matchCounts = null;
    job.input.sdf = null;
    if (running === job) running = null;
    const index = queue.indexOf(job);
    if (index >= 0) queue.splice(index, 1);
    // Workers stop between conformers; a stuck worker is replaced after a grace period.
    for (const record of pool) if (record?.task?.jobId === job.id) {
      const task = record.task;
      setTimeout(() => { if (record.alive && record.task === task) { record.task = null; job.inFlight--; retire(record); pump(); } }, cancelGraceMs).unref?.();
    }
    sweep();
    queueMicrotask(pump);
  }
  function start(job) {
    job.state = 'running';
    job.startedAt = new Date().toISOString();
    const stats = windowStats.get(job.window.lo, job.window.hi);
    job.totalPairs = stats.n;
    job.cursor = stats.first ?? 1;
    job.lastRowid = stats.last ?? 0;
    job.timer = setTimeout(() => stop(job, 'failed', { code: 'LINK_FRAGMENTS_TIME_LIMIT', message: 'The scan exceeded its wall-time limit; results are partial.' }), maxJobMs);
    job.timer.unref?.();
    running = job;
  }
  function nextChunk(job) {
    const from = job.cursor;
    let to = Math.min(from + chunkRows - 1, job.lastRowid);
    if (to < job.lastRowid) {
      const conformer = conformerAt.get(to)?.c;
      to = conformerEnd.get(to, to + 64, conformer)?.r ?? to;
    }
    job.cursor = to + 1;
    return { from, to };
  }
  function pump() {
    if (closed) return;
    for (;;) {
      if (!running) {
        const job = queue.shift();
        if (!job) return;
        try { start(job); } catch {
          stop(job, 'failed', { code: 'LINK_FRAGMENTS_INDEX_ERROR', message: 'The linker index could not be read.' });
          continue;
        }
      }
      const job = running;
      for (const record of pool) {
        if (job.cursor > job.lastRowid) break;
        if (!record?.alive || record.task) continue;
        const chunk = nextChunk(job);
        record.task = { jobId: job.id, id: ++chunkSeq };
        job.inFlight++;
        record.worker.postMessage({
          type: 'chunk', jobId: job.id, chunkId: record.task.id, ...chunk, lo: job.window.lo, hi: job.window.hi,
          sdf: job.input.sdf, attachments: job.input.attachments, maxRmsd: job.input.maxRmsd,
          cancel: job.cancel.buffer, threshold: job.threshold.buffer,
        });
      }
      if (job.cursor > job.lastRowid && job.inFlight === 0) {
        if (job.examinedPairs === job.totalPairs) stop(job, 'completed');
        else stop(job, 'failed', { code: 'LINK_FRAGMENTS_SCAN_INCOMPLETE', message: `Examined ${job.examinedPairs} of ${job.totalPairs} candidate pairs.` });
        continue;
      }
      return;
    }
  }
  function merge(job, message) {
    job.examinedPairs += message.examinedPairs;
    job.conformersExamined += message.conformersExamined;
    job.validPlacements += message.validPlacements;
    // Deferred placements are valid but never got a SMILES, so they are missing
    // from matchCounts: conformerMatches and distinctProducts become lower bounds.
    if (message.deferredPlacements) job.matchCountsExact = false;
    if (mergeProducts(job, message.products, matchCountLimit)) publishThreshold(job);
  }
  function onMessage(record, message) {
    if (message?.type !== 'flush') return;
    const job = jobs.get(message.jobId);
    if (message.done && record.task?.id === message.chunkId) { record.task = null; record.finished++; if (job) job.inFlight--; }
    if (job && job === running && job.state === 'running') {
      if (message.error) stop(job, 'failed', { code: 'LINK_FRAGMENTS_SCAN_FAILED', message: message.error });
      else try { merge(job, message); } catch (error) {
        stop(job, 'failed', { code: 'LINK_FRAGMENTS_SCAN_FAILED', message: error.message });
      }
    }
    if (message.done) pump();
  }

  const summary = (job) => {
    const complete = job.state === 'completed' && job.examinedPairs === job.totalPairs;
    return {
      id: job.id, state: job.state, complete, partial: !complete,
      createdAt: job.createdAt, startedAt: job.startedAt, finishedAt: job.finishedAt,
      query: { attachments: job.input.attachments, maxRmsd: job.input.maxRmsd, limit: job.input.limit, distance: job.distance },
      progress: {
        totalPairs: job.totalPairs, examinedPairs: job.examinedPairs,
        fraction: job.totalPairs ? job.examinedPairs / job.totalPairs : complete ? 1 : 0,
        conformersExamined: job.conformersExamined, validPlacements: job.validPlacements,
        distinctProducts: job.matchCounts ? job.matchCounts.size : job.distinctProducts,
        // false when any count is a lower bound: a placement was deferred (valid,
        // but worse than the retained K-th, so its SMILES was never computed) or
        // matchCountLimit was reached. conformerMatches and distinctProducts then
        // count only placements whose SMILES was computed (and, past the cap, a
        // retained product's matches since it was last admitted).
        conformerMatchesExact: job.matchCountsExact,
        distanceWindow: { lo: job.window.lo, hi: job.window.hi },
      },
      error: job.error, resultsRetained: job.top.size,
    };
  };
  const resultSummary = (job, entry, index) => ({
    id: entry.id, rank: index + 1, linkerId: entry.linkerId, conformerId: entry.conformerId,
    linkerAtoms: entry.detail.linkerAtoms, rmsd: entry.rmsd, minimumNonbondedRadiusRatio: entry.ratio,
    smiles: entry.smiles, heavyAtoms: entry.detail.heavyAtoms,
    conformerMatches: conformerMatchesOf(job.matchCounts, entry),
    refined: Boolean(entry.refinement),
  });
  const owned = (owner, id) => { sweep(); const job = jobs.get(id); return job && job.owner === owner ? job : null; };

  return {
    /** Throws {status, code, message[, jobId]} for queue refusals: LINK_FRAGMENTS_OWNER_BUSY
     * (with the owner's active job id) or LINK_FRAGMENTS_QUEUE_FULL (global queue). prepared is a successful prepareQuery result. */
    submit(owner, { sdf, attachments, maxRmsd, limit }, prepared) {
      if (closed) throw Object.assign(new Error('Service is closing.'), { status: 503, code: 'LINK_FRAGMENTS_UNAVAILABLE' });
      sweep();
      const active = [...jobs.values()].find((job) => job.owner === owner && !job.finishedAt);
      if (active)
        throw Object.assign(new Error('You already have a linker scan queued or running. Cancel it or wait for it to finish.'), { status: 429, code: 'LINK_FRAGMENTS_OWNER_BUSY', jobId: active.id });
      if (queue.length >= queueLimit)
        throw Object.assign(new Error('The linker scan queue is full. Please retry later.'), { status: 429, code: 'LINK_FRAGMENTS_QUEUE_FULL' });
      const window = distanceWindow(prepared, maxRmsd);
      const job = {
        id: randomUUID(), owner, state: 'queued', createdAt: new Date().toISOString(), startedAt: null, finishedAt: null, finishedMs: 0,
        input: { sdf, attachments, maxRmsd, limit }, distance: prepared.distance, window: { lo: window.lo, hi: window.hi },
        totalPairs: null, examinedPairs: 0, conformersExamined: 0, validPlacements: 0, error: null,
        top: new TopProducts(limit), matchCounts: new Map(), matchCountsExact: true, inFlight: 0,
        cancel: new Int32Array(new SharedArrayBuffer(4)), threshold: new Int32Array(new SharedArrayBuffer(4)),
      };
      Atomics.store(job.threshold, 0, NO_THRESHOLD);
      jobs.set(job.id, job);
      queue.push(job);
      pump();
      return summary(job);
    },
    list(owner) {
      sweep();
      return [...jobs.values()].filter((job) => job.owner === owner).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(summary);
    },
    get(owner, id) {
      const job = owned(owner, id);
      return job && { ...summary(job), results: job.top.entries.map((entry, index) => resultSummary(job, entry, index)) };
    },
    cancel(owner, id) {
      const job = owned(owner, id);
      if (!job) return null;
      if (!job.finishedAt) stop(job, 'canceled');
      return summary(job);
    },
    /** Returns {job, entry, index} for the owner's retained result, else null. */
    findResult(owner, id, resultIdValue) {
      const job = owned(owner, id);
      const index = job ? job.top.entries.findIndex((entry) => entry.id === resultIdValue) : -1;
      return index < 0 ? null : { job, entry: job.top.entries[index], index };
    },
    resultDetail(job, entry, index) {
      const { sdf, sourceAtomMappings, removedHydrogens, attachments, fixedAtoms, fragmentAtomCount, method } = entry.detail;
      return { ...resultSummary(job, entry, index), sdf, sourceAtomMappings, removedHydrogens, attachments, fixedAtoms, fragmentAtomCount, method, refinement: entry.refinement };
    },
    stats() {
      return { running: running ? 1 : 0, queued: queue.length, workers: pool.filter((record) => record?.alive).length };
    },
    async close() {
      closed = true;
      for (const job of jobs.values()) clearTimeout(job.timer);
      await Promise.all(pool.map((record) => { if (!record) return null; record.alive = false; return record.worker.terminate().catch(() => {}); }));
    },
  };
}
