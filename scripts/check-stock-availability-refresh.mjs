#!/usr/bin/env bun
// Scheduled stock availability refresh (scripts/stock-availability-refresh.mjs):
// unchanged / older / invalid / guarded / reverted / activated cases against a local
// fake publisher and the real combined-service stock handler. No network, no host.
import assert from 'node:assert/strict';
import http from 'node:http';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  REFUSED_FLAGS, RefreshRefused, listDumps, refresh,
} from './stock-availability-refresh.mjs';
import {
  POINTER_FILE, activateSnapshot, createStockAvailabilityHandler, createStockAvailabilityStore, readPointer,
} from '../services/owned-search/stockAvailability.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
let seq = 5000;
function vial(code, mg, extra = {}) {
  const tags = { ELE_ID: '1', MAIN_BAS: code, VIAL: String(seq++), BOX_ID: '1', BOX: '16G08', CELL: 'A01', MW_BATCH: '300.1', MW_STRUCTURE: '300.1', IUPAC_NAME: 'x', CURRENT_AMOUNT_UM: '10.0', CURRENT_NETTO_MG: mg, ...extra };
  const data = Object.entries(tags).map(([k, v]) => `>  <${k}>\n${v}\n`).join('\n');
  return `\n  Mrv2403 10262609272D\n\n  1  0  0  0  0  0            999 V2000\n    0.0000    0.0000    0.0000 C   0  0\nM  END\n${data}\n$$$$\n`;
}
// 100 compounds so a 5% loss guard is meaningful.
const codes = Array.from({ length: 100 }, (_, i) => `BAS ${String(10000000 + i)}`);
const sdf = (list, mg = '5.0') => list.map((c) => vial(c, mg)).join('');
const tmp = () => mkdtempSync(path.join(tmpdir(), 'stock-refresh-'));
const zipOf = (dir, name, text) => {
  const sdfFile = path.join(dir, name.replace(/\.zip$/, '.sdf'));
  writeFileSync(sdfFile, text);
  const r = spawnSync('python3', ['-I', '-c', 'import sys,zipfile;z=zipfile.ZipFile(sys.argv[1],"w",zipfile.ZIP_DEFLATED);z.write(sys.argv[2],sys.argv[3]);z.close()', path.join(dir, name), sdfFile, path.basename(sdfFile)]);
  assert.equal(r.status, 0, String(r.stderr));
  rmSync(sdfFile);
  return path.join(dir, name);
};
const dumpName = (date, records) => `STRUCTURES_FullDump_${date.replaceAll('-', '')}_${records}.zip`;

async function fixture({ published = [], activeDate = '2026-10-26' } = {}) {
  const root = tmp(); const dir = path.join(root, 'snapshots'); const pub = path.join(root, 'pub');
  const { mkdirSync } = await import('node:fs'); mkdirSync(dir); mkdirSync(pub);
  // Initial active snapshot built by the real tool from a fixture dump.
  const name = dumpName(activeDate, codes.length);
  const seed = zipOf(pub, name, sdf(codes));
  const built = spawnSync('sh', ['-c', `unzip -p "${seed}" | "${process.execPath}" "${path.join(here, 'stock-availability-snapshot.mjs')}" --input - --source-name ${name} --out-dir "${dir}"`], { encoding: 'utf8' });
  assert.equal(built.status, 0, built.stderr);
  rmSync(seed);
  await activateSnapshot(dir, activeDate);
  const state = { index: published.map((p) => p.name), files: new Map(), zipRequests: 0, statusOverride: null };
  for (const p of published) state.files.set(p.name, zipOf(pub, p.name, p.text));
  const store = createStockAvailabilityStore({ dir, recheckMs: 0 });
  const handler = createStockAvailabilityHandler(store);
  const server = http.createServer(async (req, res) => {
    const pathname = new URL(req.url, 'http://x').pathname;
    if (pathname.startsWith('/stock-availability')) {
      if (state.statusOverride) { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify(state.statusOverride)); }
      return handler(req, res, pathname);
    }
    if (pathname === '/CompChem/') { res.setHeader('content-type', 'text/html'); return res.end(`<html>${state.rawIndex ?? state.index.map((n) => `<a href="${n}">${n.slice(0, 20)}..&gt;</a>`).join('\n')}</html>`); }
    const file = state.files.get(decodeURIComponent(pathname.replace('/CompChem/', '')));
    if (!file) { res.statusCode = 404; return res.end('no'); }
    state.zipRequests += 1; res.end(readFileSync(file));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  return {
    dir, state, root,
    opts: { dir, sourceUrl: `http://127.0.0.1:${port}/CompChem/`, statusUrl: `http://127.0.0.1:${port}/stock-availability/status`, confirmWaitMs: 1500 },
    close: () => { server.close(); rmSync(root, { recursive: true, force: true }); },
  };
}
const snapshotDirs = (dir) => readdirSync(dir).filter((n) => /^\d{4}-\d{2}-\d{2}$/.test(n)).sort();
const leftovers = (dir) => readdirSync(dir).filter((n) => n.startsWith('.refresh-'));
const tests = []; const test = (name, fn) => tests.push([name, fn]);
const rejects = async (promise, pattern) => {
  try { await promise; } catch (error) { assert.ok(error instanceof RefreshRefused, String(error)); assert.match(error.message, pattern); return error; }
  assert.fail('expected a refusal');
};

test('index parsing is strict', () => {
  const html = [
    '<a href="STRUCTURES_FullDump_20261026_1165950.zip">x</a>', '<a href="STRUCTURES_FullDump_20260901_1144260.zip">x</a>',
    '<a href="STRUCTURES_20260901_63652_unique.zip">unique</a>', '<a href="../STRUCTURES_FullDump_20270101_5.zip">up</a>',
    '<a href="sub/STRUCTURES_FullDump_20270101_5.zip">sub</a>', '<a href="STRUCTURES_FullDump_20261340_5.zip">badday</a>',
    '<a href="STRUCTURES_FullDump_20261101_5.zip.part">part</a>', '<a href="STRUCTURES_FullDump_20261026_1165950.zip?C=M">sort</a>',
    '<a href="Asinex_Virtual.zip">v</a>',
  ].join('\n');
  assert.deepEqual(listDumps(html).map((d) => d.name), ['STRUCTURES_FullDump_20261026_1165950.zip', 'STRUCTURES_FullDump_20260901_1144260.zip']);
});

test('nothing published newer: no download, pointer untouched', async () => {
  const f = await fixture({ published: [{ name: dumpName('2026-10-26', 5), text: 'unused' }, { name: dumpName('2026-09-01', 5), text: 'unused' }] });
  try {
    const before = readFileSync(path.join(f.dir, POINTER_FILE), 'utf8');
    const result = await refresh(f.opts);
    assert.equal(result.outcome, 'no-newer');
    assert.equal(f.state.zipRequests, 0);
    assert.equal(readFileSync(path.join(f.dir, POINTER_FILE), 'utf8'), before);
    assert.deepEqual(leftovers(f.dir), []);
  } finally { f.close(); }
});

test('only older dumps than the active one: never a backwards switch', async () => {
  const f = await fixture({ published: [{ name: dumpName('2026-09-01', 5), text: 'unused' }] });
  try {
    assert.equal((await refresh(f.opts)).outcome, 'no-newer');
    assert.equal(f.state.zipRequests, 0);
    assert.equal((await readPointer(f.dir)).date, '2026-10-26');
  } finally { f.close(); }
});

test('operator deactivated (no ACTIVE.json): job activates nothing', async () => {
  const newer = sdf(codes);
  const f = await fixture({ published: [{ name: dumpName('2026-11-10', codes.length), text: newer }] });
  try {
    rmSync(path.join(f.dir, POINTER_FILE));
    assert.equal((await refresh(f.opts)).outcome, 'inactive');
    assert.equal(f.state.zipRequests, 0);
    assert.equal(existsSync(path.join(f.dir, POINTER_FILE)), false);
  } finally { f.close(); }
});

test('valid newer dump: built, activated, confirmed, previous snapshot retained, idempotent', async () => {
  const list = [...codes.slice(0, 98), 'LAS 20000001', 'LAS 20000002'];
  const f = await fixture({ published: [{ name: dumpName('2026-11-10', list.length), text: sdf(list, '7.5') }] });
  try {
    const result = await refresh(f.opts);
    assert.equal(result.outcome, 'activated'); assert.equal(result.date, '2026-11-10'); assert.equal(result.previous, '2026-10-26');
    assert.equal(result.compounds, 100);
    assert.deepEqual(snapshotDirs(f.dir), ['2026-10-26', '2026-11-10']);
    assert.equal((await readPointer(f.dir)).date, '2026-11-10');
    assert.match(readFileSync(path.join(f.dir, '2026-11-10', 'availability.csv'), 'utf8'), /^LAS 20000001,7\.5,/m);
    assert.deepEqual(leftovers(f.dir), []);
    for (const flag of REFUSED_FLAGS) assert.ok(!result.toolArgs.includes(flag), `never passes ${flag}`);
    assert.equal(result.toolArgs.includes('--previous'), true);
    // The same publication again is a no-op.
    const again = await refresh(f.opts);
    assert.equal(again.outcome, 'no-newer'); assert.equal(f.state.zipRequests, 1);
  } finally { f.close(); }
});

test('truncated dump (record count differs from its name) is refused; last good stays', async () => {
  const f = await fixture({ published: [{ name: dumpName('2026-11-10', codes.length + 50), text: sdf(codes) }] });
  try {
    const err = await rejects(refresh(f.opts), /snapshot tool refused/);
    for (const flag of REFUSED_FLAGS) assert.ok(!err.toolArgs.includes(flag));
    assert.equal((await readPointer(f.dir)).date, '2026-10-26');
    assert.deepEqual(snapshotDirs(f.dir), ['2026-10-26']);
    assert.deepEqual(leftovers(f.dir), []);
  } finally { f.close(); }
});

test('invalid vials above the reject rate, unknown tags and large losses are refused (no override)', async () => {
  const bad = [...codes.slice(0, 90).map((c) => vial(c, '5.0')), ...Array.from({ length: 10 }, (_, i) => vial(`BAS 3000000${i}`, '-1'))].join('');
  const unknownTag = codes.map((c, i) => vial(c, '5.0', i === 0 ? { NEW_FORMAT_FIELD: 'x' } : {})).join('');
  const lost = sdf(codes.slice(0, 80));
  const f = await fixture({ published: [{ name: dumpName('2026-11-10', 100), text: bad }] });
  const g = await fixture({ published: [{ name: dumpName('2026-11-10', 100), text: unknownTag }] });
  const h = await fixture({ published: [{ name: dumpName('2026-11-10', 80), text: lost }] });
  try {
    await rejects(refresh(f.opts), /snapshot tool refused/);
    await rejects(refresh(g.opts), /snapshot tool refused/);
    await rejects(refresh(h.opts), /snapshot tool refused/);
    for (const x of [f, g, h]) { assert.equal((await readPointer(x.dir)).date, '2026-10-26'); assert.deepEqual(snapshotDirs(x.dir), ['2026-10-26']); assert.deepEqual(leftovers(x.dir), []); }
  } finally { f.close(); g.close(); h.close(); }
});

test('a broken download or a non-zip file is refused', async () => {
  const f = await fixture({ published: [{ name: dumpName('2026-11-10', 100), text: sdf(codes) }] });
  try {
    writeFileSync(f.state.files.get(dumpName('2026-11-10', 100)), 'this is not a zip');
    await rejects(refresh(f.opts), /could not be unzipped|snapshot tool refused/);
    assert.equal((await readPointer(f.dir)).date, '2026-10-26');
    assert.deepEqual(leftovers(f.dir), []);
  } finally { f.close(); }
});

test('index oddities: no dumps, two dumps with one date, a future date', async () => {
  const f = await fixture({ published: [] });
  const g = await fixture({ published: [{ name: dumpName('2026-11-10', 100), text: 'x' }, { name: dumpName('2026-11-10', 101), text: 'x' }] });
  const h = await fixture({ published: [{ name: dumpName('2031-01-01', 100), text: 'x' }] });
  try {
    await rejects(refresh(f.opts), /lists no STRUCTURES_FullDump/);
    await rejects(refresh(g.opts), /different dumps dated 2026-11-10/);
    await rejects(refresh(h.opts), /in the future/);
    for (const x of [f, g, h]) assert.equal(x.state.zipRequests, 0);
  } finally { f.close(); g.close(); h.close(); }
});

test('service that does not confirm the new snapshot: reverted to the previous one', async () => {
  const f = await fixture({ published: [{ name: dumpName('2026-11-10', 100), text: sdf(codes, '9.0') }] });
  try {
    f.state.statusOverride = { configured: true, state: 'active', date: '2026-10-26', snapshotSha256: 'x' };
    await rejects(refresh(f.opts), /did not report 2026-11-10 as active.*reverted to 2026-10-26/);
    assert.equal((await readPointer(f.dir)).date, '2026-10-26');
  } finally { f.close(); }
});

test('pointer changed by an operator during the run is never overridden', async () => {
  const f = await fixture({ published: [{ name: dumpName('2026-11-10', 100), text: sdf(codes) }] });
  try {
    await rejects(refresh({ ...f.opts, hooks: { beforeActivate: () => rmSync(path.join(f.dir, POINTER_FILE)) } }), /ACTIVE\.json changed/);
    assert.equal(existsSync(path.join(f.dir, POINTER_FILE)), false, 'job did not recreate the pointer');
  } finally { f.close(); }
});

test('missing snapshot directory is an operational error, not created', async () => {
  const err = await refresh({ dir: path.join(tmpdir(), 'no-such-stock-dir-xyz') }).catch((e) => e);
  assert.ok(err instanceof RefreshRefused && err.code === 2);
  assert.equal(existsSync(path.join(tmpdir(), 'no-such-stock-dir-xyz')), false);
});

let failures = 0;
for (const [name, fn] of tests) {
  try { await fn(); console.log(`  PASS ${name}`); } catch (error) { failures += 1; console.log(`  FAIL ${name}: ${error.stack || error}`); }
}
console.log(`Stock availability refresh: ${tests.length - failures}/${tests.length} passed`);
process.exit(failures ? 1 : 0);
