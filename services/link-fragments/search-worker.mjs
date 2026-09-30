// Full-scan worker thread. Owns a read-only SQLite handle; reads one conformer-
// aligned rowid chunk at a time, inflates/describes each record once and fits
// EVERY in-window label pair. Only products that could enter the coordinator's
// top-K carry SDF detail; the rest are counted. Each fit receives the current
// retention threshold as deferAbove: a valid placement strictly worse than the
// retained K-th product is counted without SDF or stereo SMILES (deferred).
import { parentPort, workerData } from 'node:worker_threads';
import { inflateSync } from 'node:zlib';
import { Database } from 'bun:sqlite';
import { prepareQuery, linkerDescriptor, fitAndJoin } from './engine.mjs';
import { deferAboveOf } from './jobs.mjs';
import * as sdfModule from './sdf.mjs';

const db = new Database(workerData.indexPath, { readonly: true });
// NOT INDEXED keeps the rowid range scan (conformer order) instead of the distance index.
const rowsQuery = db.query('SELECT conformer_id AS c, a, b FROM pairs NOT INDEXED WHERE rowid BETWEEN ? AND ? AND distance BETWEEN ? AND ? ORDER BY rowid');
const recordQuery = db.query('SELECT linker_id, sdf_zlib FROM conformers WHERE id = ?');
const hooks = workerData.testHooks || {};
const flushMs = workerData.flushMs || 1000;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let current = null;

function detailFor(fit, linkerId, conformerId, pair) {
  const data = { PYXIS_LINKER_ID: linkerId, PYXIS_CONFORMER_ID: conformerId, PYXIS_LINKER_ATOMS: fit.selectedLabels.join(','), PYXIS_FIT_RMSD: fit.rmsd.toFixed(6) };
  const sdf = typeof sdfModule.withSdfData === 'function' ? sdfModule.withSdfData(fit.sdf, data) : fit.sdf;
  return {
    sdf, linkerAtoms: fit.selectedLabels, indexPair: pair, heavyAtoms: fit.descriptors?.NumHeavyAtoms ?? null,
    sourceAtomMappings: fit.sourceAtomMappings ?? null, removedHydrogens: fit.removedHydrogens ?? [], attachments: fit.attachments ?? null,
    fixedAtoms: fit.fixedAtoms ?? null, fragmentAtomCount: fit.fragmentAtomCount ?? null, method: fit.method,
  };
}

async function runChunk(task) {
  if (current?.jobId !== task.jobId) {
    const prepared = await prepareQuery(task.sdf, task.attachments);
    if (!prepared.ok) throw new Error(prepared.errors?.[0]?.message || 'Query could not be prepared.');
    current = { jobId: task.jobId, prepared };
  }
  const cancel = new Int32Array(task.cancel);
  const threshold = new Int32Array(task.threshold);
  const rows = rowsQuery.all(task.from, task.to, task.lo, task.hi);
  let examinedPairs = 0, conformersExamined = 0, validPlacements = 0, deferredPlacements = 0, products = new Map(), lastFlush = Date.now();
  const flush = (done, extra = {}) => {
    parentPort.postMessage({ type: 'flush', jobId: task.jobId, chunkId: task.chunkId, done, examinedPairs, conformersExamined, validPlacements, deferredPlacements, products: [...products.values()], ...extra });
    examinedPairs = conformersExamined = validPlacements = deferredPlacements = 0;
    products = new Map();
    lastFlush = Date.now();
  };
  for (let start = 0; start < rows.length;) {
    if (Atomics.load(cancel, 0)) break;
    let end = start;
    while (end < rows.length && rows[end].c === rows[start].c) end++;
    const conformerId = rows[start].c;
    if (hooks.conformerDelayMs) await sleep(hooks.conformerDelayMs);
    if (hooks.failAtConformer === conformerId) throw new Error(`Injected failure at conformer ${conformerId}.`);
    if (hooks.crashAtConformer === conformerId) process.exit(3);
    const record = recordQuery.get(conformerId);
    if (!record) throw new Error(`Conformer ${conformerId} is missing from the index.`);
    const descriptor = linkerDescriptor(inflateSync(record.sdf_zlib).toString('utf8'));
    const seen = new Set();
    for (let i = start; i < end; i++) {
      const pair = [rows[i].a, rows[i].b];
      // An invalid descriptor still counts as examined: its pairs cannot be accepted.
      // Read per pair: the threshold only decreases, so a stale value defers less.
      const deferAbove = deferAboveOf(Atomics.load(threshold, 0));
      const fit = descriptor.ok ? await fitAndJoin(current.prepared, descriptor, { pair, maxRmsd: task.maxRmsd, deferAbove }) : null;
      examinedPairs++;
      if (!fit?.ok) continue;
      validPlacements++;
      // Valid, but cannot enter the top-K: no SMILES, so conformerMatches is a lower bound.
      if (fit.deferred) { deferredPlacements++; continue; }
      const placement = { smiles: fit.smiles, rmsd: fit.rmsd, ratio: fit.minimumNonbondedRadiusRatio, conformerId, linkerId: record.linker_id, pair };
      const known = products.get(fit.smiles);
      if (!seen.has(fit.smiles)) { seen.add(fit.smiles); if (known) known.conformers++; }
      if (known && !(placement.rmsd < known.rmsd || (placement.rmsd === known.rmsd && (placement.ratio ?? Infinity) > (known.ratio ?? Infinity)))) continue;
      // Threshold only decreases; a stale read is looser, never unsafe.
      const eligible = Math.floor(fit.rmsd * 1e9) <= Atomics.load(threshold, 0);
      products.set(fit.smiles, { ...placement, conformers: known ? known.conformers : 1, detail: eligible ? detailFor(fit, record.linker_id, conformerId, pair) : null });
    }
    conformersExamined++;
    start = end;
    if (Date.now() - lastFlush >= flushMs) flush(false);
  }
  flush(true, { canceled: Boolean(Atomics.load(cancel, 0)) });
}

parentPort.on('message', async (task) => {
  if (task?.type !== 'chunk') return;
  try { await runChunk(task); } catch (error) {
    parentPort.postMessage({ type: 'flush', jobId: task.jobId, chunkId: task.chunkId, done: true, examinedPairs: 0, conformersExamined: 0, validPlacements: 0, products: [], error: error?.message || 'Candidate fitting failed.' });
  }
});
