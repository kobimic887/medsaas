import { createHash } from 'node:crypto';
import express from 'express';
import { parseSdf } from '../../services/link-fragments/sdf.mjs';

const MAX_SDF_BYTES = 800000;
const MAX_RECEPTOR_BYTES = 5 * 1024 * 1024;
// A saved job may include its <=5 MB receptor and <=800 KB query, in addition
// to bounded result summaries. Keep the relay bounded without dropping history.
const MAX_UPSTREAM_BYTES = 8 * 1024 * 1024;
// refine must exceed the service's Python child limit (90 s) and stay below the
// browser's REFINE_REQUEST_TIMEOUT_MS (150 s) so a timeout arrives as a coded answer.
export const LINK_FRAGMENTS_TIMEOUTS = Object.freeze({ status: 5000, inspect: 20000, jobs: 20000, refine: 140000 });
const TIMEOUTS = LINK_FRAGMENTS_TIMEOUTS;
const JOB_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RESULT_ID = /^\d{1,12}-\d{1,4}-\d{1,4}$/;
const FORCE_FIELDS = ['auto', 'MMFF94', 'UFF'];
const unavailable = (message = 'Link Fragments is temporarily unavailable.') => ({ available: false, error: message, code: 'LINK_FRAGMENTS_UNAVAILABLE' });

class RelayError extends Error {
  constructor(status, body) { super(body.error); this.status = status; this.body = body; }
}
class InputError extends Error {}

// The scientific service scopes jobs by this key. It is derived only from the
// verified session (never a client header), so users cannot read each other's
// jobs; company is part of the key because usernames are only unique per company.
export function linkFragmentsOwnerKey(user) {
  return createHash('sha256').update(`${user?.companyId == null ? '' : String(user.companyId)}\0${String(user.username)}`).digest('hex');
}

async function readLimited(response, max) {
  if (Number(response.headers?.get?.('content-length')) > max) throw new RelayError(502, unavailable('Link Fragments returned an oversized response.'));
  if (!response.body?.getReader) {
    const text = await response.text();
    if (Buffer.byteLength(text, 'utf8') > max) throw new RelayError(502, unavailable('Link Fragments returned an oversized response.'));
    return text;
  }
  const reader = response.body.getReader();
  const chunks = []; let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) { await reader.cancel().catch(() => {}); throw new RelayError(502, unavailable('Link Fragments returned an oversized response.')); }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks).toString('utf8');
}

// Upstream credential refusal is not the browser session: 401 becomes 502 so
// the client interceptor never logs the user out. Server errors become 502;
// validation, ownership (404), queue/owner-busy (429), busy/unavailable (503)
// and coded timeouts such as REFINEMENT_TIMEOUT (504) pass through with their body.
export const relayStatus = status => status === 401 || (status >= 500 && status !== 503 && status !== 504) ? 502 : status;

const queryFragments = sdf => {
  if (typeof sdf !== 'string' || !sdf.trim() || Buffer.byteLength(sdf, 'utf8') > MAX_SDF_BYTES) throw new InputError('Upload a two-fragment 3D SDF smaller than 800 KB.');
  let fragments;
  try { fragments = parseSdf(sdf); } catch (error) { throw new InputError(error.message || 'Invalid 3D SDF.'); }
  if (fragments.length !== 2) throw new InputError('Exactly two SDF molecule records are required.');
  if (fragments.some(f => f.atoms.length > 200 || f.atoms.length < 2)) throw new InputError('Each fragment must contain 2–200 atoms.');
  if (fragments.some(f => !f.is3D)) throw new InputError('Each fragment must be marked as 3D in its SDF header.');
  return fragments;
};
const isHydrogen = atom => ['H', 'D', 'T'].includes(atom?.element);
const receptorInput = value => {
  if (typeof value !== 'string' || !value.trim() || Buffer.byteLength(value, 'utf8') > MAX_RECEPTOR_BYTES) throw new InputError('The receptor must be a non-empty PDB text of at most 5 MB.');
  return value;
};
const bondedHydrogens = (fragment, index) => fragment.bonds.flatMap(b => b.a === index ? [b.b] : b.b === index ? [b.a] : []).filter(j => isHydrogen(fragment.atoms[j])).map(j => j + 1).sort((a, b) => a - b);

// Selections keep original atom numbering: an integer (implicit H preferred,
// else the recommended explicit H) or {atom, hydrogenAtom} naming a bonded H.
function attachmentSelections(value, fragments) {
  if (!Array.isArray(value) || value.length !== 2) throw new InputError('Select one attachment atom in each fragment.');
  return value.map((selection, i) => {
    const fragment = fragments[i];
    const inRange = n => Number.isInteger(n) && n >= 1 && n <= fragment.atoms.length;
    const atom = typeof selection === 'object' && selection !== null && !Array.isArray(selection) ? selection.atom : selection;
    if (!inRange(atom)) throw new InputError(`Fragment ${i + 1} attachment atom must be an atom number from 1 to ${fragment.atoms.length}.`);
    if (isHydrogen(fragment.atoms[atom - 1])) throw new InputError(`Fragment ${i + 1} atom ${atom} is a hydrogen; select the heavy atom it is bonded to.`);
    if (typeof selection !== 'object') return atom;
    if (selection.hydrogenAtom == null) return { atom };
    if (!inRange(selection.hydrogenAtom) || !bondedHydrogens(fragment, atom - 1).includes(selection.hydrogenAtom)) throw new InputError(`Fragment ${i + 1} hydrogen ${selection.hydrogenAtom} is not an explicit hydrogen bonded to atom ${atom}.`);
    return { atom, hydrogenAtom: selection.hydrogenAtom };
  });
}

function mergeEligibility(fragments, inspected) {
  const upstream = inspected?.fragments;
  if (inspected?.ok === false || !Array.isArray(upstream) || upstream.length !== 2 || upstream.some((f, i) => !Array.isArray(f?.atoms) || f.atoms.length !== fragments[i].atoms.length)) return null;
  return upstream.map(f => new Map(f.atoms.map(a => [a.atom, a])));
}

export function createLinkFragmentsRouter({ baseUrl = '', fetchImpl = fetch } = {}) {
  const router = express.Router();
  const endpoint = String(baseUrl).replace(/\/$/, '');
  const configured = /^https?:\/\//.test(endpoint);
  // Returns {status, body} from the scientific service or throws RelayError.
  const call = async (req, res, path, { body, method = body ? 'POST' : 'GET', timeout = TIMEOUTS.jobs, owner = true } = {}) => {
    if (!configured) throw new RelayError(503, unavailable('Link Fragments is not configured.'));
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeout);
    const abort = () => controller.abort();
    res.once('close', abort);
    try {
      // Headers are built here only; client-sent X-Pyxis-Owner is never forwarded.
      const headers = { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}), ...(owner ? { 'X-Pyxis-Owner': linkFragmentsOwnerKey(req.user) } : {}) };
      const upstream = await fetchImpl(endpoint + path, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: controller.signal });
      const text = await readLimited(upstream, MAX_UPSTREAM_BYTES);
      let value;
      try { value = JSON.parse(text); } catch { throw new RelayError(502, unavailable('Link Fragments returned an invalid response.')); }
      if (value === null || typeof value !== 'object') throw new RelayError(502, unavailable('Link Fragments returned an invalid response.'));
      return { status: relayStatus(upstream.status), body: value };
    } catch (error) {
      if (error instanceof RelayError) throw error;
      throw new RelayError(timedOut ? 504 : 503, unavailable(timedOut ? 'Link Fragments did not answer in time. Please try again.' : undefined));
    } finally { clearTimeout(timer); res.off('close', abort); }
  };
  const handle = fn => async (req, res) => {
    try {
      res.set('Cache-Control', 'no-store');
      const { status, body } = await fn(req, res);
      if (!res.headersSent && !res.destroyed) res.status(status).json(body);
    } catch (error) {
      if (res.headersSent || res.destroyed) return;
      if (error instanceof InputError) return res.status(400).json({ error: error.message, code: 'LINK_FRAGMENTS_INVALID_INPUT' });
      if (error instanceof RelayError) return res.status(error.status).json(error.body);
      console.error('Link Fragments relay failed:', error?.message || error);
      return res.status(502).json(unavailable());
    }
  };
  // Authorization, not session: an authenticated token without a username is
  // 403 so the client never logs out for it.
  const requireOwner = (req, res, next) => {
    if (typeof req.user?.username !== 'string' || !req.user.username) return res.status(403).json({ error: 'Your account cannot own Link Fragments searches.', code: 'LINK_FRAGMENTS_OWNER_UNKNOWN' });
    next();
  };
  const jobPath = req => {
    if (!JOB_ID.test(req.params.id || '')) throw new InputError('Invalid search job id.');
    return `/jobs/${encodeURIComponent(req.params.id.toLowerCase())}`;
  };
  const resultPath = req => {
    if (!RESULT_ID.test(req.params.resultId || '')) throw new InputError('Invalid result id.');
    return `${jobPath(req)}/results/${encodeURIComponent(req.params.resultId)}`;
  };

  router.get('/status', handle((req, res) => call(req, res, '/status', { timeout: TIMEOUTS.status, owner: false })));
  router.post('/inspect', requireOwner, handle(async (req, res) => {
    const sdf = req.body?.sdf;
    const fragments = queryFragments(sdf);
    let checked = null; let eligibilityError = '';
    try {
      const { status, body } = await call(req, res, '/inspect', { body: { sdf }, timeout: TIMEOUTS.inspect });
      // The engine refusing the upload means a search would fail too: report it now.
      if (status === 400 || (status === 200 && body.ok === false)) {
        const errors = Array.isArray(body.errors) ? body.errors : Array.isArray(body.details) ? body.details : [];
        return { status: 400, body: { error: (typeof body.error === 'string' && body.error) || errors[0]?.message || 'The linker engine could not read these fragments.', code: 'LINK_FRAGMENTS_INVALID_INPUT', details: errors } };
      }
      if (status === 200) checked = mergeEligibility(fragments, body);
      if (!checked) eligibilityError = 'Attachment eligibility could not be checked right now; the search will validate your choices.';
    } catch (error) {
      if (!(error instanceof RelayError)) throw error;
      eligibilityError = error.status === 503 && !configured ? 'Link Fragments is not configured; attachment eligibility is checked at search time.' : 'Attachment eligibility could not be checked right now; the search will validate your choices.';
    }
    const merged = fragments.map((f, i) => ({
      name: f.title || `Fragment ${i + 1}`,
      atoms: f.atoms.map((a, j) => {
        const site = checked?.[i].get(j + 1);
        return {
          number: j + 1, element: a.element, x: a.xyz[0], y: a.xyz[1], z: a.xyz[2], charge: a.charge || 0, isotope: a.isotope ?? null,
          eligible: site ? Boolean(site.eligible) : null,
          reason: site ? (typeof site.reason === 'string' ? site.reason : null) : null,
          implicitHydrogens: site && Number.isInteger(site.implicitHydrogens) ? site.implicitHydrogens : null,
          explicitHydrogens: site && Array.isArray(site.explicitHydrogens) ? site.explicitHydrogens.filter(Number.isInteger) : isHydrogen(a) ? [] : bondedHydrogens(f, j),
          recommendedHydrogenAtom: site && Number.isInteger(site.recommendedHydrogenAtom) ? site.recommendedHydrogenAtom : null,
          requiresHydrogenSelection: site ? Boolean(site.requiresHydrogenSelection) : false,
        };
      }),
    }));
    return { status: 200, body: { fragments: merged, eligibility: checked ? 'checked' : 'unavailable', ...(checked ? {} : { eligibilityError }) } };
  }));
  router.post('/receptor/inspect', requireOwner, handle((req, res) => {
    const sdf = req.body?.sdf;
    queryFragments(sdf);
    const receptorPdb = receptorInput(req.body?.receptorPdb);
    return call(req, res, '/receptor/inspect', { body: { sdf, receptorPdb }, timeout: TIMEOUTS.inspect });
  }));
  router.post('/jobs', requireOwner, handle((req, res) => {
    const { sdf, maxRmsd = 0.75, limit = 20, receptorPdb } = req.body || {};
    const fragments = queryFragments(sdf);
    const attachments = attachmentSelections(req.body?.attachments, fragments);
    if (typeof maxRmsd !== 'number' || !Number.isFinite(maxRmsd) || maxRmsd < 0.1 || maxRmsd > 1) throw new InputError('Maximum attachment fit RMSD must be between 0.1 and 1 Å.');
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new InputError('Keep between 1 and 50 products.');
    return call(req, res, '/jobs', { body: { sdf, attachments, maxRmsd, limit, ...(receptorPdb != null ? { receptorPdb: receptorInput(receptorPdb) } : {}) } });
  }));
  router.get('/jobs', requireOwner, handle((req, res) => call(req, res, '/jobs')));
  router.get('/jobs/:id', requireOwner, handle((req, res) => call(req, res, jobPath(req) + (req.query.input === '0' ? '?input=0' : ''))));
  router.post('/jobs/:id/cancel', requireOwner, handle((req, res) => call(req, res, `${jobPath(req)}/cancel`, { method: 'POST', body: {} })));
  router.get('/jobs/:id/results/:resultId', requireOwner, handle((req, res) => call(req, res, resultPath(req))));
  router.post('/jobs/:id/results/:resultId/refine', requireOwner, handle((req, res) => {
    const path = `${resultPath(req)}/refine`;
    const { forceField = 'auto', receptorPdb } = req.body || {};
    if (!FORCE_FIELDS.includes(forceField)) throw new InputError('Force field must be Auto, MMFF94 or UFF.');
    if (receptorPdb != null && (typeof receptorPdb !== 'string' || !receptorPdb.trim() || Buffer.byteLength(receptorPdb, 'utf8') > MAX_RECEPTOR_BYTES)) throw new InputError('The receptor must be a non-empty PDB text of at most 5 MB.');
    return call(req, res, path, { body: { forceField, ...(receptorPdb != null ? { receptorPdb } : {}) }, timeout: TIMEOUTS.refine });
  }));
  return router;
}
