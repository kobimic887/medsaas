#!/usr/bin/env bun
// Scientific data host only. The application reaches this read-only compressed
// linker index through its existing private SSH transport. No catalog fallback.
// Every /inspect and /jobs* request carries the app-computed owner key
// (X-Pyxis-Owner, sha256 hex); other owners' jobs are indistinguishable from missing.
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { prepareQuery, inspectAttachmentSites } from './engine.mjs';
import { createJobManager } from './jobs.mjs';

export const METHOD = 'Pyxis rigid two-fragment matching; complete background scans of the owned 3D linker index';
export const LIMITATIONS = [
  'Uploaded fragment atoms keep their coordinates; the linker is placed rigidly by a two-anchor fit and torsion scan.',
  'Each attachment is a single bond replacing one implicit or explicit hydrogen on a C, N, O or S centre (O/S only as neutral two-coordinate O-H/S-H); supported pairs are C-C, C-N, N-N, C-O, C-S, N-O and N-S; phosphorus and O-O/O-S/S-S links are refused. Unused He labels are capped with hydrogen.',
  'N-O and N-S links are checked for valence and geometry only; their chemical stability is not assessed.',
  'A scan examines every indexed linker label pair inside a provably safe anchor-distance window. Queued, running, canceled and failed scans are partial.',
  'Geometry fit and clash screening. Optional force-field refinement is a local constrained minimization, not MOE refinement, binding affinity or synthesis feasibility.',
];
const MAX_BODY = 1024 * 1024;
const MAX_REFINE_BODY = 6 * 1024 * 1024;
const MAX_RECEPTOR = 5 * 1024 * 1024;
const OWNER = /^[0-9a-f]{64}$/;
const JOB_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const RESULT_ID = /^\d+-\d+-\d+$/;
const FORCE_FIELDS = ['auto', 'MMFF94', 'UFF'];

class HttpError extends Error {
  constructor(status, body) { super(body.error); this.status = status; this.body = body; }
}
const selectionValid = (value) => (Number.isInteger(value) && value > 0) ||
  (value && typeof value === 'object' && !Array.isArray(value) && Number.isInteger(value.atom) && value.atom > 0 &&
    (value.hydrogenAtom === undefined || (Number.isInteger(value.hydrogenAtom) && value.hydrogenAtom > 0)) &&
    Object.keys(value).every((key) => key === 'atom' || key === 'hydrogenAtom'));

async function readJson(req, limit) {
  let body = '';
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > limit) throw new HttpError(413, { error: `Request exceeds ${Math.round(limit / 1024 / 1024)} MB.`, code: 'LINK_FRAGMENTS_TOO_LARGE' });
    body += chunk.toString();
  }
  try {
    const value = JSON.parse(body);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new SyntaxError('Object required');
    return value;
  } catch { throw new HttpError(400, { error: 'Invalid JSON request.', code: 'INVALID_JSON' }); }
}

/**
 * HTTP status for a failed refinement; the body always keeps the original code.
 * 422 only for unprocessable chemistry (REFINEMENT_UNSUPPORTED, RECEPTOR_*); bad
 * input 400; the Python child's own timeout 504; busy, unavailable, failed,
 * aborted and unknown codes are service-side 503.
 */
export function refinementFailureStatus(code) {
  if (code === 'REFINEMENT_UNSUPPORTED' || /^RECEPTOR_[A-Z_]+$/.test(code || '')) return 422;
  if (code === 'INVALID_REFINEMENT_INPUT') return 400;
  if (code === 'REFINEMENT_TIMEOUT') return 504;
  return 503;
}

/**
 * Aborts when the client disconnects before the response is finished. Node emits
 * res 'close' for that. Bun 1.3's node:http drops its abort callback once the
 * request body has been read and emits nothing, but its native response handle
 * still flips `aborted`; poll that flag when it exists (feature-detected, so a
 * runtime without it relies on 'close' alone). service-test.mjs proves the lock
 * is released after a real client abort on the runtime in use.
 */
export function disconnectSignal(res, pollMs = 200) {
  const controller = new AbortController();
  const key = Object.getOwnPropertySymbols(res).find((symbol) => symbol.description === 'handle');
  const handle = key ? res[key] : null;
  let timer = null;
  const dispose = () => { clearInterval(timer); res.off('close', onClose); };
  const abort = () => { dispose(); controller.abort(); };
  function onClose() { if (!res.writableFinished) abort(); }
  res.once('close', onClose);
  if (handle && typeof handle.aborted === 'boolean') {
    timer = setInterval(() => { if (handle.aborted) abort(); }, pollMs);
    timer.unref?.();
  }
  return { signal: controller.signal, dispose };
}

// Timeout ordering (innermost first): the Python child is killed at
// refineTimeoutMs (90 s default; the unit sets LINK_FRAGMENTS_REFINE_TIMEOUT_MS=90000)
// and reported as REFINEMENT_TIMEOUT/504, before the application relay gives up
// (140 s) and before the browser request does (150 s). A caller that leaves
// earlier closes the connection; disconnectSignal then kills the child and frees
// the one-refinement lock instead of letting it run on unobserved.
export async function createLinkerServer({ indexPath, jobOptions = {}, refineModulePath = './refine.mjs', refineTimeoutMs = Number(process.env.LINK_FRAGMENTS_REFINE_TIMEOUT_MS) || 90_000 } = {}) {
  const { Database } = await import('bun:sqlite');
  const db = new Database(indexPath, { readonly: true });
  const manifest = JSON.parse(db.query("SELECT value FROM metadata WHERE key='manifest'").get()?.value || '{}');
  if (manifest.formatVersion !== 1 || !manifest.records || !manifest.pairs) throw new Error('Invalid linker index manifest');
  // The service must start without the refinement lane; /status reports why.
  let refine = null;
  let refineLoadError = null;
  try { refine = await import(new URL(refineModulePath, import.meta.url).href); } catch { refineLoadError = 'Refinement module is not installed on this host.'; }
  const refinementStatus = async () => {
    if (!refine) return { available: false, reason: refineLoadError };
    try {
      const status = await refine.refinementStatus();
      return status?.available
        ? { available: true, forceFields: status.forceFields || ['MMFF94', 'UFF'], rdkitVersion: status.rdkitVersion || null }
        : { available: false, reason: status?.reason || 'Refinement is unavailable.' };
    } catch { return { available: false, reason: 'Refinement probe failed.' }; }
  };
  const jobs = createJobManager({ indexPath, db, ...jobOptions });
  let refining = false;

  const server = http.createServer(async (req, res) => {
    const send = (status, data) => { if (!res.destroyed) { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); } };
    try {
      const { pathname } = new URL(req.url, 'http://loopback');
      const parts = pathname.split('/').filter(Boolean);
      if (pathname === '/status' && req.method === 'GET')
        return send(200, { available: true, records: manifest.records, pairs: manifest.pairs, rejected: manifest.rejected, method: METHOD, limitations: LIMITATIONS, jobs: jobs.stats(), refinement: await refinementStatus() });
      if (parts[0] !== 'inspect' && parts[0] !== 'jobs') return send(404, { error: 'Route not found' });
      const owner = req.headers['x-pyxis-owner'];
      if (typeof owner !== 'string' || !OWNER.test(owner)) return send(400, { error: 'Owner key required.', code: 'OWNER_REQUIRED' });
      const notFound = () => send(404, { error: 'Search job not found.', code: 'JOB_NOT_FOUND' });

      if (pathname === '/inspect' && req.method === 'POST') {
        const { sdf } = await readJson(req, MAX_BODY);
        if (typeof sdf !== 'string' || !sdf.trim()) return send(400, { error: 'Supply the two-fragment SDF.', details: [{ code: 'SDF_REQUIRED', message: 'Supply the two-fragment SDF.' }] });
        const result = await inspectAttachmentSites(sdf);
        return result.ok ? send(200, result) : send(400, { error: result.errors?.[0]?.message || 'Invalid fragments', details: result.errors });
      }
      if (pathname === '/jobs' && req.method === 'POST') {
        const input = await readJson(req, MAX_BODY);
        const maxRmsd = input.maxRmsd ?? 0.75;
        const limit = input.limit ?? 20;
        if (typeof input.sdf !== 'string' || !input.sdf.trim() || !Array.isArray(input.attachments) || input.attachments.length !== 2 || !input.attachments.every(selectionValid))
          return send(400, { error: 'Supply the SDF and one attachment selection per fragment.', details: [{ code: 'ATTACHMENT_REQUIRED', message: 'Select one one-based atom number in each fragment.' }] });
        if (typeof maxRmsd !== 'number' || !Number.isFinite(maxRmsd) || maxRmsd < 0.1 || maxRmsd > 1 || !Number.isInteger(limit) || limit < 1 || limit > 50)
          return send(400, { error: 'Choose RMSD 0.1–1 Å and 1–50 results.', details: [{ code: 'INVALID_SETTINGS', message: 'Choose RMSD 0.1–1 Å and 1–50 results.' }] });
        const prepared = await prepareQuery(input.sdf, input.attachments);
        if (!prepared.ok) return send(400, { error: prepared.errors?.[0]?.message || 'Invalid fragments', details: prepared.errors });
        try {
          return send(202, { job: jobs.submit(owner, { sdf: input.sdf, attachments: input.attachments, maxRmsd, limit }, prepared) });
        } catch (error) {
          if (error.status) return send(error.status, { error: error.message, code: error.code, ...(error.jobId ? { jobId: error.jobId } : {}) });
          return send(400, { error: 'The candidate window could not be bounded for this attachment.', details: [{ code: 'UNBOUNDED_WINDOW', message: error.message }] });
        }
      }
      if (pathname === '/jobs' && req.method === 'GET') return send(200, { jobs: jobs.list(owner) });
      if (parts[0] !== 'jobs' || parts.length < 2) return send(404, { error: 'Route not found' });
      if (!JOB_ID.test(parts[1])) return notFound();
      if (parts.length === 2 && req.method === 'GET') {
        const job = jobs.get(owner, parts[1]);
        return job ? send(200, { job }) : notFound();
      }
      if (parts.length === 3 && parts[2] === 'cancel' && req.method === 'POST') {
        const job = jobs.cancel(owner, parts[1]);
        return job ? send(200, { job }) : notFound();
      }
      if (parts.length >= 4 && parts[2] === 'results') {
        if (!RESULT_ID.test(parts[3])) return send(404, { error: 'Result not found.', code: 'RESULT_NOT_FOUND' });
        const lookup = () => {
          const found = jobs.findResult(owner, parts[1], parts[3]);
          if (!found) send(404, jobs.get(owner, parts[1]) ? { error: 'Result not found.', code: 'RESULT_NOT_FOUND' } : { error: 'Search job not found.', code: 'JOB_NOT_FOUND' });
          return found;
        };
        if (parts.length === 4 && req.method === 'GET') {
          const found = lookup();
          return found && send(200, { result: jobs.resultDetail(found.job, found.entry, found.index) });
        }
        if (parts.length === 5 && parts[4] === 'refine' && req.method === 'POST') {
          if (!lookup()) return;
          const input = await readJson(req, MAX_REFINE_BODY);
          const forceField = input.forceField ?? 'auto';
          if (!FORCE_FIELDS.includes(forceField)) return send(400, { error: 'Choose auto, MMFF94 or UFF.', details: [{ code: 'INVALID_FORCE_FIELD', message: 'Choose auto, MMFF94 or UFF.' }] });
          if (input.receptorPdb !== undefined && input.receptorPdb !== null && (typeof input.receptorPdb !== 'string' || !input.receptorPdb.trim() || Buffer.byteLength(input.receptorPdb) > MAX_RECEPTOR))
            return send(400, { error: 'The receptor must be PDB text of at most 5 MB.', details: [{ code: 'INVALID_RECEPTOR', message: 'The receptor must be PDB text of at most 5 MB.' }] });
          const found = lookup(); // re-check after the body: the result may have been replaced
          if (!found) return;
          const status = await refinementStatus();
          if (!status.available) return send(503, { error: status.reason, code: 'REFINEMENT_UNAVAILABLE' });
          if (refining) return send(503, { error: 'Another refinement is running. Please retry shortly.', code: 'REFINEMENT_BUSY' });
          const client = disconnectSignal(res);
          refining = true;
          let refinement;
          try {
            const { detail } = found.entry;
            refinement = await refine.refineProduct({ sdf: detail.sdf, fixedAtoms: detail.fixedAtoms, fragmentAtomCount: detail.fragmentAtomCount, forceField, receptorPdb: input.receptorPdb || null, timeoutMs: refineTimeoutMs, signal: client.signal });
          } catch {
            return send(503, { error: 'Refinement could not run.', code: 'REFINEMENT_UNAVAILABLE' });
          } finally { refining = false; client.dispose(); }
          if (refinement?.ok) { found.entry.refinement = refinement; return send(200, { refinement }); }
          if (client.signal.aborted) return; // the caller left; its child was killed
          const first = refinement?.errors?.[0] || {};
          const code = typeof first.code === 'string' && first.code ? first.code : 'REFINEMENT_FAILED';
          return send(refinementFailureStatus(code), { error: first.message || 'Refinement failed.', code, details: refinement?.errors || [] });
        }
      }
      return send(404, { error: 'Route not found' });
    } catch (error) {
      if (error instanceof HttpError) return send(error.status, error.body);
      return send(500, { error: 'Linker service error.', code: 'LINK_FRAGMENTS_UNAVAILABLE' });
    }
  });
  server.jobs = jobs;
  server.on('close', () => { jobs.close().finally(() => db.close()); });
  return server;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const indexPath = process.env.LINKER_INDEX_PATH;
  if (!indexPath) throw new Error('LINKER_INDEX_PATH is required');
  const server = await createLinkerServer({ indexPath });
  server.listen(Number(process.env.PORT || 8374), '127.0.0.1', () => console.log('Link Fragments listening on loopback'));
}
