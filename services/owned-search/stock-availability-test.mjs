// Scientific-host side of the opt-in weekly stock availability snapshot:
// validation, activation/rollback, last-good retention, fail-closed cold start
// and the /stock-availability routes of the combined service. Fixtures only.
// Run: bun --cwd=server run test:owned-search (from the repository root)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import http from 'node:http';
import fs from 'node:fs';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createCombinedServer } from './combined.mjs';
import {
  POINTER_FILE, StockSnapshotError, activateSnapshot, createStockAvailabilityHandler, createStockAvailabilityStore,
  deactivateSnapshot, loadSnapshot, readPointer,
} from './stockAvailability.mjs';
import {
  STOCK_MIN_OFFER_MG, STOCK_SNAPSHOT_FORMAT, STOCK_SNAPSHOT_HEADER, createStockAvailability, normalizeStockCode,
} from '../../server/utils/stockAvailability.js';
import { MIN_OFFER_MG, SNAPSHOT_FORMAT, SNAPSHOT_HEADER, runSnapshot } from '../../scripts/stock-availability-snapshot.mjs';

const sha256 = (text) => createHash('sha256').update(text).digest('hex');
const tmp = () => mkdtempSync(path.join(tmpdir(), 'stock-availability-svc-'));
const csvOf = (rows) => `${SNAPSHOT_HEADER.join(',')}\n${rows.map(([code, mg]) => `${code},${mg},${mg},1`).join('\n')}\n`;

/** Hand-built snapshot in the tool's layout: <dir>/<date> → revision directory. */
function writeSnapshot(dir, date, rows, { manifest = {}, csv = csvOf(rows), csvOverride } = {}) {
  const revision = path.join(dir, `.${date}.revision-${Math.random().toString(36).slice(2)}`);
  mkdirSync(revision, { recursive: true });
  const body = csvOverride ?? csv;
  writeFileSync(path.join(revision, 'availability.csv'), body);
  writeFileSync(path.join(revision, 'manifest.json'), JSON.stringify({
    format: SNAPSHOT_FORMAT, asOf: date, snapshotSha256: sha256(csv), compounds: rows.length, ...manifest,
  }));
  try { fs.rmSync(path.join(dir, date), { force: true, recursive: true }); } catch { /* none yet */ }
  symlinkSync(path.basename(revision), path.join(dir, date));
  return { date, snapshotSha256: sha256(csv), revision };
}
const GOOD = [['BAS 00000001', 7], ['LAS 00000002', 0.5], ['ASN 00000003', 0], ['PRO 00000004', 120.25]];
const lookup = (store, ...codes) => store.lookup(codes);

test('format constants match the snapshot tool the loader consumes', () => {
  assert.equal(STOCK_SNAPSHOT_FORMAT, SNAPSHOT_FORMAT);
  assert.deepEqual([...STOCK_SNAPSHOT_HEADER], [...SNAPSHOT_HEADER]);
  assert.equal(STOCK_MIN_OFFER_MG, MIN_OFFER_MG);
  assert.equal(normalizeStockCode('  bas   02324364 '), 'BAS 02324364');
  for (const value of ['BAS02324364', 'BAS 123', 'RPX', '', null, 5, 'BAS 02324364 EXTRA']) assert.equal(normalizeStockCode(value), null, String(value));
});

test('the real snapshot tool output loads, exclusive vials count and codes are normalized', async () => {
  const dir = tmp();
  try {
    let vialId = 5000;
    const vial = (code, mg, extra = {}) => `\n  X\n\n  1  0  0  0  0  0            999 V2000\n    0.0 0.0 0.0 C   0  0\nM  END\n${Object.entries({ MAIN_BAS: code, VIAL: String(vialId++), CURRENT_AMOUNT_UM: '10', CURRENT_NETTO_MG: mg, ...extra }).map(([k, v]) => `>  <${k}>\n${v}\n`).join('\n')}\n$$$$\n`;
    const input = path.join(dir, 'STRUCTURES_FullDump_20261102_4.sdf');
    writeFileSync(input, vial('BAS 00000001', '3') + vial('BAS 00000001', '4.5', { EXCLUSIVITY: 'Exclusive' }) + vial('LAS 00000002', '0.5') + vial('PRO 00000004', '9'));
    const { status } = await runSnapshot({ input, outDir: path.join(dir, 'snapshots') });
    assert.equal(status, 'written');
    const activated = await activateSnapshot(path.join(dir, 'snapshots'), '2026-11-02');
    assert.equal(activated.compounds, 3);
    const store = createStockAvailabilityStore({ dir: path.join(dir, 'snapshots'), recheckMs: 0 });
    const answer = await lookup(store, ' bas  00000001', 'LAS 00000002', 'ASN 99999999');
    assert.deepEqual(answer.items, { 'BAS 00000001': 7.5, 'LAS 00000002': 0.5 }, 'an Exclusive vial stays sellable; unknown codes are simply absent');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('no pointer means inactive, and the app keeps imported amounts', async () => {
  const dir = tmp();
  try {
    writeSnapshot(dir, '2026-11-02', GOOD);
    const store = createStockAvailabilityStore({ dir, recheckMs: 0 });
    assert.deepEqual(await lookup(store, 'BAS 00000001'), { state: 'inactive' });
    assert.equal(await readPointer(dir), null);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('activation validates first; an invalid snapshot is refused and cannot replace a good one', async () => {
  const dir = tmp();
  try {
    writeSnapshot(dir, '2026-11-02', GOOD);
    await activateSnapshot(dir, '2026-11-02');
    const pointerBefore = readFileSync(path.join(dir, POINTER_FILE), 'utf8');
    const store = createStockAvailabilityStore({ dir, recheckMs: 0 });
    assert.equal((await lookup(store, 'BAS 00000001')).items['BAS 00000001'], 7);

    const cases = {
      'wrong format': () => writeSnapshot(dir, '2026-11-09', GOOD, { manifest: { format: 'other-v9' } }),
      'checksum mismatch': () => writeSnapshot(dir, '2026-11-09', GOOD, { csvOverride: csvOf([...GOOD, ['BAS 00000009', 99]]) }),
      'wrong header': () => { const csv = csvOf(GOOD).replace('VIALS', 'COUNT'); return writeSnapshot(dir, '2026-11-09', GOOD, { csv }); },
      'duplicate code': () => writeSnapshot(dir, '2026-11-09', [...GOOD, ['BAS 00000001', 1]]),
      'row count differs from manifest': () => writeSnapshot(dir, '2026-11-09', GOOD, { manifest: { compounds: 99 } }),
      'manifest date differs': () => writeSnapshot(dir, '2026-11-09', GOOD, { manifest: { asOf: '2026-11-08' } }),
      'non-canonical code': () => writeSnapshot(dir, '2026-11-09', [['bas 00000001', 1]]),
      'negative amount': () => writeSnapshot(dir, '2026-11-09', [['BAS 00000001', -1]]),
      'non-numeric amount': () => writeSnapshot(dir, '2026-11-09', [['BAS 00000001', 'NaN']]),
      'empty snapshot': () => writeSnapshot(dir, '2026-11-09', []),
      'missing newline at end': () => { const csv = csvOf(GOOD).trimEnd(); return writeSnapshot(dir, '2026-11-09', GOOD, { csv }); },
    };
    for (const [name, build] of Object.entries(cases)) {
      build();
      await assert.rejects(activateSnapshot(dir, '2026-11-09'), StockSnapshotError, name);
      assert.equal(readFileSync(path.join(dir, POINTER_FILE), 'utf8'), pointerBefore, `${name}: pointer untouched`);
      assert.equal((await lookup(store, 'BAS 00000001')).items['BAS 00000001'], 7, `${name}: last good keeps serving`);
    }
    await assert.rejects(activateSnapshot(dir, '2026-12-31'), /does not exist/);
    await assert.rejects(activateSnapshot(dir, '../escape'), StockSnapshotError);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a hand-edited pointer to a bad snapshot keeps the last good one and reports degradation', async () => {
  const dir = tmp();
  try {
    writeSnapshot(dir, '2026-11-02', GOOD);
    await activateSnapshot(dir, '2026-11-02');
    const store = createStockAvailabilityStore({ dir, recheckMs: 0 });
    assert.equal((await lookup(store, 'BAS 00000001')).state, 'active');
    const bad = writeSnapshot(dir, '2026-11-09', GOOD, { csvOverride: 'garbage\n' });
    writeFileSync(path.join(dir, POINTER_FILE), JSON.stringify({ format: 'pyxis-stock-availability-active-v1', date: '2026-11-09', snapshotSha256: bad.snapshotSha256 }));
    const answer = await lookup(store, 'BAS 00000001');
    assert.equal(answer.state, 'active');
    assert.equal(answer.asOf, '2026-11-02');
    assert.match((await store.status()).degraded, /checksum/);
    writeFileSync(path.join(dir, POINTER_FILE), '{not json');
    assert.equal((await lookup(store, 'BAS 00000001')).state, 'active', 'a damaged pointer also keeps the last good snapshot');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a missing or unmounted snapshot directory fails closed; an existing directory without a pointer is inactive', async () => {
  const dir = tmp();
  try {
    const gone = path.join(dir, 'not-mounted');
    const store = createStockAvailabilityStore({ dir: gone, recheckMs: 0 });
    const answer = await lookup(store, 'BAS 00000001');
    assert.equal(answer.state, 'failed');
    assert.match(answer.error, /directory is missing/);
    mkdirSync(gone);
    assert.deepEqual(await lookup(store, 'BAS 00000001'), { state: 'inactive' }, 'the empty directory is the explicit inactive state');
    // Once good, a vanishing directory keeps serving the last good snapshot and says so.
    writeSnapshot(gone, '2026-11-02', GOOD);
    await activateSnapshot(gone, '2026-11-02');
    assert.equal((await lookup(store, 'BAS 00000001')).state, 'active');
    fs.renameSync(gone, `${gone}.away`);
    assert.equal((await lookup(store, 'BAS 00000001')).state, 'active');
    assert.match((await store.status()).degraded, /directory is missing/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('cold start with an invalid snapshot fails closed instead of reporting inactive', async () => {
  const dir = tmp();
  try {
    const bad = writeSnapshot(dir, '2026-11-02', GOOD, { csvOverride: 'garbage\n' });
    writeFileSync(path.join(dir, POINTER_FILE), JSON.stringify({ format: 'pyxis-stock-availability-active-v1', date: '2026-11-02', snapshotSha256: bad.snapshotSha256 }));
    const store = createStockAvailabilityStore({ dir, recheckMs: 0 });
    const answer = await lookup(store, 'BAS 00000001');
    assert.equal(answer.state, 'failed');
    assert.notEqual(answer.state, 'inactive');
    // Pointer to a date that does not exist: also failed, not inactive.
    writeFileSync(path.join(dir, POINTER_FILE), JSON.stringify({ format: 'pyxis-stock-availability-active-v1', date: '2026-12-01', snapshotSha256: bad.snapshotSha256 }));
    assert.equal((await lookup(store, 'BAS 00000001')).state, 'failed');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('switching the pointer, same-date replacement and rollback are picked up without a restart', async () => {
  const dir = tmp();
  try {
    writeSnapshot(dir, '2026-11-02', [['BAS 00000001', 7]]);
    writeSnapshot(dir, '2026-11-09', [['BAS 00000001', 2], ['BAS 00000005', 40]]);
    await activateSnapshot(dir, '2026-11-02');
    const store = createStockAvailabilityStore({ dir, recheckMs: 0 });
    assert.deepEqual((await lookup(store, 'BAS 00000001', 'BAS 00000005')).items, { 'BAS 00000001': 7 });
    await activateSnapshot(dir, '2026-11-09');
    assert.deepEqual((await lookup(store, 'BAS 00000001', 'BAS 00000005')).items, { 'BAS 00000001': 2, 'BAS 00000005': 40 });
    // The tool's --replace re-points the date at a new revision: pinned checksum means it is NOT live until reactivated.
    writeSnapshot(dir, '2026-11-09', [['BAS 00000001', 99]]);
    const held = await lookup(store, 'BAS 00000001');
    assert.equal(held.items['BAS 00000001'], 2);
    assert.match((await store.status()).degraded, /activate it again/);
    await activateSnapshot(dir, '2026-11-09');
    const replaced = await lookup(store, 'BAS 00000001', 'BAS 00000005');
    assert.deepEqual(replaced.items, { 'BAS 00000001': 99 }, 'a code missing from the new active snapshot is simply absent');
    assert.equal((await store.status()).degraded, undefined);
    await activateSnapshot(dir, '2026-11-02');
    assert.equal((await lookup(store, 'BAS 00000001')).items['BAS 00000001'], 7, 'rollback by activating an older date');
    await deactivateSnapshot(dir);
    assert.deepEqual(await lookup(store, 'BAS 00000001'), { state: 'inactive' }, 'deactivate returns to imported amounts');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a snapshot revision must live inside the snapshot directory', async () => {
  const dir = tmp(); const outside = tmp();
  try {
    const snap = writeSnapshot(outside, '2026-11-02', GOOD);
    symlinkSync(snap.revision, path.join(dir, '2026-11-02'));
    await assert.rejects(loadSnapshot(dir, { date: '2026-11-02', snapshotSha256: snap.snapshotSha256 }), /outside/);
  } finally { rmSync(dir, { recursive: true, force: true }); rmSync(outside, { recursive: true, force: true }); }
});

async function serve(dir) {
  const handler = createStockAvailabilityHandler(dir ? createStockAvailabilityStore({ dir, recheckMs: 0 }) : null);
  const server = createCombinedServer({
    indexHandler: (req, res) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ engine: 'similarity', path: req.url })); },
    graphRequest: async () => { throw new Error('graph is not used here'); },
    stockAvailabilityHandler: handler,
  });
  await new Promise((resolve) => server.listen(0, resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, close: () => new Promise((resolve) => { server.closeAllConnections?.(); server.close(resolve); }) };
}
const post = (base, body) => fetch(`${base}/stock-availability/lookup`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body) });

test('combined service routes /stock-availability and leaves other paths alone', async () => {
  const dir = tmp();
  const server = await serve(dir);
  try {
    assert.deepEqual(await (await fetch(`${server.base}/v1/datasets`)).json(), { engine: 'similarity', path: '/v1/datasets' });
    assert.equal((await fetch(`${server.base}/stock-availability/status`)).status, 200);
    assert.equal((await fetch(`${server.base}/stock-availability/unknown`)).status, 404);
    assert.equal((await fetch(`${server.base}/stock-availability/lookup`)).status, 404, 'lookup is POST only');
    assert.equal((await post(server.base, '{bad')).status, 400);
    assert.equal((await post(server.base, { codes: 'BAS 1' })).status, 400);
    assert.equal((await post(server.base, { codes: [1] })).status, 400);
    assert.equal((await post(server.base, { codes: Array(5001).fill('BAS 00000001') })).status, 400);
    assert.deepEqual(await (await post(server.base, { codes: ['BAS 00000001'] })).json(), { state: 'inactive' });
    assert.equal((await (await fetch(`${server.base}/stock-availability/status`)).json()).configured, true);
  } finally { await server.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('unconfigured service is inactive; a failed snapshot answers 503; the app client reads all three states', async () => {
  const none = await serve(null);
  const dir = tmp();
  const configured = await serve(dir);
  try {
    assert.deepEqual(await (await fetch(`${none.base}/stock-availability/status`)).json(), { configured: false, state: 'inactive' });
    const client = (base) => createStockAvailability({ baseUrl: `${base}/stock-availability` });
    assert.deepEqual(await client(none.base).lookup(['BAS 00000001']), { active: false });

    const bad = writeSnapshot(dir, '2026-11-02', GOOD, { csvOverride: 'garbage\n' });
    writeFileSync(path.join(dir, POINTER_FILE), JSON.stringify({ format: 'pyxis-stock-availability-active-v1', date: '2026-11-02', snapshotSha256: bad.snapshotSha256 }));
    assert.equal((await post(configured.base, { codes: [] })).status, 503);
    await assert.rejects(client(configured.base).lookup(['BAS 00000001']), (error) => error.code === 'STOCK_AVAILABILITY_UNAVAILABLE' && error.status === 503);

    writeSnapshot(dir, '2026-11-09', GOOD);
    await activateSnapshot(dir, '2026-11-09');
    const state = await client(configured.base).lookup(['bas 00000001', 'LAS 00000002', 'ASN 00000003', 'XXX 99999999', 'garbage']);
    assert.equal(state.active, true);
    assert.equal(state.mg('BAS 00000001'), 7);
    assert.equal(state.mg(' bas  00000001'), 7);
    assert.equal(state.mg('ASN 00000003'), 0, 'a recorded zero is present, and unavailable to the offer rules');
    assert.equal(state.mg('XXX 99999999'), null, 'missing from the snapshot');
    assert.equal(state.mg('garbage'), null);
  } finally { await none.close(); await configured.close(); rmSync(dir, { recursive: true, force: true }); }
});
