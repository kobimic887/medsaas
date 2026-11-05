import express from 'express';

export function createFoldingHistoryRouter({ store, middleware = [] }) {
  const router = express.Router();
  router.use(...middleware);
  const handle = fn => async (req, res) => {
    try { await fn(req, res); }
    catch (error) {
      if (error.status) return res.status(error.status).json({ error: error.message, code: error.code });
      // Database errors can contain record contents; do not log or relay them.
      res.status(503).json({ error: 'Prediction history is temporarily unavailable.' });
    }
  };
  // Independent of /staging/status so the normal app can discover history too.
  router.get('/status', (_req, res) => res.json({ historyAvailable: true }));
  router.get('/', handle(async (req, res) => res.json(await store.list({ user: req.user,
    pageRaw: req.query.page, pageSizeRaw: req.query.pageSize, search: req.query.search }))));
  router.post('/', handle(async (req, res) => res.status(201).json({ run: await store.create({ user: req.user, payload: req.body }) })));
  router.get('/:runId', handle(async (req, res) => {
    const run = await store.get({ user: req.user, runId: req.params.runId });
    if (!run) return res.status(404).json({ error: 'Run not found.' });
    res.json({ run });
  }));
  router.patch('/:runId', handle(async (req, res) => {
    const run = await store.rename({ user: req.user, runId: req.params.runId, name: req.body?.name });
    if (!run) return res.status(404).json({ error: 'Run not found.' });
    res.json({ run });
  }));
  router.delete('/:runId', handle(async (req, res) => {
    if (!await store.remove({ user: req.user, runId: req.params.runId })) return res.status(404).json({ error: 'Run not found.' });
    res.json({ ok: true });
  }));
  router.get('/:runId/blob/:index', handle(async (req, res) => {
    const run = await store.get({ user: req.user, runId: req.params.runId });
    const index = /^\d+$/.test(req.params.index) ? Number(req.params.index) : -1;
    const blob = run?.structuresWithText?.[index];
    if (!blob) return res.status(404).json({ error: 'Structure not found.' });
    const safe = value => String(value).replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 120);
    const ext = blob.format === 'mmcif' ? 'cif' : 'pdb';
    res.set('Content-Type', blob.format === 'mmcif' ? 'chemical/x-mmcif' : 'chemical/x-pdb');
    res.set('Content-Disposition', `attachment; filename="${safe(run.name)}-${safe(blob.name)}.${ext}"`);
    res.send(blob.text);
  }));
  return router;
}
