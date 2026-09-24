#!/usr/bin/env bun
// Loopback-only, read-only similarity service for the compact September 2026
// macrocycle indexes. The public application never calls this service directly.
import http from 'node:http';
import path from 'node:path';
import fsp from 'node:fs/promises';
import { loadRDKit } from '../../server/utils/openCompounds.js';
import {
  DATASETS, FINGERPRINT_BYTES, FINGERPRINT_DETAILS, NORMALIZED_HEADER,
  POPCOUNT, RECORD_BYTES, parseCsvLine,
} from './common.mjs';

const READ_ROWS = 4096;
const MAX_OFFSET = 100000;

function isWorse(a, b) {
  return a.score < b.score || (a.score === b.score && a.id > b.id);
}

function pushBest(heap, candidate, capacity) {
  if (heap.length < capacity) {
    let i = heap.length;
    heap.push(candidate);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!isWorse(heap[i], heap[parent])) break;
      [heap[i], heap[parent]] = [heap[parent], heap[i]];
      i = parent;
    }
    return;
  }
  if (!isWorse(heap[0], candidate)) return;
  heap[0] = candidate;
  let i = 0;
  while (true) {
    const left = i * 2 + 1;
    if (left >= heap.length) break;
    const right = left + 1;
    let child = left;
    if (right < heap.length && isWorse(heap[right], heap[left])) child = right;
    if (!isWorse(heap[child], heap[i])) break;
    [heap[i], heap[child]] = [heap[child], heap[i]];
    i = child;
  }
}

async function readExactly(handle, buffer, length, position) {
  let filled = 0;
  while (filled < length) {
    const { bytesRead } = await handle.read(buffer, filled, length - filled, position + filled);
    if (!bytesRead) throw new Error('Unexpected end of index file');
    filled += bytesRead;
  }
}

async function readMetadataLine(handle, offset) {
  const pieces = [];
  let position = offset;
  let total = 0;
  while (total < 16384) {
    const buffer = Buffer.allocUnsafe(4096);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
    if (!bytesRead) throw new Error('Metadata offset is outside the rows file');
    const end = buffer.subarray(0, bytesRead).indexOf(10);
    pieces.push(buffer.subarray(0, end >= 0 ? end : bytesRead));
    total += end >= 0 ? end : bytesRead;
    if (end >= 0) return Buffer.concat(pieces).toString('utf8');
    position += bytesRead;
  }
  throw new Error('Macrocycle metadata row is unexpectedly long');
}

export async function openIndexStore(indexDir) {
  const datasets = new Map();
  for (const [source, definition] of Object.entries(DATASETS)) {
    let fingerprints;
    try {
      const manifest = JSON.parse(await fsp.readFile(path.join(indexDir, `${source}.manifest.json`), 'utf8'));
      if (manifest.formatVersion !== 1 || manifest.source !== source
        || manifest.datasetId !== definition.id || manifest.datasetName !== definition.name
        || !Number.isInteger(manifest.indexedRows) || manifest.indexedRows < 1
        || manifest.sourceRows !== definition.expectedRows) {
        throw new Error(`Invalid ${source} index manifest`);
      }
      const fpPath = path.join(indexDir, `${source}.fpb`);
      const rowsPath = path.join(indexDir, `${source}.rows.csv`);
      if ((await fsp.stat(fpPath)).size !== manifest.indexedRows * RECORD_BYTES
        || (await fsp.stat(rowsPath)).size !== manifest.rowsBytes) {
        throw new Error(`Incomplete ${source} index files`);
      }
      fingerprints = await fsp.open(fpPath, 'r');
      const rows = await fsp.open(rowsPath, 'r');
      datasets.set(definition.id, { manifest, fingerprints, rows });
    } catch (error) {
      await fingerprints?.close();
      // One incomplete export must not make the other corpus disappear. The
      // API resolver lists only valid datasets and reports this one unavailable.
      console.error(`Macrocycle ${source} index unavailable: ${error.message}`);
    }
  }
  if (datasets.size === 0) throw new Error('No valid macrocycle indexes were found');
  return {
    datasets,
    async close() {
      for (const dataset of datasets.values()) {
        await dataset.fingerprints.close();
        await dataset.rows.close();
      }
    },
  };
}

export async function searchIndex(store, { datasetId, smiles, threshold, offset, limit }) {
  const dataset = store.datasets.get(datasetId);
  if (!dataset) throw Object.assign(new Error('Dataset not found'), { status: 404 });
  const rdkit = await loadRDKit();
  const mol = rdkit.get_mol(smiles);
  if (!mol) throw Object.assign(new Error('Invalid SMILES'), { status: 400 });
  let queryFp;
  let canonical;
  try {
    canonical = mol.get_smiles();
    queryFp = mol.get_morgan_fp_as_uint8array(FINGERPRINT_DETAILS);
  } finally { mol.delete(); }
  if (!queryFp || queryFp.length !== FINGERPRINT_BYTES) throw new Error('Could not fingerprint query');
  let queryBits = 0;
  for (let i = 0; i < FINGERPRINT_BYTES; i++) queryBits += POPCOUNT[queryFp[i]];
  const capacity = offset + limit;
  const heap = [];
  let totalMatches = 0;
  let processed = 0;
  const buffer = Buffer.allocUnsafe(READ_ROWS * RECORD_BYTES);
  while (processed < dataset.manifest.indexedRows) {
    const rows = Math.min(READ_ROWS, dataset.manifest.indexedRows - processed);
    await readExactly(dataset.fingerprints, buffer, rows * RECORD_BYTES, processed * RECORD_BYTES);
    for (let row = 0; row < rows; row++) {
      const pos = row * RECORD_BYTES;
      const moleculeBits = buffer.readUInt16LE(pos + 8);
      if (Math.min(queryBits, moleculeBits) / Math.max(1, queryBits, moleculeBits) < threshold) continue;
      let intersection = 0;
      for (let bit = 0; bit < FINGERPRINT_BYTES; bit++) {
        intersection += POPCOUNT[queryFp[bit] & buffer[pos + 10 + bit]];
      }
      const union = queryBits + moleculeBits - intersection;
      const score = union ? intersection / union : 0;
      if (score < threshold) continue;
      totalMatches++;
      const id = processed + row + 1;
      const worst = heap[0];
      if (heap.length < capacity || score > worst.score || (score === worst.score && id < worst.id)) {
        pushBest(heap, { id, score, metadataOffset: Number(buffer.readBigUInt64LE(pos)) }, capacity);
      }
    }
    processed += rows;
  }
  heap.sort((a, b) => b.score - a.score || a.id - b.id);
  const page = heap.slice(offset, offset + limit);
  const results = [];
  for (const hit of page) {
    const fields = parseCsvLine(await readMetadataLine(dataset.rows, hit.metadataOffset));
    if (fields.length !== NORMALIZED_HEADER.length) throw new Error('Corrupt index metadata row');
    const metadata = Object.fromEntries(NORMALIZED_HEADER.map((key, index) => [key, fields[index]]));
    const hitMol = rdkit.get_mol(metadata.smiles);
    let hitSmiles = metadata.smiles;
    if (hitMol) {
      try { hitSmiles = hitMol.get_smiles() || hitSmiles; }
      finally { hitMol.delete(); }
    }
    delete metadata.smiles;
    results.push({ molecule_id: hit.id, canonical_smiles: hitSmiles, similarity: hit.score, metadata });
  }
  return { found: results.length > 0, count: results.length, total_matches: totalMatches, query_smiles: canonical, results };
}

function parseSearch(url) {
  const q = url.searchParams;
  const datasetId = Number(q.get('dataset_id'));
  const smiles = q.get('smiles') || '';
  const threshold = Number(q.get('threshold'));
  const offset = Number(q.get('offset'));
  const limit = Number(q.get('limit'));
  if (!Number.isInteger(datasetId) || datasetId < 1
    || !smiles.trim() || smiles.length > 4096
    || !Number.isFinite(threshold) || threshold < 0.1 || threshold > 1
    || !Number.isInteger(offset) || offset < 0 || offset > MAX_OFFSET
    || !Number.isInteger(limit) || limit < 1 || limit > 100
    || (q.get('fingerprint_type') || 'morgan') !== 'morgan'
    || (q.get('similarity_metric') || 'tanimoto') !== 'tanimoto') {
    throw Object.assign(new Error('Invalid macrocycle similarity query'), { status: 400 });
  }
  return { datasetId, smiles, threshold, offset, limit };
}

function sendJson(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(payload));
}

export function createIndexServer(store) {
  // A single bounded scan at a time protects the shared staging host's CPU.
  let queue = Promise.resolve();
  let pending = 0;
  return http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed' });
    if (url.pathname === '/health') return sendJson(res, 200, { status: 'OK', datasets: store.datasets.size });
    if (url.pathname === '/v1/datasets') {
      return sendJson(res, 200, { datasets: [...store.datasets.values()].map(({ manifest }) => ({
        id: manifest.datasetId, name: manifest.datasetName, row_count: manifest.indexedRows,
      })) });
    }
    if (url.pathname !== '/v1/search/similarity') return sendJson(res, 404, { error: 'Not found' });
    let params;
    try { params = parseSearch(url); }
    catch (error) { return sendJson(res, error.status || 400, { error: error.message }); }
    if (pending >= 4) return sendJson(res, 429, { error: 'Macrocycle search is busy; retry shortly' });
    pending++;
    const result = queue.then(() => searchIndex(store, params));
    queue = result.catch(() => {});
    result.then((payload) => sendJson(res, 200, payload)).catch((error) => {
      const status = error.status || 500;
      if (status === 500) console.error('Macrocycle index search failed:', error);
      sendJson(res, status, { error: status === 500 ? 'Macrocycle index search failed' : error.message });
    }).finally(() => { pending--; });
  });
}

async function main() {
  const host = process.env.BIND_HOST || '127.0.0.1';
  const port = Number(process.env.PORT || 8274);
  if (!['127.0.0.1', '::1'].includes(host) || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('Macrocycle search must bind a valid loopback host and port');
  }
  const dir = process.env.MACROCYCLE_INDEX_DIR;
  if (!dir) throw new Error('MACROCYCLE_INDEX_DIR is required');
  const store = await openIndexStore(dir);
  const server = createIndexServer(store);
  server.listen(port, host, () => console.log(`Macrocycle index ready on ${host}:${port}`));
  const close = () => server.close(() => store.close().finally(() => process.exit(0)));
  process.on('SIGTERM', close);
  process.on('SIGINT', close);
}

if (import.meta.main) main().catch((error) => { console.error(error); process.exitCode = 1; });
