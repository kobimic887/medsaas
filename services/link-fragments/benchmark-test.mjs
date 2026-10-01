import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { benchmarkManifest } from './benchmark.mjs';
test('reference comparison covers every surviving atom without claiming MOE parity', async () => {
  const report = await benchmarkManifest(fileURLToPath(new URL('benchmark-cases.json', import.meta.url)));
  assert.equal(report.passed, true);
  assert.equal(report.moeParityEstablished, false);
  assert.equal(report.cases[0].fixedAtomsCompared, 29);
  assert.equal(report.cases[0].fixedMaxDeviationAngstrom, 0);
  assert.equal(report.cases[0].graphMatchesReference, true);
});
test('a different reference product fails the comparison even with declared MOE settings', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'pyxis-linker-benchmark-'));
  try {
    const manifest = JSON.parse(await readFile(new URL('benchmark-cases.json', import.meta.url), 'utf8'));
    for (const item of manifest.cases) for (const key of ['query', 'linker', 'expectedProduct']) item[key] = fileURLToPath(new URL(item[key], import.meta.url));
    manifest.cases[0].expectedProduct = fileURLToPath(new URL('fixtures/refine-boronic.sdf', import.meta.url));
    manifest.moeProtocol = { version: 'example', settings: 'not verified' };
    const file = join(temporary, 'cases.json'); await writeFile(file, JSON.stringify(manifest));
    const report = await benchmarkManifest(file);
    assert.equal(report.passed, false);
    assert.equal(report.cases[0].graphMatchesReference, false);
    assert.equal(report.moeParityEstablished, false);
  } finally { await rm(temporary, { recursive: true, force: true }); }
});
