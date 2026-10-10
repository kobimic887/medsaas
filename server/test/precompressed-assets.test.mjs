import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { brotliCompressSync, brotliDecompressSync, gzipSync, gunzipSync } from 'node:zlib';
import express from 'express';
import { acceptedAssetEncodings, precompressedAssets } from '../utils/precompressedAssets.js';

test('asset encoding honors quality, explicit refusal and wildcard', () => {
  assert.deepEqual(acceptedAssetEncodings('br;q=0,gzip'), ['gzip']);
  assert.deepEqual(acceptedAssetEncodings('br;q=0.2,gzip;q=0.8'), ['gzip', 'br']);
  assert.deepEqual(acceptedAssetEncodings('gzip,br'), ['br', 'gzip']);
  assert.deepEqual(acceptedAssetEncodings('identity'), []);
  assert.deepEqual(acceptedAssetEncodings('*;q=1,br;q=0'), ['gzip']);
});

test('real HTTP serves identical compiled code compressed; normal ranges/API stay intact', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pyxis-static-'));
  const original = Buffer.from('const editor = "same scientific drawing code";\n'.repeat(200));
  await mkdir(path.join(root, 'ketcher/static/js'), { recursive: true });
  const file = path.join(root, 'ketcher/static/js/main.12345678.js');
  await writeFile(file, original);
  await writeFile(`${file}.br`, brotliCompressSync(original));
  await writeFile(`${file}.gz`, gzipSync(original));
  const app = express();
  app.use(precompressedAssets(root));
  app.use(express.static(root));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const request = (url, headers = {}, method = 'GET') => new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: server.address().port, path: url, headers, method }, response => {
      const chunks = []; response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks) }));
    }); req.on('error', reject); req.end();
  });
  try {
    for (const [encoding, decompress] of [['br', brotliDecompressSync], ['gzip', gunzipSync]]) {
      const result = await request('/ketcher/static/js/main.12345678.js', { 'accept-encoding': encoding });
      assert.equal(result.status, 200); assert.equal(result.headers['content-encoding'], encoding);
      assert.match(result.headers['content-type'], /javascript/); assert.match(result.headers.vary, /Accept-Encoding/);
      assert.match(result.headers['cache-control'], /immutable/); assert(result.body.length < original.length);
      assert.deepEqual(decompress(result.body), original);
    }
    const head = await request('/ketcher/static/js/main.12345678.js', { 'accept-encoding': 'br' }, 'HEAD');
    assert.equal(head.body.length, 0); assert.equal(head.headers['content-encoding'], 'br');
    const plain = await request('/ketcher/static/js/main.12345678.js', { 'accept-encoding': 'br;q=0,gzip;q=0' });
    assert.equal(plain.headers['content-encoding'], undefined); assert.deepEqual(plain.body, original);
    const range = await request('/ketcher/static/js/main.12345678.js', { 'accept-encoding': 'br', range: 'bytes=0-9' });
    assert.equal(range.status, 206); assert.equal(range.headers['content-encoding'], undefined);
    assert.deepEqual(range.body, original.subarray(0, 10));
    assert.equal((await request('/api/test.js', { 'accept-encoding': 'br' })).status, 404);
  } finally { await new Promise(resolve => server.close(resolve)); await rm(root, { recursive: true, force: true }); }
});
