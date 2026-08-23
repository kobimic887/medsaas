// Dual-shape simulation_logs ownership: legacy nested user.username vs maintained
// top-level username/companyId. Atlas still has chem_beo-shaped rows, so the
// Control Panel list/cache filter must read both. Public stack since 2026-08-23
// is 84 pyxis-web :5174 only — the "coexistence window" was dual-live serving
// (Vite :5173 + maintained :5174), not a current host requirement.
//
// Run: bun test/simulation-logs-tenant.test.mjs

import assert from 'node:assert/strict';
import { MongoClient } from 'mongodb';
import { MongoMemoryServer } from 'mongodb-memory-server';

import {
  buildSimulationLogOwnership,
  buildTenantFilter,
} from '../utils/simulationLogs.js';

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

console.log('simulation_logs dual-shape tenant filter\n');

await test('company user filter ORs companyId with both username shapes', () => {
  assert.deepEqual(
    buildTenantFilter({ username: 'alice', companyId: 'co-1' }),
    {
      $or: [
        { companyId: 'co-1' },
        { username: 'alice' },
        { 'user.username': 'alice' },
      ],
    },
  );
});

await test('username-only user matches maintained and legacy username fields', () => {
  assert.deepEqual(
    buildTenantFilter({ username: 'bob' }),
    {
      $or: [
        { username: 'bob' },
        { 'user.username': 'bob' },
      ],
    },
  );
});

await test('empty identity yields empty filter', () => {
  assert.deepEqual(buildTenantFilter({}), {});
  assert.deepEqual(buildTenantFilter(null), {});
});

await test('ownership dual-writes nested username without JWT fields', () => {
  const ownership = buildSimulationLogOwnership({
    username: 'alice',
    companyId: 'co-1',
    companyName: 'Lab',
    iat: 1,
    exp: 2,
  });
  assert.deepEqual(ownership, {
    username: 'alice',
    companyId: 'co-1',
    companyName: 'Lab',
    user: { username: 'alice' },
  });
  assert.equal('iat' in ownership.user, false);
  assert.equal('exp' in ownership.user, false);
});

const mongod = await MongoMemoryServer.create();
const client = new MongoClient(mongod.getUri());
await client.connect();
const logs = client.db('sim_logs_tenant_test').collection('simulation_logs');

await test('company filter finds legacy nested row and maintained top-level row', async () => {
  await logs.deleteMany({});
  await logs.insertMany([
    {
      simulationKey: 'legacy0000001',
      pdbid: '1cx7',
      smiles: 'CCO',
      user: { username: 'alice' },
      timestamp: new Date('2026-01-01'),
    },
    {
      simulationKey: 'maintained001',
      pdbid: '1cx6',
      smiles: 'CCN',
      username: 'alice',
      companyId: 'co-1',
      companyName: 'Lab',
      timestamp: new Date('2026-02-01'),
    },
    {
      simulationKey: 'otheruser0001',
      pdbid: '1abc',
      smiles: 'CCC',
      user: { username: 'eve' },
      timestamp: new Date('2026-03-01'),
    },
  ]);

  const filter = buildTenantFilter({ username: 'alice', companyId: 'co-1' });
  const keys = (await logs.find(filter).toArray()).map((doc) => doc.simulationKey).sort();
  assert.deepEqual(keys, ['legacy0000001', 'maintained001']);
});

await test('username-only filter finds maintained row that lacks nested user', async () => {
  await logs.deleteMany({});
  await logs.insertOne({
    simulationKey: 'topLevelOnly1',
    username: 'bob',
    companyId: null,
    pdbid: '1cx7',
    smiles: 'CCO',
    timestamp: new Date(),
  });

  // Old maintained reader used only {'user.username': …} and would miss this row.
  const legacyOnly = await logs.find({ 'user.username': 'bob' }).toArray();
  assert.equal(legacyOnly.length, 0);

  const dual = await logs.find(buildTenantFilter({ username: 'bob' })).toArray();
  assert.equal(dual.length, 1);
  assert.equal(dual[0].simulationKey, 'topLevelOnly1');
});

await test('cache lookup with dual filter hits a legacy-shaped prior dock', async () => {
  await logs.deleteMany({});
  await logs.insertOne({
    simulationKey: 'cachedlegacy1',
    pdbid: '1cx7',
    smiles: 'C%23C',
    user: { username: 'carol' },
    timestamp: new Date(),
  });

  const hit = await logs.findOne({
    ...buildTenantFilter({ username: 'carol', companyId: 'co-9' }),
    pdbid: '1cx7',
    smiles: 'C%23C',
  });
  assert.equal(hit?.simulationKey, 'cachedlegacy1');
});

await client.close();
await mongod.stop();

console.log('\n================================================');
console.log(`Result: ${passed} passed, ${failures.length} failed`);
console.log('================================================');
process.exit(failures.length === 0 ? 0 : 1);
