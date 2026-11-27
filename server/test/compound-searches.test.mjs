// Home search history against ephemeral Mongo, never Atlas: uniqueness,
// ownership (user AND company), validation status codes and bounded storage.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import express from 'express';
import { MongoClient } from 'mongodb';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createCompoundSearchesRouter } from '../routes/compoundSearches.js';
import { CompoundSearchStore, SEARCH_HISTORY_MAX_PER_OWNER, normalizeSearchRecord } from '../utils/compoundSearchStore.js';

const memory = await MongoMemoryServer.create();
const mongo = await new MongoClient(memory.getUri('compound_search_test')).connect();
const collection = mongo.db().collection('compound_searches');
const store = new CompoundSearchStore(() => collection);

const users = {
  alice: { userId: 'u-alice', username: 'alice', companyId: 'c-1' },
  aliceOtherCompany: { userId: 'u-alice', username: 'alice', companyId: 'c-2' },
  bob: { userId: 'u-bob', username: 'bob', companyId: 'c-1' },
};
const app = express();
app.use(express.json());
// Stand-in for authenticateToken: the test names the caller in a header.
const auth = (req, res, next) => {
  const user = users[req.get('x-test-user')];
  if (!user) return res.status(401).json({ error: 'no session' });
  req.user = user;
  next();
};
app.use('/api/compound-searches', createCompoundSearchesRouter({ store, middleware: [auth] }));
const server = app.listen(0, '127.0.0.1');
await once(server, 'listening');
const base = `http://127.0.0.1:${server.address().port}/api/compound-searches`;
const call = (user, method, path = '', body) => fetch(`${base}${path}`, {
  method,
  headers: { 'x-test-user': user, ...(body ? { 'content-type': 'application/json' } : {}) },
  body: body ? JSON.stringify(body) : undefined,
}).then(async (response) => ({ status: response.status, body: await response.json() }));

let passed = 0;
const check = async (name, fn) => { await fn(); passed += 1; console.log(`  PASS ${name}`); };

try {
  const paracetamol = { source: 'stock', mode: 'similarity', queries: ['CC(=O)Nc1ccc(O)cc1'], settings: { threshold: 0.7, fingerprint: 'morgan', metric: 'tanimoto' } };

  await check('a successful search is stored for its owner', async () => {
    const created = await call('alice', 'POST', '', paracetamol);
    assert.equal(created.status, 201);
    assert.equal(created.body.search.runCount, 1);
    assert.deepEqual(created.body.search.queries, paracetamol.queries);
  });

  await check('re-running the same search updates it instead of duplicating', async () => {
    const again = await call('alice', 'POST', '', { ...paracetamol, queries: ['  CC(=O)Nc1ccc(O)cc1  '], settings: { threshold: 0.5 } });
    assert.equal(again.body.search.runCount, 2);
    assert.equal(again.body.search.settings.threshold, 0.5);
    const list = await call('alice', 'GET');
    assert.equal(list.body.total, 1);
  });

  await check('another collection or search type is a distinct entry, newest first', async () => {
    await call('alice', 'POST', '', { ...paracetamol, mode: 'exact' });
    await call('alice', 'POST', '', { ...paracetamol, source: 'multi:stock,real' });
    const list = await call('alice', 'GET');
    assert.equal(list.body.total, 3);
    assert.equal(list.body.items[0].source, 'multi:stock,real');
  });

  await check('history is private to the same user AND company', async () => {
    assert.equal((await call('bob', 'GET')).body.total, 0);
    assert.equal((await call('aliceOtherCompany', 'GET')).body.total, 0);
    const [entry] = (await call('alice', 'GET')).body.items;
    assert.equal((await call('bob', 'DELETE', `/${entry.searchId}`)).status, 404);
    assert.equal((await call('alice', 'GET')).body.total, 3);
  });

  await check('owners delete their own entries', async () => {
    const [entry] = (await call('alice', 'GET')).body.items;
    assert.equal((await call('alice', 'DELETE', `/${entry.searchId}`)).status, 200);
    assert.equal((await call('alice', 'GET')).body.total, 2);
  });

  await check('text search matches stored queries literally', async () => {
    const found = await call('alice', 'GET', `?search=${encodeURIComponent('c1ccc(O)')}`);
    assert.equal(found.body.total, 2);
    assert.equal((await call('alice', 'GET', '?search=xyz')).body.total, 0);
  });

  await check('invalid records are 400, never 401', async () => {
    for (const bad of [
      { ...paracetamol, source: 'asinex' },
      { ...paracetamol, source: 'multi:stock,stock' },
      { ...paracetamol, mode: 'bas' },
      { ...paracetamol, queries: [] },
      { ...paracetamol, queries: ['   '] },
      { ...paracetamol, queries: Array.from({ length: 21 }, (_, i) => `C${i}`) },
      { ...paracetamol, queries: ['C'.repeat(4001)] },
    ]) {
      const response = await call('alice', 'POST', '', bad);
      assert.equal(response.status, 400, JSON.stringify(bad).slice(0, 80));
    }
  });

  await check('unknown settings are dropped, valid ones kept', async () => {
    const record = normalizeSearchRecord({ ...paracetamol, settings: { threshold: 2, fingerprint: 'Morgan!', metric: 'dice', injected: { $gt: 1 } } });
    assert.deepEqual(record.settings, { metric: 'dice' });
  });

  await check('each owner keeps at most the newest entries', async () => {
    const bulk = Array.from({ length: SEARCH_HISTORY_MAX_PER_OWNER + 3 }, (_, i) => ({
      ownerUserId: 'u-bulk', ownerCompanyId: 'c-1', key: `k${i}`, searchId: `s${i}`,
      source: 'stock', mode: 'similarity', queries: [`C${i}`], settings: {}, runCount: 1,
      createdAt: new Date(2026, 0, 1, 0, i).toISOString(), lastRunAt: new Date(2026, 0, 1, 0, i).toISOString(),
    }));
    await collection.insertMany(bulk);
    await store.record({ user: { userId: 'u-bulk', username: 'bulk', companyId: 'c-1' }, payload: paracetamol });
    assert.equal(await collection.countDocuments({ ownerUserId: 'u-bulk' }), SEARCH_HISTORY_MAX_PER_OWNER);
    assert.equal(await collection.countDocuments({ ownerUserId: 'u-bulk', key: 'k0' }), 0);
  });

  await check('storage failures are 503 without database details', async () => {
    const failing = express();
    failing.use(express.json());
    failing.use('/x', createCompoundSearchesRouter({ store: { list: async () => { throw new Error('secret query CCO'); } }, middleware: [auth] }));
    const failingServer = failing.listen(0, '127.0.0.1');
    await once(failingServer, 'listening');
    const response = await fetch(`http://127.0.0.1:${failingServer.address().port}/x`, { headers: { 'x-test-user': 'alice' } });
    const body = await response.json();
    failingServer.close();
    assert.equal(response.status, 503);
    assert.ok(!JSON.stringify(body).includes('CCO'));
  });

  console.log(`compound search history: ${passed} passed`);
} finally {
  server.close();
  await mongo.close();
  await memory.stop();
}
