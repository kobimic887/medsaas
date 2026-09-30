#!/usr/bin/env bun
// Scientific data host only. The application reaches this read-only compressed
// linker index through its existing private SSH transport. No catalog fallback.
import http from 'node:http';
import { Worker } from 'node:worker_threads';
import { inflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { prepareQuery } from './engine.mjs';

export const METHOD = 'Pyxis rigid two-fragment matching';
export const LIMITATIONS = ['Fragments keep their uploaded coordinates.', 'Carbon/nitrogen attachment centers only; query attachment atoms must have an implicit hydrogen available. Removing explicit hydrogens is not supported.', 'Single-bond attachment only; unused He labels are capped with hydrogen.', 'Geometry fit and clash screening, without MOE energy, minimization or synthesis scores.', 'A bounded candidate search may omit matches; inspect the search coverage.'];
const MAX_CANDIDATES = 250;
const MAX_BODY = 1024 * 1024;

export async function createLinkerServer({ indexPath, candidateCap = MAX_CANDIDATES } = {}) {
  const { Database } = await import('bun:sqlite');
  const db = new Database(indexPath, { readonly: true });
  const manifest = JSON.parse(db.query("SELECT value FROM metadata WHERE key='manifest'").get()?.value || '{}');
  if (manifest.formatVersion !== 1 || !manifest.records || !manifest.pairs) throw new Error('Invalid linker index manifest');
  let active = false;
  const server = http.createServer(async (req, res) => {
    const send = (status, data) => { if (!res.destroyed) { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); } };
    if (req.url === '/status' && req.method === 'GET') return send(200, { available: true, records: manifest.records, pairs: manifest.pairs, rejected: manifest.rejected, method: METHOD, limitations: LIMITATIONS });
    if (req.url !== '/search' || req.method !== 'POST') return send(404, { error: 'Route not found' });
    if (active) return send(503, { error: 'Linker search is busy. Please retry.', code: 'LINK_FRAGMENTS_BUSY' });
    active = true;
    let worker; let timeout;
    try {
      let body = ''; let bytes = 0;
      for await (const chunk of req) {
        bytes += chunk.length;
        if (bytes > MAX_BODY) { send(413, { error: 'SDF request exceeds 1 MB.' }); return; }
        body += chunk.toString();
      }
      const input = JSON.parse(body);
      const maxRmsd = input.maxRmsd ?? 0.75;
      const limit = input.limit ?? 10;
      if (!Number.isFinite(maxRmsd) || maxRmsd < 0.1 || maxRmsd > 1 || !Number.isInteger(limit) || limit < 1 || limit > 20) return send(400, { error: 'Choose RMSD 0.1–1 Å and 1–20 results.' });
      const prepared = await prepareQuery(input.sdf, input.attachmentAtoms);
      if (!prepared.ok) return send(400, { error: prepared.errors?.[0]?.message || 'Invalid fragments', details: prepared.errors });
      // The index uses 1.5 A anchors. A 0.75 angstrom margin protects the distance
      // prefilter when the engine uses element-specific connection lengths.
      const margin = maxRmsd * 2 + 0.75;
      const lo = Math.max(0, prepared.distance - margin); const hi = prepared.distance + margin;
      const count = db.query('SELECT count(*) AS n FROM pairs WHERE distance BETWEEN ? AND ?').get(lo, hi).n;
      // Read nearest neighbors from both ends of the distance index. Sorting
      // abs(distance-query) over millions of rows would block status/abort.
      const above = db.query('SELECT conformer_id,a,b,distance FROM pairs WHERE distance BETWEEN ? AND ? ORDER BY distance ASC LIMIT ?').all(prepared.distance, hi, candidateCap);
      const below = db.query('SELECT conformer_id,a,b,distance FROM pairs WHERE distance >= ? AND distance < ? ORDER BY distance DESC LIMIT ?').all(lo, prepared.distance, candidateCap);
      const rows = [...above, ...below].sort((a,b) => Math.abs(a.distance-prepared.distance)-Math.abs(b.distance-prepared.distance) || a.conformer_id-b.conformer_id || a.a-b.a || a.b-b.b).slice(0,candidateCap);
      // Keep data off the application host. Only this bounded candidate batch
      // enters the scientific worker; only assembled products leave it.
      const recordCache = new Map();
      const getRecord = db.query('SELECT linker_id,sdf_zlib FROM conformers WHERE id=?');
      const candidates = rows.map(row => {
        if (!recordCache.has(row.conformer_id)) {
          const record = getRecord.get(row.conformer_id);
          recordCache.set(row.conformer_id, {linkerId: record.linker_id, sdf: inflateSync(record.sdf_zlib).toString('utf8')});
        }
        return { conformerId: row.conformer_id, pair: [row.a, row.b], ...recordCache.get(row.conformer_id) };
      });
      worker = new Worker(new URL('./search-worker.mjs', import.meta.url), { workerData: { sdf: input.sdf, attachmentAtoms: input.attachmentAtoms, maxRmsd, limit, candidates } });
      const abort = () => { worker?.terminate(); };
      res.once('close', abort);
      const result = await new Promise((resolve, reject) => {
        worker.once('message', resolve);
        worker.once('error', reject);
        worker.once('exit', code => { if (code) reject(new Error('Search interrupted')); });
        timeout = setTimeout(() => { worker.terminate(); reject(new Error('Search exceeded its time limit')); }, 40000);
      });
      res.off('close', abort);
      if (result.error) throw new Error(result.error);
      send(200, { ...result, candidatesAvailable: count, candidatesScanned: rows.length, truncated: count > rows.length, method: METHOD, limitations: LIMITATIONS });
    } catch (error) {
      send(error instanceof SyntaxError ? 400 : 503, { error: error instanceof SyntaxError ? 'Invalid JSON request.' : 'Linker search could not finish. Please retry or narrow the fit tolerance.', code: 'LINK_FRAGMENTS_UNAVAILABLE' });
    } finally {
      clearTimeout(timeout);
      await worker?.terminate();
      active = false;
    }
  });
  server.on('close', () => db.close());
  return server;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const indexPath = process.env.LINKER_INDEX_PATH;
  if (!indexPath) throw new Error('LINKER_INDEX_PATH is required');
  const server = await createLinkerServer({ indexPath });
  server.listen(Number(process.env.PORT || 8374), '127.0.0.1', () => console.log('Link Fragments listening on loopback'));
}
