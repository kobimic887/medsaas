#!/usr/bin/env node
// Stock availability snapshot (scripts/stock-availability-snapshot.mjs): vial
// aggregation, price-family mapping, invalid input, guards and reruns. Fixtures
// only; no network or search service.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
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
  for (const code of ['BAS 02324364', 'ASN 04188606', 'BDD 27882327', 'SYN 12345678', 'PYX 12345678', 'MAC 12345678']) {
    assert.equal(stockPriceCategory(code), 'Other codes', code);
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
  assert.deepEqual(readdirSync(out).filter((n) => n.includes('.tmp-')), [], 'no temp directories left');
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
