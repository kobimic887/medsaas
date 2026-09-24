import assert from 'node:assert/strict';
import { mkdtemp, open, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadRDKit } from '../../server/utils/openCompounds.js';
import { FINGERPRINT_DETAILS, POPCOUNT, RECORD_BYTES } from './common.mjs';
import { createIndexServer, searchIndex } from './serve.mjs';

const dir = await mkdtemp(path.join(os.tmpdir(), 'pyxis-macrocycle-index-test-'));
let server;
let fingerprints;
let rows;
try {
  const rdkit = await loadRDKit();
  const examples = [
    ['c1ccccc1', 'RPX 1', '14 days'],
    ['Cc1ccccc1', 'RPX 2', '28 days'],
    ['c1ccccc1', 'RPX 1', '28 days'], // repeated supplier ID is a distinct export row
  ];
  const fpBytes = Buffer.alloc(RECORD_BYTES * examples.length);
  let csv = '';
  for (let i = 0; i < examples.length; i++) {
    const [smiles, code, leadTime] = examples[i];
    const mol = rdkit.get_mol(smiles);
    const fp = mol.get_morgan_fp_as_uint8array(FINGERPRINT_DETAILS);
    mol.delete();
    const pos = i * RECORD_BYTES;
    fpBytes.writeBigUInt64LE(BigInt(Buffer.byteLength(csv)), pos);
    fpBytes.writeUInt16LE(Array.from(fp).reduce((n, byte) => n + POPCOUNT[byte], 0), pos + 8);
    fpBytes.set(fp, pos + 10);
    csv += `${smiles},${code},${code},${code},macrocycle_real,fixture.csv,5,10,,,${leadTime}\n`;
  }
  const fpPath = path.join(dir, 'test.fpb');
  const rowsPath = path.join(dir, 'test.rows.csv');
  await writeFile(fpPath, fpBytes);
  await writeFile(rowsPath, csv);
  fingerprints = await open(fpPath, 'r');
  rows = await open(rowsPath, 'r');
  const store = { datasets: new Map([[1, {
    manifest: { datasetId: 1, datasetName: 'test', indexedRows: examples.length },
    fingerprints, rows,
  }]]) };

  const first = await searchIndex(store, { datasetId: 1, smiles: 'c1ccccc1', threshold: 1, offset: 0, limit: 1 });
  assert.equal(first.total_matches, 2);
  assert.equal(first.results[0].molecule_id, 1);
  assert.equal(first.results[0].metadata.Lead_TIME, '14 days');
  const second = await searchIndex(store, { datasetId: 1, smiles: 'c1ccccc1', threshold: 1, offset: 1, limit: 1 });
  assert.equal(second.results[0].molecule_id, 3);
  assert.equal(second.results[0].metadata.MAIN_BAS, 'RPX 1');
  assert.equal(second.results[0].metadata.Lead_TIME, '28 days');

  server = createIndexServer(store);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const listing = await (await fetch(`${base}/v1/datasets`)).json();
  assert.deepEqual(listing.datasets, [{ id: 1, name: 'test', row_count: 3 }]);
  const url = new URL(`${base}/v1/search/similarity`);
  url.search = new URLSearchParams({ dataset_id: '1', smiles: 'c1ccccc1', threshold: '1', offset: '1', limit: '1', fingerprint_type: 'morgan', similarity_metric: 'tanimoto' }).toString();
  const reply = await fetch(url);
  assert.equal(reply.status, 200);
  assert.equal((await reply.json()).results[0].molecule_id, 3);
  url.searchParams.set('similarity_metric', 'ctanimoto');
  assert.equal((await fetch(url)).status, 400);
  console.log('✓ macrocycle index: RDKit exact search, stable pagination, repeated supplier IDs, loopback API');
} finally {
  if (server) await new Promise((resolve) => server.close(resolve));
  await fingerprints?.close();
  await rows?.close();
  await rm(dir, { recursive: true, force: true });
}
