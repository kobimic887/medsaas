// Lazy companyId / role / active backfill at sign-in.
// Run: bun test/ensure-user-tenant.test.mjs

import assert from 'node:assert/strict';
import { MongoClient, ObjectId } from 'mongodb';
import { MongoMemoryServer } from 'mongodb-memory-server';

import {
  buildTenantBackfillPatch,
  ensureUserTenantOnLogin,
  resolveSoleCompanyId,
} from '../utils/ensureUserTenant.js';

let passed = 0;
const failures = [];

async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failures.push({ name, error });
    console.error(`  ✗ ${name}\n    ${error.message}`);
  }
}

console.log('ensureUserTenant on login\n');

await test('patch assigns sole companyId and defaults role/active', () => {
  assert.deepEqual(
    buildTenantBackfillPatch({ username: 'alice' }, 'co-1'),
    { companyId: 'co-1', role: 'member', active: true },
  );
});

await test('patch leaves existing companyId and role alone', () => {
  assert.deepEqual(
    buildTenantBackfillPatch(
      { username: 'alice', companyId: 'already', role: 'admin', active: false },
      'co-1',
    ),
    {},
  );
});

await test('patch does not invent companyId without a sole tenant', () => {
  assert.deepEqual(
    buildTenantBackfillPatch({ username: 'alice' }, null),
    { role: 'member', active: true },
  );
});

const mongod = await MongoMemoryServer.create();
const client = new MongoClient(mongod.getUri());
await client.connect();
const db = client.db('ensure_tenant_test');
const users = db.collection('users');
const companies = db.collection('companies');

await test('resolveSoleCompanyId returns null for empty and multi-tenant DBs', async () => {
  await companies.deleteMany({});
  assert.equal(await resolveSoleCompanyId(companies), null);

  await companies.insertMany([
    { companyId: 'a', name: 'A' },
    { companyId: 'b', name: 'B' },
  ]);
  assert.equal(await resolveSoleCompanyId(companies), null);
});

await test('ensureUserTenantOnLogin writes companyId when exactly one company exists', async () => {
  await companies.deleteMany({});
  await users.deleteMany({});
  const companyOid = new ObjectId();
  await companies.insertOne({
    _id: companyOid,
    companyId: companyOid.toString(),
    name: 'Pyxis',
  });
  const userOid = new ObjectId();
  await users.insertOne({
    _id: userOid,
    username: 'legacy',
    email: 'legacy@example.test',
  });

  const before = await users.findOne({ _id: userOid });
  const after = await ensureUserTenantOnLogin({
    usersCollection: users,
    companiesCollection: companies,
    user: before,
  });

  assert.equal(after.companyId, companyOid.toString());
  assert.equal(after.role, 'member');
  assert.equal(after.active, true);
  const stored = await users.findOne({ _id: userOid });
  assert.equal(stored.companyId, companyOid.toString());
  assert.equal(stored.companyName, undefined);
  assert.equal(typeof stored.simulationTokens, 'undefined');
});

await test('ensureUserTenantOnLogin is a no-op when companyId already set', async () => {
  await companies.deleteMany({});
  await users.deleteMany({});
  await companies.insertOne({ companyId: 'co-only', name: 'Pyxis' });
  const userOid = new ObjectId();
  await users.insertOne({
    _id: userOid,
    username: 'ready',
    companyId: 'co-already',
    role: 'member',
    active: true,
  });
  const before = await users.findOne({ _id: userOid });
  const after = await ensureUserTenantOnLogin({
    usersCollection: users,
    companiesCollection: companies,
    user: before,
  });
  assert.equal(after.companyId, 'co-already');
  const stored = await users.findOne({ _id: userOid });
  assert.equal(stored.updatedAt, undefined);
});

await client.close();
await mongod.stop();

console.log('\n================================================');
console.log(`Result: ${passed} passed, ${failures.length} failed`);
console.log('================================================');
process.exit(failures.length === 0 ? 0 : 1);
