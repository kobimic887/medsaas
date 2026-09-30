import express from 'express';
import { parseSdf } from '../../services/link-fragments/sdf.mjs';

const MAX_SDF_BYTES = 800000;
export function createLinkFragmentsRouter({ baseUrl = '', fetchImpl = fetch } = {}) {
  const router = express.Router();
  const endpoint = String(baseUrl).replace(/\/$/, '');
  const configured = /^https?:\/\//.test(endpoint);
  const relay = async (_req, res, path, body) => {
    if (!configured) return res.status(503).json({ available: false, error: 'Link Fragments is not configured.', code: 'LINK_FRAGMENTS_UNAVAILABLE' });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), path === '/status' ? 5000 : 45000);
    const abort = () => controller.abort();
    res.once('close', abort);
    try {
      const upstream = await fetchImpl(endpoint + path, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: controller.signal });
      const text = await upstream.text();
      if (text.length > 4000000) throw new Error('Oversized upstream result');
      const value = JSON.parse(text);
      const status = upstream.status === 401 ? 502 : upstream.status;
      return res.status(status).json(value);
    } catch {
      if (!res.destroyed) return res.status(503).json({ available: false, error: 'Link Fragments is temporarily unavailable.', code: 'LINK_FRAGMENTS_UNAVAILABLE' });
    } finally { clearTimeout(timeout); res.off('close', abort); }
  };
  const sdfInput = (req, res) => {
    const sdf = req.body?.sdf;
    if (typeof sdf !== 'string' || !sdf.trim() || Buffer.byteLength(sdf, 'utf8') > MAX_SDF_BYTES) {
      res.status(400).json({ error: 'Upload a two-fragment 3D SDF smaller than 800 KB.' }); return null;
    }
    return sdf;
  };
  const queryFragments = sdf => {
    const fragments = parseSdf(sdf);
    if (fragments.length !== 2) throw new Error('Exactly two SDF molecule records are required.');
    if (fragments.some(f => f.atoms.length > 200 || f.atoms.length < 2)) throw new Error('Each fragment must contain 2–200 atoms.');
    if (fragments.some(f => !f.is3D)) throw new Error('Each fragment must be marked as 3D in its SDF header.');
    return fragments;
  };
  router.get('/status', (req, res) => relay(req, res, '/status'));
  router.post('/inspect', (req, res) => {
    const sdf = sdfInput(req, res); if (!sdf) return;
    try {
      const fragments = queryFragments(sdf);
      res.json({ fragments: fragments.map((f, i) => ({ name: f.title || `Fragment ${i+1}`, atoms: f.atoms.map((a, j) => ({ number: j+1, element: a.element, x: a.xyz[0], y: a.xyz[1], z: a.xyz[2] })) })) });
    } catch (error) { res.status(400).json({ error: error.message || 'Invalid 3D SDF.' }); }
  });
  router.post('/search', (req, res) => {
    const sdf = sdfInput(req, res); if (!sdf) return;
    const atoms = req.body?.attachmentAtoms;
    const maxRmsd = req.body?.maxRmsd ?? 0.75; const limit = req.body?.limit ?? 10;
    if (!Array.isArray(atoms) || atoms.length !== 2 || atoms.some(a => !Number.isInteger(a) || a < 1 || a > 200) || !Number.isFinite(maxRmsd) || maxRmsd < 0.1 || maxRmsd > 1 || !Number.isInteger(limit) || limit < 1 || limit > 20) return res.status(400).json({ error: 'Select an atom in each fragment, RMSD 0.1–1 Å, and 1–20 results.' });
    try {
      const fragments = queryFragments(sdf);
      if (atoms.some((a, i) => a > fragments[i].atoms.length)) throw new Error('Selected atom is outside the fragment.');
    } catch (error) { return res.status(400).json({ error: error.message || 'Invalid 3D SDF.' }); }
    return relay(req, res, '/search', { sdf, attachmentAtoms: atoms, maxRmsd, limit });
  });
  return router;
}
