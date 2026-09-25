// Macrocycle index contract: RDKit exact search, stable pagination, repeated
// supplier IDs, loopback API, and the format-2 count stream.
//
// Both artifact generations are exercised through openIndexStore so the manifest
// validation, file-size checks and metric gating are covered, not just the
// scoring loop:
//   * format 2  -> Tanimoto, Count Tanimoto and Count Dice
//   * format 1  -> Tanimoto only; a count metric is refused before any scan
// Count scores are cross-checked against the dense-vector helper so the packed
// stream decode cannot drift from server/utils/countMorgan.js.
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadRDKit } from '../../server/utils/openCompounds.js';
import { countMorganPacked, countMorganVector, countSimilarity } from '../../server/utils/countMorgan.js';
// Cross-boundary contract: the application's metric allowlist and this
// service's allowlist must name exactly the same wire values.
import { MACROCYCLE_SIMILARITY_METRICS } from '../../server/utils/macrocycleSearch.js';
import { FINGERPRINT_DETAILS, POPCOUNT, RECORD_BYTES, SIMILARITY_METRICS } from './common.mjs';
import { createIndexServer, openIndexStore, searchIndex, searchCombinedIndex } from './serve.mjs';

const dir = await mkdtemp(path.join(os.tmpdir(), 'pyxis-macrocycle-index-test-'));
let server;
let store;
try {
  const rdkit = await loadRDKit();
  const examples = [
    ['c1ccccc1', 'RPX 1', '14 days'],
    ['Cc1ccccc1', 'RPX 2', '28 days'],
    ['c1ccccc1', 'RPX 1', '28 days'], // repeated supplier ID is a distinct export row
  ];

  const records = Buffer.alloc(RECORD_BYTES * examples.length);
  const countParts = [];
  let csv = '';
  let expectedCountsBytes = 0;
  for (let i = 0; i < examples.length; i++) {
    const [smiles, code, leadTime] = examples[i];
    const mol = rdkit.get_mol(smiles);
    const fp = mol.get_morgan_fp_as_uint8array(FINGERPRINT_DETAILS);
    const packed = countMorganPacked(mol);
    mol.delete();
    // The build's invariant: count support must equal the stored binary support.
    let bitCount = 0;
    for (const byte of fp) bitCount += POPCOUNT[byte];
    assert.equal(packed.bits.length, bitCount, 'fixture count support must match the binary fingerprint');
    const pos = i * RECORD_BYTES;
    records.writeBigUInt64LE(BigInt(Buffer.byteLength(csv)), pos);
    records.writeUInt16LE(bitCount, pos + 8);
    records.set(fp, pos + 10);
    countParts.push(Buffer.from(packed.counts));
    expectedCountsBytes += packed.counts.length;
    csv += `${smiles},${code},${code},${code},macrocycle_real,fixture.csv,5,10,,,${leadTime}\n`;
  }
  const counts = Buffer.concat(countParts);
  const rowsBytes = Buffer.byteLength(csv);

  async function writeArtifact(source, { formatVersion, id, name }) {
    const sourceCsv = csv;
    const manifest = {
      formatVersion, source, datasetId: id,
      datasetName: name,
      sourceRows: examples.length, indexedRows: examples.length,
      fingerprint: 'RDKit Morgan radius 2, 2048-bit, chirality off, binary Tanimoto',
      normalizedInputSha256: 'fixture', fingerprintsFile: `${source}.fpb`, rowsFile: `${source}.rows.csv`,
      fingerprintsBytes: records.length, rowsBytes: Buffer.byteLength(sourceCsv), generatedAt: '2026-09-25T00:00:00.000Z',
    };
    if (formatVersion === 2) {
      manifest.countsFile = `${source}.cnt`;
      manifest.countsBytes = counts.length;
      manifest.similarityMetrics = [...SIMILARITY_METRICS];
      await writeFile(path.join(dir, `${source}.cnt`), counts);
    }
    await writeFile(path.join(dir, `${source}.fpb`), records);
    await writeFile(path.join(dir, `${source}.rows.csv`), sourceCsv);
    await writeFile(path.join(dir, `${source}.manifest.json`), JSON.stringify(manifest, null, 2));
  }
  await writeArtifact('test', { formatVersion: 2, id: 1, name: 'test v2' });
  await writeArtifact('testbin', { formatVersion: 1, id: 2, name: 'test v1' });
  await writeArtifact('testother', { formatVersion: 2, id: 3, name: 'test other v2' });

  store = await openIndexStore(dir, {
    test: { id: 1, name: 'test v2', expectedRows: examples.length },
    testbin: { id: 2, name: 'test v1', expectedRows: examples.length },
    testother: { id: 3, name: 'test other v2', expectedRows: examples.length },
  });
  assert.deepEqual([...MACROCYCLE_SIMILARITY_METRICS], [...SIMILARITY_METRICS], 'app and index metric allowlists must agree');
  assert.deepEqual(store.datasets.get(1).metrics, [...SIMILARITY_METRICS]);
  assert.deepEqual(store.datasets.get(2).metrics, ['tanimoto'], 'a format-1 artifact never advertises count metrics');
  assert.deepEqual(store.datasets.get(3).metrics, [...SIMILARITY_METRICS]);

  const first = await searchIndex(store, { datasetId: 1, smiles: 'c1ccccc1', threshold: 1, offset: 0, limit: 1 });
  assert.equal(first.similarity_metric, 'tanimoto');
  assert.equal(first.total_matches, 2);
  assert.equal(first.results[0].molecule_id, 1);
  assert.equal(first.results[0].metadata.Lead_TIME, '14 days');
  const second = await searchIndex(store, { datasetId: 1, smiles: 'c1ccccc1', threshold: 1, offset: 1, limit: 1 });
  assert.equal(second.results[0].molecule_id, 3);
  assert.equal(second.results[0].metadata.MAIN_BAS, 'RPX 1');
  assert.equal(second.results[0].metadata.Lead_TIME, '28 days');

  const combined = await searchCombinedIndex(store, {
    datasetIds: [1, 3], smiles: 'c1ccccc1', threshold: 1, offset: 0, limit: 4,
  });
  assert.equal(combined.total_matches, 4);
  assert.deepEqual(combined.results.map(({ source, molecule_id }) => `${source}:${molecule_id}`),
    ['test:1', 'test:3', 'testother:1', 'testother:3'], 'ties retain both source rows in deterministic order');
  const combinedPage = await searchCombinedIndex(store, {
    datasetIds: [1, 3], smiles: 'c1ccccc1', threshold: 1, offset: 2, limit: 2,
  });
  assert.deepEqual(combinedPage.results.map(({ source, molecule_id }) => `${source}:${molecule_id}`),
    ['testother:1', 'testother:3'], 'combined pagination must not repeat or skip equal-score rows');
  const combinedCount = await searchCombinedIndex(store, {
    datasetIds: [1, 3], smiles: 'c1ccccc1', threshold: 1, offset: 0, limit: 1, similarityMetric: 'count_tanimoto',
  });
  assert.equal(combinedCount.results[0].similarity, 1);
  await assert.rejects(searchCombinedIndex(store, {
    datasetIds: [1, 2], smiles: 'c1ccccc1', threshold: 1, offset: 0, limit: 1, similarityMetric: 'count_tanimoto',
  }), (error) => error.status === 400, 'a combined metric needs both artifacts');

  // Count metrics rank in the same bit space but with frequency-weighted scores.
  const countTanimoto = await searchIndex(store, {
    datasetId: 1, smiles: 'c1ccccc1', threshold: 0.1, offset: 0, limit: 10, similarityMetric: 'count_tanimoto',
  });
  assert.equal(countTanimoto.similarity_metric, 'count_tanimoto');
  assert.equal(countTanimoto.total_matches, 3);
  assert.equal(countTanimoto.results[0].molecule_id, 1);
  assert.equal(countTanimoto.results[0].similarity, 1, 'an identical structure scores exactly 1');

  const countDice = await searchIndex(store, {
    datasetId: 1, smiles: 'c1ccccc1', threshold: 0.1, offset: 0, limit: 10, similarityMetric: 'count_dice',
  });
  assert.equal(countDice.similarity_metric, 'count_dice');
  assert.equal(countDice.results[0].similarity, 1);

  // Independent cross-check: the packed stream must decode to the same score as
  // the dense count vectors from the shared helper.
  {
    const queryMol = rdkit.get_mol('c1ccccc1');
    const rowMol = rdkit.get_mol('Cc1ccccc1');
    const expected = countSimilarity(countMorganVector(queryMol), countMorganVector(rowMol), 'count_tanimoto');
    queryMol.delete();
    rowMol.delete();
    const row = countTanimoto.results.find((hit) => hit.molecule_id === 2);
    assert.ok(Math.abs(row.similarity - expected) < 1e-12, `packed stream score ${row.similarity} != dense ${expected}`);
    assert.ok(countDice.results.find((hit) => hit.molecule_id === 2).similarity > row.similarity,
      'count Dice is more forgiving than count Tanimoto for the same pair');
  }

  // A count metric on a binary-only artifact is a client error, not a scan.
  await assert.rejects(
    searchIndex(store, { datasetId: 2, smiles: 'c1ccccc1', threshold: 1, offset: 0, limit: 1, similarityMetric: 'count_tanimoto' }),
    (error) => error.status === 400,
  );

  server = createIndexServer(store);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const listing = await (await fetch(`${base}/v1/datasets`)).json();
  assert.deepEqual(listing.datasets, [
    { id: 1, name: 'test v2', row_count: 3, fingerprint_type: 'morgan', metrics: [...SIMILARITY_METRICS] },
    { id: 2, name: 'test v1', row_count: 3, fingerprint_type: 'morgan', metrics: ['tanimoto'] },
    { id: 3, name: 'test other v2', row_count: 3, fingerprint_type: 'morgan', metrics: [...SIMILARITY_METRICS] },
  ]);

  const url = new URL(`${base}/v1/search/similarity`);
  url.search = new URLSearchParams({
    dataset_id: '1', smiles: 'c1ccccc1', threshold: '1', offset: '1', limit: '1',
    fingerprint_type: 'morgan', similarity_metric: 'tanimoto',
  }).toString();
  const reply = await fetch(url);
  assert.equal(reply.status, 200);
  assert.equal((await reply.json()).results[0].molecule_id, 3);

  url.search = new URLSearchParams({
    dataset_ids: '1,3', smiles: 'c1ccccc1', threshold: '1', offset: '2', limit: '2',
    fingerprint_type: 'morgan', similarity_metric: 'tanimoto',
  }).toString();
  const combinedReply = await fetch(url);
  assert.equal(combinedReply.status, 200);
  assert.deepEqual((await combinedReply.json()).results.map(({ source, molecule_id }) => `${source}:${molecule_id}`),
    ['testother:1', 'testother:3']);

  url.searchParams.set('similarity_metric', 'count_tanimoto');
  const counted = await fetch(url);
  assert.equal(counted.status, 200);
  assert.equal((await counted.json()).similarity_metric, 'count_tanimoto');

  // Unknown metrics are still rejected, and are never silently mapped onto a
  // count or binary score.
  url.searchParams.set('similarity_metric', 'ctanimoto');
  assert.equal((await fetch(url)).status, 400);

  url.search = new URLSearchParams({
    dataset_id: '1', smiles: '[13CH4]', threshold: '0.1', offset: '0', limit: '1',
    fingerprint_type: 'morgan', similarity_metric: 'count_tanimoto',
  }).toString();
  assert.equal((await fetch(url)).status, 400, 'count queries must refuse isotope labels');
  url.searchParams.set('smiles', 'c1ccccc1');
  url.searchParams.set('similarity_metric', 'dice');
  assert.equal((await fetch(url)).status, 400);
  url.searchParams.set('similarity_metric', 'count_tanimoto');
  url.searchParams.set('fingerprint_type', 'morgan_count');
  assert.equal((await fetch(url)).status, 400);

  // A v1 dataset refuses a count metric at the API boundary too.
  url.search = new URLSearchParams({
    dataset_id: '2', smiles: 'c1ccccc1', threshold: '1', offset: '0', limit: '1',
    fingerprint_type: 'morgan', similarity_metric: 'count_tanimoto',
  }).toString();
  assert.equal((await fetch(url)).status, 400);

  console.log('✓ macrocycle index: RDKit exact search, stable pagination, repeated supplier IDs, loopback API');
  console.log('✓ macrocycle index: format-2 count stream (Tanimoto/Dice), format-1 metric gating, unknown-metric rejection');
} finally {
  if (server) await new Promise((resolve) => server.close(resolve));
  if (store) await store.close();
  await rm(dir, { recursive: true, force: true });
}
