import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../index.js', import.meta.url), 'utf8');
const start = source.indexOf("app.get('/api/simulation/:simulationKey/admet'");
const route = source.slice(start, source.indexOf('\n});', start) + 4);
let handler, simulation, queued = 0;
const noop = () => {};
const dependencies = {
  app: { get(...args) { handler = args.at(-1); } },
  ensureMongoConnected: noop, authenticateToken: noop, requireActiveUser: noop,
  buildTenantFilter: () => ({ companyId: 'owned-company' }),
  client: { db: () => ({ collection: () => ({ async findOne(query) { assert.equal(query.companyId, 'owned-company'); return simulation; } }) }) },
  createAdmetTask: async () => { queued++; return { taskId: 'fixture', estimatedProcessingTime: 1 }; },
};
new Function(...Object.keys(dependencies), route)(...Object.values(dependencies));
async function invoke() {
  const res = { code: 200, status(n) { this.code = n; return this; }, json(body) { this.body = body; return this; } };
  await handler({ params: { simulationKey: 'owned' }, user: { username: 'test', companyId: 'owned-company' } }, res);
  return res;
}
const original = process.env.ADMET_CALLBACK_SECRET;
try {
  delete process.env.ADMET_CALLBACK_SECRET;
  simulation = null;
  assert.equal((await invoke()).code, 404, 'ownership precedes availability');
  simulation = { simulationKey: 'owned', smiles: 'CCO' };
  const unavailable = await invoke();
  assert.equal(unavailable.code, 503);
  assert.equal(unavailable.body.code, 'SERVICE_NOT_CONFIGURED');
  assert.equal(queued, 0);
  simulation.admet = { prediction: 1 };
  const saved = await invoke();
  assert.equal(saved.code, 200);
  assert.deepEqual(saved.body.admet, simulation.admet);
  assert.equal(queued, 0);
  delete simulation.admet;
  process.env.ADMET_CALLBACK_SECRET = 'fixture-secret-not-a-credential';
  assert.equal((await invoke()).code, 200);
  assert.equal(queued, 1, 'configured pipeline keeps its existing queue path');
  console.log('PASS ADMET ownership, unavailable zero-enqueue, saved results, configured queue');
} finally {
  if (original === undefined) delete process.env.ADMET_CALLBACK_SECRET;
  else process.env.ADMET_CALLBACK_SECRET = original;
}
