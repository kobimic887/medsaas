#!/usr/bin/env node
// Stock availability snapshot (scripts/stock-availability-snapshot.mjs): vial
// aggregation, price-family mapping, invalid input, guards and reruns. Fixtures
// only; no network or search service.
import assert from 'node:assert/strict';
import { appendFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import {
  KNOWN_TAGS, MIN_OFFER_MG, REQUIRED_TAGS, SnapshotError, buildSnapshot, diffSnapshots, parseDumpName,
  readPrevious, runSnapshot, stockPriceCategory,
} from './stock-availability-snapshot.mjs';

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), 'stock-availability-snapshot.mjs');
let vialSeq = 1000;
function vial(code, mg, { um = '10.0', vial = String(vialSeq++), extra = {}, drop = [] } = {}) {
  const tags = { ELE_ID: '1', MAIN_BAS: code, VIAL: vial, BOX_ID: '1', BOX: '16G08', CELL: 'A01', MW_BATCH: '300.1', MW_STRUCTURE: '300.1', IUPAC_NAME: 'x', CURRENT_AMOUNT_UM: um, CURRENT_NETTO_MG: mg, ...extra };
  const data = Object.entries(tags).filter(([k]) => !drop.includes(k)).map(([k, v]) => `>  <${k}>\n${v}\n`).join('\n');
  return `\n  Mrv2403 10262609272D\n\n  1  0  0  0  0  0            999 V2000\n    0.0000    0.0000    0.0000 C   0  0\nM  END\n${data}\n$$$$\n`;
}
const lines = (text) => text.split('\n').slice(0, text.endsWith('\n') ? -1 : undefined)[Symbol.iterator]();
const tmp = () => mkdtempSync(path.join(tmpdir(), 'stock-avail-'));
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test('pinned format and dump names', () => {
  assert.ok(REQUIRED_TAGS.every((tag) => KNOWN_TAGS.includes(tag)));
  assert.deepEqual(parseDumpName('STRUCTURES_FullDump_20261026_1165950.zip'), { asOf: '2026-10-26', expectedRecords: 1165950 });
  assert.equal(parseDumpName('STRUCTURES_FullDump_20261332_5.zip'), null);
  assert.equal(parseDumpName('STRUCTURES_20260901_63652_unique.zip'), null);
});

test('stock families map to the current workbook columns', () => {
  assert.equal(stockPriceCategory('LAS 51234567'), 'LAS');
  assert.equal(stockPriceCategory('PRO 12345678'), 'PRO');
  for (const code of ['BAS 02324364', 'ASN 04188606', 'BDD 27882327', 'SYN 12345678', 'PYX 12345678', 'MAC 12345678']) {
    assert.equal(stockPriceCategory(code), 'not LAS', code);
  }
  // RPX/VPX codes are never priced as stock.
  assert.equal(stockPriceCategory('RPX 202406561'), null);
  assert.equal(stockPriceCategory('VPX 1'), null);
});

test('vials are summed per compound with family report', async () => {
  const sdf = vial('BAS 02324364', '4.0000001', { um: '10.0' }) + vial('bas  02324364', '0.75', { um: '2.5' })
    + vial('LAS 51234567', '0.5') + vial('RPX 202406561', '5.0');
  const { rows, report } = await buildSnapshot(lines(sdf));
  assert.deepEqual(rows, [
    { code: 'BAS 02324364', mg: 4.75, um: 12.5, vials: 2 },
    { code: 'LAS 51234567', mg: 0.5, um: 10, vials: 1 },
    { code: 'RPX 202406561', mg: 5, um: 10, vials: 1 },
  ]);
  assert.equal(report.records, 4);
  assert.equal(report.offerableCompounds, 1, 'LAS is under 1 mg and RPX has no stock price');
  assert.equal(report.belowOfferMinimum, 1);
  assert.deepEqual(report.families.LAS, { compounds: 1, offerable: 0, priceCategory: 'LAS' });
  assert.deepEqual(report.families.RPX, { compounds: 1, offerable: 0, priceCategory: null });
});

test('invalid records are rejected and counted, not repaired', async () => {
  const bad = vial('BAS 1', '1') + vial('BAS 02324364', 'n/a') + vial('BAS 02324364', '') + vial('BAS 02324364', '-1')
    + vial('BAS 02324364', '2', { um: 'x' }) + vial('BAS 02324364', '2', { vial: '7' }) + vial('BAS 02324364', '2', { vial: '7' });
  const { rows, report } = await buildSnapshot(lines(bad), { maxRejectRate: 1 });
  assert.deepEqual(report.rejects.byReason, { invalid_main_bas: 1, invalid_mg: 2, missing_mg: 1, invalid_um: 1, duplicate_vial: 1 });
  assert.deepEqual(rows, [{ code: 'BAS 02324364', mg: 2, um: 10, vials: 1 }]);
  await assert.rejects(buildSnapshot(lines(bad)), /Rejected 6 of 7/);
});

test('optional tags vary per vial; unknown tags and truncated input fail the run', async () => {
  const optional = vial('BAS 02324364', '2', { extra: { EXCLUSIVITY: 'x', SALT_NOTATION: 'HCl', BATCH: '1' } }) + vial('BAS 02324364', '1', { drop: ['BOX', 'IUPAC_NAME'] });
  const { rows, report } = await buildSnapshot(lines(optional));
  assert.deepEqual(rows, [{ code: 'BAS 02324364', mg: 3, um: 20, vials: 2 }]);
  assert.equal(report.optionalTags.EXCLUSIVITY, 1);
  const drift = vial('BAS 02324364', '2', { extra: { PRICE: '9' } });
  await assert.rejects(buildSnapshot(lines(drift)), (e) => e instanceof SnapshotError && e.details.unknownTags.PRICE === 1);
  assert.deepEqual((await buildSnapshot(lines(drift), { allowNewTags: true })).report.unknownTags, { PRICE: 1 });
  const missing = await buildSnapshot(lines(vial('BAS 02324364', '2', { drop: ['CURRENT_NETTO_MG'] }) + vial('BAS 02324365', '2')), { maxRejectRate: 1 });
  assert.deepEqual(missing.report.rejects.byReason, { missing_CURRENT_NETTO_MG: 1 });
  await assert.rejects(buildSnapshot(lines(vial('BAS 02324364', '2').replace('$$$$\n', ''))), /truncated/);
  await assert.rejects(buildSnapshot(lines('')), /no SDF records/);
});

test('diff counts compounds that lose or gain an offer', () => {
  const previous = new Map([['BAS 00000001', 5], ['BAS 00000002', 3], ['BAS 00000003', 0.5], ['BAS 00000004', 2]]);
  // 2.0000001 is float32 text noise for 2 mg, not a change.
  const rows = [{ code: 'BAS 00000002', mg: 0.4 }, { code: 'BAS 00000003', mg: 2 }, { code: 'BAS 00000004', mg: 2.0000001 }, { code: 'LAS 00000009', mg: 1 }];
  const diff = diffSnapshots(rows, previous);
  assert.equal(diff.removed, 1); assert.equal(diff.added, 1);
  assert.equal(diff.lostOffer, 2); assert.equal(diff.gainedOffer, 2);
  assert.equal(diff.unchanged, 1); assert.equal(diff.removedRate, 0.25);
});

test('previous snapshot reads the unique TSV and refuses unreadable rows', async () => {
  const tsv = 'mol\tMAIN_BAS\tID\tCURRENT_TOT_AMOUNT_UM\tCURRENT_TOT_NETTO_MG\nC\tBAS 00000001\t1\t10\t4.2\n';
  assert.deepEqual([...await readPrevious(lines(tsv))], [['BAS 00000001', 4.2]]);
  await assert.rejects(readPrevious(lines('MAIN_BAS,CURRENT_TOT_NETTO_MG\nBAS 1,abc\n')), /unreadable/);
  await assert.rejects(readPrevious(lines('code,mg\n')), /needs MAIN_BAS/);
});

test('writes once, reruns are no-ops, conflicting data is refused', async () => {
  const dir = tmp(); const out = path.join(dir, 'out');
  const input = path.join(dir, 'STRUCTURES_FullDump_20261026_3.sdf');
  writeFileSync(input, vial('BAS 00000001', '2') + vial('BAS 00000001', '1') + vial('LAS 00000002', '3'));
  const first = await runSnapshot({ input, outDir: out });
  assert.equal(first.status, 'written');
  assert.equal(readFileSync(path.join(out, '2026-10-26', 'availability.csv'), 'utf8'),
    'MAIN_BAS,CURRENT_TOT_NETTO_MG,CURRENT_TOT_AMOUNT_UM,VIALS\nBAS 00000001,3,20,2\nLAS 00000002,3,10,1\n');
  const csvBefore = readFileSync(path.join(out, '2026-10-26', 'availability.csv'));
  assert.equal((await runSnapshot({ input, outDir: out })).status, 'unchanged');
  assert.deepEqual(readFileSync(path.join(out, '2026-10-26', 'availability.csv')), csvBefore);

  const changed = path.join(dir, 'other', 'STRUCTURES_FullDump_20261026_3.sdf');
  spawnSync('mkdir', ['-p', path.dirname(changed)]);
  writeFileSync(changed, vial('BAS 00000001', '9') + vial('BAS 00000001', '1') + vial('LAS 00000002', '3'));
  await assert.rejects(runSnapshot({ input: changed, outDir: out }), /already exists/);
  assert.deepEqual(readFileSync(path.join(out, '2026-10-26', 'availability.csv')), csvBefore, 'good data is untouched');
  assert.equal((await runSnapshot({ input: changed, outDir: out, replace: true })).status, 'written');
  assert.match(readFileSync(path.join(out, '2026-10-26', 'availability.csv'), 'utf8'), /BAS 00000001,10,20,2/);
  assert.deepEqual(readdirSync(out).filter((n) => n.endsWith('.lock') || n.includes('.tmp-')), [], 'no lock or temp entries left');
  assert.ok(lstatSync(path.join(out, '2026-10-26')).isSymbolicLink(), 'published date is an atomically switched link');
});

test('damaged published snapshots are never a no-op and --replace rebuilds them', async () => {
  const dir = tmp(); const out = path.join(dir, 'out');
  const input = path.join(dir, 'STRUCTURES_FullDump_20261026_2.sdf');
  writeFileSync(input, vial('BAS 00000001', '2') + vial('LAS 00000002', '3'));
  await runSnapshot({ input, outDir: out });
  const published = path.join(out, '2026-10-26');
  const good = readFileSync(path.join(published, 'availability.csv'));
  const manifest = readFileSync(path.join(published, 'manifest.json'));
  const damage = {
    'altered CSV': () => appendFileSync(path.join(published, 'availability.csv'), 'BAS 99999999,9,9,1\n'),
    'corrupt manifest': () => writeFileSync(path.join(published, 'manifest.json'), '{not json'),
    'missing CSV': () => rmSync(path.join(published, 'availability.csv')),
    'missing manifest': () => rmSync(path.join(published, 'manifest.json')),
  };
  for (const [name, hurt] of Object.entries(damage)) {
    hurt();
    await assert.rejects(runSnapshot({ input, outDir: out }), (e) => e instanceof SnapshotError && /damaged or incomplete.*--replace/.test(e.message), `${name}: rerun must refuse, not report unchanged`);
    const rebuilt = await runSnapshot({ input, outDir: out, replace: true });
    assert.equal(rebuilt.status, 'written', `${name}: --replace repairs it`);
    assert.deepEqual(readFileSync(path.join(published, 'availability.csv')), good);
    assert.deepEqual(readFileSync(path.join(published, 'manifest.json')), manifest);
    assert.equal((await runSnapshot({ input, outDir: out })).status, 'unchanged', `${name}: repaired snapshot is a no-op again`);
  }
  // A stale lock from a crashed run is reported, not overwritten or swallowed as a crash.
  mkdirSync(path.join(out, '.2026-10-26.lock'));
  await assert.rejects(runSnapshot({ input, outDir: out }), (e) => e instanceof SnapshotError && /holds/.test(e.message));
  rmSync(path.join(out, '.2026-10-26.lock'), { recursive: true });
});

test('corrupt rerun through the CLI is a refusal (exit 1), never an unhandled crash', () => {
  const dir = tmp(); const out = path.join(dir, 'out');
  const input = path.join(dir, 'STRUCTURES_FullDump_20261026_1.sdf');
  writeFileSync(input, vial('BAS 00000001', '2'));
  const args = ['--input', input, '--out-dir', out];
  assert.equal(spawnSync(process.execPath, [script, ...args]).status, 0);
  writeFileSync(path.join(out, '2026-10-26', 'manifest.json'), '{not json');
  const refused = spawnSync(process.execPath, [script, ...args]);
  assert.equal(refused.status, 1, refused.stderr.toString());
  assert.match(refused.stderr.toString(), /Refused: .*--replace/);
  assert.equal(spawnSync(process.execPath, [script, ...args, '--replace']).status, 0);
  assert.match(spawnSync(process.execPath, [script, ...args]).stdout.toString(), /Unchanged/);
});

test('explicit --as-of: record count still enforced, conflicting or impossible dates refused', async () => {
  const dir = tmp();
  const named = path.join(dir, 'STRUCTURES_FullDump_20261026_2.sdf');
  writeFileSync(named, vial('BAS 00000001', '2') + vial('LAS 00000002', '3'));
  const one = path.join(dir, 'STRUCTURES_FullDump_20261102_5.sdf');
  writeFileSync(one, vial('BAS 00000001', '2'));
  // Matching --as-of must not switch the incomplete-upload guard off.
  await assert.rejects(runSnapshot({ input: one, outDir: path.join(dir, 'a'), asOf: '2026-11-02' }), /promises 5 records/);
  assert.equal((await runSnapshot({ input: named, outDir: path.join(dir, 'b'), asOf: '2026-10-26' })).status, 'written');
  // An --as-of that disagrees with the dump name, or is not a real date, writes nothing.
  for (const asOf of ['2026-10-27', '2026-02-30', '2026-13-01', '20261026']) {
    await assert.rejects(runSnapshot({ input: named, outDir: path.join(dir, 'c'), asOf }), SnapshotError, asOf);
  }
  // A malformed dump name is not silently relabelled by --as-of.
  const malformed = path.join(dir, 'STRUCTURES_FullDump_20261399_1.sdf');
  writeFileSync(malformed, vial('BAS 00000001', '2'));
  await assert.rejects(runSnapshot({ input: malformed, outDir: path.join(dir, 'c'), asOf: '2026-11-01' }), /conflicting/);
  assert.equal(existsSync(path.join(dir, 'c')) ? readdirSync(path.join(dir, 'c')).length : 0, 0, 'refused runs write nothing');
  // A plainly named file takes the explicit date and has no promised count.
  const plain = path.join(dir, 'dump.sdf');
  writeFileSync(plain, vial('BAS 00000001', '2') + vial('BAS 00000003', '2') + vial('LAS 00000002', '3'));
  const written = await runSnapshot({ input: plain, outDir: path.join(dir, 'd'), asOf: '2026-10-26' });
  assert.equal(written.manifest.records, 3);
  assert.ok(existsSync(path.join(dir, 'd', '2026-10-26', 'availability.csv')));
  const cli = (extra) => spawnSync(process.execPath, [script, '--input', one, '--out-dir', path.join(dir, 'e'), ...extra]);
  assert.equal(cli(['--as-of', '2026-11-02']).status, 1, 'CLI enforces the promised count with --as-of');
  assert.equal(cli(['--as-of', '2026-11-03']).status, 1, 'CLI refuses a conflicting --as-of');
});

test('tag names cannot pollute the report and previous snapshots reject duplicate or malformed codes', async () => {
  const hostile = vial('BAS 02324364', '2', { extra: { constructor: '1', ['__proto__']: '1', toString: '1' } });
  await assert.rejects(buildSnapshot(lines(hostile)), (e) => e instanceof SnapshotError
    && Object.keys(e.details.unknownTags).sort().join() === '__proto__,constructor,toString');
  const allowed = await buildSnapshot(lines(hostile), { allowNewTags: true });
  assert.deepEqual(Object.keys(allowed.report.unknownTags).sort(), ['__proto__', 'constructor', 'toString']);
  assert.equal(Object.getPrototypeOf({}).constructor, Object, 'Object.prototype untouched');
  await assert.rejects(readPrevious(lines('MAIN_BAS,CURRENT_TOT_NETTO_MG\nBAS 00000001,2\nbas  00000001,3\n')), /unreadable/);
  await assert.rejects(readPrevious(lines('MAIN_BAS,CURRENT_TOT_NETTO_MG\nnot-a-code,2\n')), /unreadable/);
  await assert.rejects(readPrevious(lines('MAIN_BAS,CURRENT_TOT_NETTO_MG\n,2\n')), /unreadable/);
});

test('offerable totals follow the stock price families, including PRO', async () => {
  const sdf = vial('BAS 00000001', '1') + vial('LAS 00000002', '2') + vial('PRO 00000003', '5') + vial('PRO 00000004', '0.5') + vial('VPX 202400001', '9');
  const { report } = await buildSnapshot(lines(sdf));
  assert.deepEqual(report.families.PRO, { compounds: 2, offerable: 1, priceCategory: 'PRO' });
  assert.equal(report.offerableCompounds, 3, 'BAS, LAS and the one PRO compound of at least 1 mg; VPX is not stock');
  assert.equal(report.offerableCompounds, Object.values(report.families).reduce((n, f) => n + f.offerable, 0));
});

test('truncated final records fail, trailing blank lines do not', async () => {
  const ok = vial('BAS 02324364', '2');
  assert.equal((await buildSnapshot(lines(`${ok}\n\n`))).report.records, 1);
  await assert.rejects(buildSnapshot(lines(ok + ok.replace('$$$$\n', '').slice(0, -1))), /truncated/);
  await assert.rejects(buildSnapshot(lines(`${ok}\n  dangling header line\n`)), /truncated/);
});

test('guards: record count, large drops, invalid runs write nothing', async () => {
  const dir = tmp(); const out = path.join(dir, 'out');
  const short = path.join(dir, 'STRUCTURES_FullDump_20261102_5.sdf');
  writeFileSync(short, vial('BAS 00000001', '2'));
  await assert.rejects(runSnapshot({ input: short, outDir: out }), /promises 5 records/);

  const previous = path.join(dir, 'prev.csv');
  writeFileSync(previous, 'MAIN_BAS,CURRENT_TOT_NETTO_MG\nBAS 00000001,2\nBAS 00000002,2\nBAS 00000003,2\n');
  const shrunk = path.join(dir, 'STRUCTURES_FullDump_20261109_1.sdf');
  writeFileSync(shrunk, vial('BAS 00000001', '2'));
  await assert.rejects(runSnapshot({ input: shrunk, outDir: out, previous }), (e) => /missing/.test(e.message) && e.details.diff.removed === 2);
  const bad = path.join(dir, 'STRUCTURES_FullDump_20261116_2.sdf');
  writeFileSync(bad, vial('BAS 00000001', '2') + vial('BAS 00000002', 'oops'));
  await assert.rejects(runSnapshot({ input: bad, outDir: out }), /Rejected 1 of 2/);
  assert.equal(existsSync(out) ? readdirSync(out).length : 0, 0, 'refused runs leave no snapshot');

  const accepted = await runSnapshot({ input: shrunk, outDir: out, previous, allowLargeChange: true });
  assert.equal(accepted.manifest.diff.lostOffer, 2);
  assert.equal(accepted.manifest.minOfferMg, MIN_OFFER_MG);
});

test('CLI exit codes and stdin input', () => {
  const dir = tmp(); const out = path.join(dir, 'out');
  const ok = spawnSync(process.execPath, [script, '--input', '-', '--source-name', 'STRUCTURES_FullDump_20261123_1.zip', '--out-dir', out], { input: vial('ASN 04188606', '4.7') });
  assert.equal(ok.status, 0, ok.stderr.toString());
  assert.match(ok.stdout.toString(), /Snapshot written/);
  const again = spawnSync(process.execPath, [script, '--input', '-', '--source-name', 'STRUCTURES_FullDump_20261123_1.zip', '--out-dir', out], { input: vial('ASN 04188606', '4.7', { vial: '1000' }) });
  assert.equal(again.status, 1, 'same date with different bytes is refused');
  const noDate = spawnSync(process.execPath, [script, '--input', '-', '--out-dir', out], { input: vial('ASN 04188606', '4.7') });
  assert.equal(noDate.status, 1);
  assert.match(noDate.stderr.toString(), /Snapshot date unknown/);
  assert.equal(spawnSync(process.execPath, [script, '--bogus']).status, 2);
});

let failed = 0;
for (const [name, fn] of tests) {
  try { await fn(); console.log(`ok - ${name}`); } catch (error) { failed += 1; console.error(`not ok - ${name}\n`, error); }
}
console.log(`${tests.length - failed}/${tests.length} stock availability snapshot checks passed`);
process.exitCode = failed ? 1 : 0;
