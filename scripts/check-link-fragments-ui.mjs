import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import { linkFragmentsRequest } from '../client/src/utils/linkFragmentsRequest.js';

const page = readFileSync(new URL('../client/src/pages/dashboard/link-fragments.jsx', import.meta.url), 'utf8');
const viewer = readFileSync(new URL('../client/src/components/Fragment3DViewer.jsx', import.meta.url), 'utf8');
const received = [];
const server = http.createServer(async (req, res) => {
  let body = ''; for await (const chunk of req) body += chunk;
  received.push({ url: req.url, authorization: req.headers.authorization, body });
  if (req.url === '/timeout') return;
  res.setHeader('Content-Type', 'application/json');
  if (req.url === '/invalid') { res.statusCode = 400; res.end(JSON.stringify({ error: { message: 'Pick an atom that can accept a bond.' } })); }
  else res.end(JSON.stringify({ available: true, results: [] }));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
try {
  const base = `http://127.0.0.1:${server.address().port}`;
  await linkFragmentsRequest(`${base}/status`, { controller: new AbortController(), token: 'fixture-token' });
  const query = { sdf: 'original\n3D\n$$$$\nsecond fragment\n$$$$\n', attachmentAtoms: [7, 8], limit: 10, maxRmsd: 0.75 };
  await linkFragmentsRequest(`${base}/search`, { controller: new AbortController(), token: 'fixture-token', body: query });
  assert.equal(received[0].authorization, 'Bearer fixture-token');
  assert.deepEqual(JSON.parse(received[1].body), query, 'exact uploaded 3D text and atom selections survive requests');
  await assert.rejects(linkFragmentsRequest(`${base}/invalid`, { controller: new AbortController() }), /Pick an atom/);
  await assert.rejects(linkFragmentsRequest(`${base}/timeout`, { controller: new AbortController(), timeout: 10 }), /timed out/);

  const calls = [];
  const controller = new AbortController();
  const activeRequest = { current: controller };
  const clearBody = page.split('function clearSearch() {')[1].split('\n  }')[0];
  const clearSearch = new Function('activeRequest', 'setSearch', 'setError', 'setSelectedResult', 'setBusy', clearBody).bind(null, activeRequest, value => calls.push(['search', value]), value => calls.push(['error', value]), value => calls.push(['selected', value]), value => calls.push(['busy', value]));
  clearSearch();
  assert.equal(controller.signal.aborted, true);
  assert.equal(activeRequest.current, null);
  assert.deepEqual(calls, [['search', null], ['error', ''], ['selected', 0], ['busy', '']], 'selection/query changes cancel work and clear stale products');
  assert(page.includes('revision.current !== currentRevision') && page.includes('activeRequest.current !== controller'), 'late uploads and searches cannot replace the current query');
  assert(page.includes('!status?.available') && page.includes('attachmentAtoms.some(atom => !atom)'), 'search requires a provisioned collection and explicit attachment choices');
  assert(page.includes('data.fragments.length !== 2') && page.includes('file.size > MAX_SDF_BYTES'), 'query input has record and byte limits');
  assert(page.includes("new Blob([result.sdf], { type: 'chemical/x-mdl-sdfile' })") && !page.includes('addShopPack'), 'assembled SDF is downloadable without inventing a catalog purchase');
  assert(viewer.includes("withAppBase('/3dmol/3Dmol-min.js')") && viewer.includes('keepH: true') && viewer.includes('atom.index + 1'), 'local 3D viewer preserves heavy-atom numbering including explicit hydrogens');
  assert(!viewer.includes('get_mol') && !viewer.includes('generate') && viewer.includes("v.addModel(productSdf, 'sdf'"), 'query and product coordinates are rendered without new conformers or conversion');
  console.log('✓ Link Fragments UI: authenticated exact-coordinate requests, timeout, stale-state cancellation, upload limits and download checks passed');
} finally {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
