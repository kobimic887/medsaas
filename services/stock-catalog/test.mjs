// Pure-helper contract for the Pyxis stock catalog widget.
// Run: bun services/stock-catalog/test.mjs
// The PHP proxy is checked separately (see README "Verify").
import assert from 'node:assert/strict';
import {
  formatAvailable, formulaParts, imagePath, pageCount, readState, writeState,
} from './wordpress/pyxis-stock-catalog/assets/pyxis-catalog.js';

assert.equal(pageCount(636918, 25), 25477);
assert.equal(pageCount(0, 25), 1);

// The shop's CloudFront layout keeps leading zeros from the code string.
assert.equal(imagePath('LAS 100517730'), 'LAS/1005/LAS100517730.svg');
assert.equal(imagePath('BAS 00000525'), 'BAS/0000/BAS00000525.svg');
assert.equal(imagePath('AAM 10376335'), 'AAM/1037/AAM10376335.svg');
assert.equal(imagePath('bad code'), null);
assert.equal(imagePath('BAS 12/../x'), null);

assert.equal(formatAvailable('>100'), '>100 mg');
assert.equal(formatAvailable('9.4'), '9.4 mg');
assert.equal(formatAvailable(''), 'On request');
assert.equal(formatAvailable(undefined), 'On request');

assert.deepEqual(formulaParts('C25H31N3O4S'), {
  atoms: [['C', '25'], ['H', '31'], ['N', '3'], ['O', '4'], ['S', '']], charge: '',
});
assert.deepEqual(formulaParts('C12H14NO4-'), {
  atoms: [['C', '12'], ['H', '14'], ['N', ''], ['O', '4']], charge: '-',
});
assert.equal(formulaParts('C2H8N2+2').charge, '+2');

// Hash state: defaults per sort, bad input, coexistence with other hash params.
assert.deepEqual(readState(''), { sort: 'id', order: 'desc', page: 0 });
assert.deepEqual(readState('#pxc-sort=mw'), { sort: 'mw', order: 'asc', page: 0 });
assert.deepEqual(readState('#pxc-sort=library'), { sort: 'library', order: 'asc', page: 0 });
assert.deepEqual(readState('#pxc-sort=bogus&pxc-order=up&pxc-page=99'), { sort: 'id', order: 'desc', page: 98 });
assert.equal(readState('#pxc-page=-4').page, 0);
assert.equal(readState('#pxc-page=abc').page, 0);
assert.equal(readState('#pxc-page=999999').page, 99999);
const hash = writeState('#other=1', { sort: 'availability', order: 'asc', page: 4 });
assert.equal(hash, '#other=1&pxc-sort=availability&pxc-order=asc&pxc-page=5');
assert.deepEqual(readState(hash), { sort: 'availability', order: 'asc', page: 4 });

console.log('stock-catalog: ok');
