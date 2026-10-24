// Pure-helper contract for the public stock catalog widget.
// Run: bun services/stock-catalog/test.mjs
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  chunksFor, formatMass, formulaParts, imagePath, pageCount, pageIndices, readState, writeState,
} from './web/pyxis-catalog.js';

// Pagination over ascending chunk files.
assert.equal(pageCount(630646, 25), 25226);
assert.equal(pageCount(0, 25), 1);
assert.deepEqual(pageIndices(60, 0, 25, 'asc').slice(0, 2), [0, 1]);
assert.deepEqual(pageIndices(60, 2, 25, 'asc'), Array.from({ length: 10 }, (_, i) => 50 + i));
assert.deepEqual(pageIndices(60, 0, 25, 'desc').slice(0, 2), [59, 58]);
assert.deepEqual(pageIndices(60, 2, 25, 'desc'), Array.from({ length: 10 }, (_, i) => 9 - i));
assert.deepEqual(pageIndices(60, 3, 25, 'asc'), []);
// A descending page that straddles a chunk boundary reads both files.
assert.deepEqual(chunksFor(pageIndices(1010, 0, 25, 'desc'), 500), [2, 1]);
assert.deepEqual(chunksFor(pageIndices(1000, 0, 25, 'asc'), 500), [0]);

// Image keys must match scripts/render-structure-images.py exactly.
const smiles = 'COc1ccc(Cn2nnnc2C(c2cc3c(C)cc(C)cc3[nH]c2=O)N2CCN(C)CC2)cc1';
const sha = createHash('sha256').update(smiles, 'utf8').digest('hex');
assert.equal(imagePath(sha), `${sha.slice(0, 2)}/${sha.slice(2, 4)}/${sha}.svg`);

// Display formatting.
assert.equal(formatMass(150), '>100 mg');
assert.equal(formatMass(100), '100 mg');
assert.equal(formatMass(17.2), '17 mg');
assert.equal(formatMass(0.94), '0.9 mg');
assert.equal(formatMass(0.04), '<0.1 mg');
assert.equal(formatMass(0), 'On request');
assert.deepEqual(formulaParts('C25H31N3O4S'), {
  atoms: [['C', '25'], ['H', '31'], ['N', '3'], ['O', '4'], ['S', '']], charge: '',
});
assert.deepEqual(formulaParts('C12H14NO4-'), {
  atoms: [['C', '12'], ['H', '14'], ['N', ''], ['O', '4']], charge: '-',
});
assert.equal(formulaParts('C2H8N2+2').charge, '+2');

// Hash state: defaults, clamping, and coexistence with other hash params.
assert.deepEqual(readState('', 100, 25), { sort: 'id', order: 'desc', page: 0 });
assert.deepEqual(readState('#pxc-sort=mw', 100, 25), { sort: 'mw', order: 'asc', page: 0 });
assert.deepEqual(readState('#pxc-sort=bogus&pxc-order=up&pxc-page=99', 100, 25), { sort: 'id', order: 'desc', page: 3 });
assert.deepEqual(readState('#pxc-page=-4', 100, 25).page, 0);
const hash = writeState('#other=1', { sort: 'availability', order: 'asc', page: 4 });
assert.equal(hash, '#other=1&pxc-sort=availability&pxc-order=asc&pxc-page=5');
assert.deepEqual(readState(hash, 1000, 25), { sort: 'availability', order: 'asc', page: 4 });

console.log('stock-catalog: ok');
