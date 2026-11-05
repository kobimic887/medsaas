// Exercise the REAL normal/full-staging app against ephemeral Mongo, never Atlas.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import net from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { MongoClient } from 'mongodb';
import { MongoMemoryServer } from 'mongodb-memory-server';
import jwt from 'jsonwebtoken';

const memory = await MongoMemoryServer.create();
const mongo = await new MongoClient(memory.getUri('fold_history_test')).connect();
const db = mongo.db();
const socket = net.createServer().listen(0, '127.0.0.1');
await once(socket, 'listening');
const port = socket.address().port;
await new Promise(resolve => socket.close(resolve));
const base = `http://127.0.0.1:${port}`;
const secret = 'fold-history-test-jwt-secret-never-use-live';
let child;
let output = '';
const start = async () => {
  child = spawn(process.env.SERVER_RUNTIME === 'node' ? process.execPath : (process.env.BUN_PATH || `${process.env.HOME}/.bun/bin/bun`), ['index.js'], {
    cwd: new URL('..', import.meta.url), env: { ...process.env, PORT: String(port), BIND_HOST: '127.0.0.1',
      MONGODB_URI: memory.getUri('fold_history_test'), JWT_SECRET: secret,
      PYXIS_STAGING_MODE: 'true', PYXIS_DEMO_MODE: 'false', FRONTEND_DIST: '',
      STRIPE_SECRET_KEY: 'sk_test_dummy', NODE_ENV: 'test',
      NVIDIA_OPENFOLD_API_KEY: '', NVIDIA_OPENFOLD_API_KEYS: '', }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', data => { output += data; });
  child.stderr.on('data', data => { output += data; });
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`${base}/health`)).ok) return; } catch {}
    if (child.exitCode !== null) throw Error(output);
    await delay(100);
  }
  throw Error('Server startup timed out: '+output);
};
const stop = async () => { if (child && child.exitCode === null) { const exited = once(child, 'exit'); child.kill('SIGTERM'); await exited; } };
const alice = { username: 'fold-alice', userId: 'alice-id', companyId: 'co-a' };
const bob = { username: 'fold-bob', userId: 'bob-id', companyId: 'co-a' };
const eve = { username: 'fold-eve', userId: 'alice-id', companyId: 'co-b' };
const solo = { username: 'fold-solo', userId: 'solo-id' };
const disabled = { username: 'fold-disabled', userId: 'disabled-id' };
const call = (path = '', { user = alice, method = 'GET', body } = {}) => fetch(`${base}/api/folding-history${path}`, {
  method, headers: { ...(user ? { Authorization: 'Bearer '+jwt.sign(user, secret) } : {}), 'Content-Type': 'application/json' },
  body: body ? JSON.stringify(body) : undefined,
});
const coordinates = 'HEADER    SAVED PREDICTION\nATOM      1  CA  GLY A   1       0.000   0.000   0.000\nEND\n';
const payload = { name: 'Complex [A]', provider: 'openfold3-nvidia', request: { requestId: 'complex-a', entities: [{ id: 'A', type: 'protein', sequence: 'GGG', length: 3 }] },
  structures: [{ name: 'model-1', format: 'pdb', text: coordinates }, { name: 'model-2', format: 'mmcif', text: 'data_saved\n#\n' }] };
try {
  await db.collection('companies').insertMany([{ companyId: 'co-a', slug: 'co-a', active: true }, { companyId: 'co-b', slug: 'co-b', active: true }]);
  await db.collection('users').insertMany([alice, bob, eve, solo, disabled].map(user => ({ ...user, active: user !== disabled, simulationTokens: 7 })));
  await start();
  assert.equal((await call('', { user: null })).status, 401);
  assert.equal((await call('', { user: disabled })).status, 403);
  let response = await call('', { method: 'POST', body: payload });
  assert.equal(response.status, 201, await response.clone().text());
  const runId = (await response.json()).run.runId;
  let list = await (await call('?search=%5BA%5D&pageSize=1')).json();
  assert.equal(list.total, 1);
  assert.equal(list.pageSize, 1);
  assert(!JSON.stringify(list).includes('HEADER'));
  assert(!('entities' in list.items[0]));
  assert.equal((await (await call('?search=.*')).json()).total, 0, 'search is literal, not injected regex');
  for (const user of [bob, eve]) {
    assert.equal((await (await call('', { user })).json()).total, 0);
    for (const [path, method, body] of [[`/${runId}`, 'GET'], [`/${runId}/blob/0`, 'GET'], [`/${runId}`, 'PATCH', { name: 'stolen' }], [`/${runId}`, 'DELETE']]) {
      assert.equal((await call(path, { user, method, body })).status, 404, 'both ownership clauses apply to '+method+path);
    }
  }
  assert.equal((await (await call(`/${runId}/blob/0`)).text()), coordinates);
  response = await call(`/${runId}/blob/1`);
  assert.match(response.headers.get('content-type'), /mmcif/);
  assert.equal(await response.text(), 'data_saved\n#\n');
  assert.equal((await call(`/${runId}/blob/-1`)).status, 404);
  assert.equal((await call(`/${runId}`, { method: 'PATCH', body: { name: 'Renamed' } })).status, 200);
  const before = await db.collection('folding_history').countDocuments();
  assert.equal((await call('', { method: 'POST', body: { ...payload, name: '' } })).status, 400);
  assert.equal((await call('', { method: 'POST', body: { ...payload, structures: [{ text: 'x'.repeat(3 * 1024 * 1024 + 1) }] } })).status, 413);
  assert.equal(await db.collection('folding_history').countDocuments(), before, 'invalid saves persist nothing');
  assert.equal((await call('', { user: solo, method: 'POST', body: payload })).status, 201);
  assert.equal((await (await call('', { user: solo })).json()).total, 1);
  await stop();
  await start();
  const reopened = (await (await call(`/${runId}`)).json()).run;
  assert.equal(reopened.name, 'Renamed');
  assert.equal(reopened.structuresWithText[0].text, coordinates, 'coordinates survive app restart');
  assert.equal(reopened.entities[0].sequence, 'GGG');
  assert.equal((await db.collection('users').findOne({ username: alice.username })).simulationTokens, 7, 'history never charges prediction credits');
  assert.equal((await call(`/${runId}`, { method: 'DELETE' })).status, 200);
  assert.equal((await call(`/${runId}`)).status, 404);
  console.log('✓ full staging folding history: real routes, save/list/search/reopen/download/rename/delete, restart durability, private ownership, atomic bounds, active-user auth and no credit charge');
} finally {
  await stop(); await mongo.close(); await memory.stop();
}
