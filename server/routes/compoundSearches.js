import express from 'express';

// Home search history. Validation is 400, a missing entry 404, storage
// problems 503 — never 401, which the client treats as a dead session.
export function createCompoundSearchesRouter({ store, middleware = [] }) {
  const router = express.Router();
  router.use(...middleware);
  const handle = (fn) => async (req, res) => {
    try { await fn(req, res); }
    catch (error) {
      if (error.status) return res.status(error.status).json({ error: error.message, code: error.code });
      // Database errors can contain query structures; do not log or relay them.
      res.status(503).json({ error: 'Search history is temporarily unavailable.' });
    }
  };
  router.get('/', handle(async (req, res) => res.json(await store.list({ user: req.user, limitRaw: req.query.limit, search: req.query.search }))));
  router.post('/', handle(async (req, res) => res.status(201).json({ search: await store.record({ user: req.user, payload: req.body }) })));
  router.delete('/:searchId', handle(async (req, res) => {
    if (!await store.remove({ user: req.user, searchId: req.params.searchId })) return res.status(404).json({ error: 'Saved search not found.' });
    res.json({ ok: true });
  }));
  return router;
}
