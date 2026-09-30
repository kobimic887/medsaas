import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { parseSdf } from './sdf.mjs';
import { createLinkerServer } from './serve.mjs';

test('compressed SQLite import, real scientific HTTP worker search and bounded coverage', async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'pyxis-linker-service-'));
  let server;
  try {
    const archive = path.join(temporary, 'linkers.zip');
    const indexPath = path.join(temporary, 'linkers.sqlite');
    const linker = fileURLToPath(new URL('fixtures/linker.sdf', import.meta.url));
    execFileSync('python3', ['-c', 'import sys,zipfile,pathlib; record=pathlib.Path(sys.argv[1]).read_text(); archive=zipfile.ZipFile(sys.argv[2],"w",zipfile.ZIP_DEFLATED); archive.writestr("linker-conformers.sdf",record+record); archive.close()', linker, archive]);
    const report = JSON.parse(execFileSync('python3', [fileURLToPath(new URL('build.py', import.meta.url)), '--input', archive, '--out', indexPath, '--expected-rows', '2'], { encoding: 'utf8' }).trim());
    assert.equal(report.records, 2);
    assert.equal(report.rejected, 0);
    assert.equal(report.sourceRows, 2);
    assert.equal(report.sourceSha256.length, 64);
    server = await createLinkerServer({ indexPath, candidateCap: 1 });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${server.address().port}`;
    const statusResponse = await fetch(`${url}/status`);
    const status = await statusResponse.json();
    assert.equal(statusResponse.status, 200);
    assert.equal(status.available, true);
    assert.equal(status.records, report.records);
    assert.equal(status.pairs, report.pairs);
    assert(status.method && status.limitations.length);
    const sdf = await readFile(new URL('fixtures/query.sdf', import.meta.url), 'utf8');
    const search = body => fetch(`${url}/search`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const badResponse = await search({ sdf, attachmentAtoms: [0, 1], limit: 10, maxRmsd: 0.75 });
    assert.equal(badResponse.status, 400, JSON.stringify(await badResponse.json()));
    const invalidJson = await fetch(`${url}/search`, { method: 'POST', body: '{bad json' });
    assert.equal(invalidJson.status, 400);
    const badTolerance = await search({ sdf, attachmentAtoms: [1, 1], maxRmsd: 3 });
    assert.equal(badTolerance.status, 400);
    const response = await search({ sdf, attachmentAtoms: [1, 1], limit: 10, maxRmsd: 0.75 });
    const result = await response.json();
    assert.equal(response.status, 200, JSON.stringify(result));
    assert.equal(result.candidatesAvailable, 2);
    assert.equal(result.candidatesScanned, 1);
    assert.equal(result.truncated, true);
    assert.equal(result.results.length, 1, JSON.stringify(result));
    const product = result.results[0];
    assert.equal(product.conformerId, 1);
    assert(product.linkerId && product.smiles && product.sdf && product.linkerAtoms.length === 2);
    assert(product.rmsd > 0 && product.rmsd < 0.75);
    const productRecords = parseSdf(product.sdf);
    assert.equal(productRecords.length, 1);
    const originalAtoms = parseSdf(sdf).flatMap(fragment => fragment.atoms);
    originalAtoms.forEach((atom, number) => { assert.deepEqual(productRecords[0].atoms[number].xyz, atom.xyz); });
    assert.equal((await fetch(`${url}/unknown`)).status, 404);
  } finally {
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    await rm(temporary, { recursive: true, force: true });
  }
});
