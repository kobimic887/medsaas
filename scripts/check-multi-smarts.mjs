import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { MACROCYCLE_SMARTS_TEXT } from '../client/src/data/macrocycleSmarts.js';
import { parseMultiSmarts, resultSmiles, selectVisibleSmartsRows, smartsVisibleIndices } from '../client/src/utils/multiSmarts.js';

const require = createRequire(new URL('../server/package.json', import.meta.url));
const rdkit = await require(process.env.RDKIT_MODULE || '@rdkit/rdkit')();
const worker = { self: {} };
vm.createContext(worker);
vm.runInContext(readFileSync(new URL('../client/public/workers/multi-smarts.js', import.meta.url), 'utf8'), worker);
const matchRows = async (patterns, rows) => JSON.parse(JSON.stringify(await worker.matchSmartsRows(rdkit, patterns, rows)));

const patterns = parseMultiSmarts(MACROCYCLE_SMARTS_TEXT);
assert.equal(patterns.length, 58);
assert.equal(patterns[0].label, '12member_Macrocycle');
assert.equal(patterns.at(-1).label, '69member_Macrocycle');
const cycle = (size) => `C1${'C'.repeat(size - 1)}1`;
const rings = Array.from({ length: 58 }, (_, i) => cycle(i + 12));
const annotations = await matchRows(patterns, [...rings, cycle(11), cycle(70), 'C'.repeat(70), '', 'invalid SMILES']);
for (let i = 0; i < rings.length; i += 1) {
  assert.deepEqual(annotations[i], { state: 'matched', patternIndices: [i] }, `supplied SMARTS identifies an isolated ${i + 12}-member ring`);
}
for (const i of [58, 59, 60]) assert.deepEqual(annotations[i], { state: 'no-match', patternIndices: [] });
for (const i of [61, 62]) assert.deepEqual(annotations[i], { state: 'unknown', patternIndices: [] });
assert.deepEqual(parseMultiSmarts('[C,N] !!carbon_or_nitrogen\nC-,=C\tbond_alternatives'), [
  { smarts: '[C,N]', label: 'carbon_or_nitrogen' }, { smarts: 'C-,=C', label: 'bond_alternatives' },
]);
assert.throws(() => parseMultiSmarts(''), /at least one/);
assert.throws(() => parseMultiSmarts('C\n'.repeat(101)), /at most 100/);
assert.throws(() => parseMultiSmarts('C'.repeat(65537)), /64 KB/);
await assert.rejects(matchRows([{ smarts: 'notSMARTS', label: 'broken' }], ['CC']), /Invalid SMARTS/);
await assert.rejects(matchRows(patterns, Array(2001).fill('CC')), /2,000/);

// All/any matching is over one immutable row snapshot, with explicit unknowns.
const custom = parseMultiSmarts('[#6] !!Carbon\n[#8] !!Oxygen');
const rows = [
  { id: 'duplicate', SMILES_STRING: 'CC' },
  { id: 'duplicate', SMILES_STRING: 'CO' },
  { SMILES: 'O' },
  { smiles: 'unparseable' },
];
const customAnnotations = await matchRows(custom, rows.map(resultSmiles));
const result = { rows, patterns: custom, annotations: customAnnotations, mode: 'any' };
assert.deepEqual(smartsVisibleIndices(rows, result), [0, 1, 2]);
result.mode = 'all';
assert.deepEqual(smartsVisibleIndices(rows, result), [1]);
result.mode = 'annotate';
assert.deepEqual(smartsVisibleIndices(rows, result), [0, 1, 2, 3]);
result.mode = 'all';
const reordered = [...rows].reverse();
assert.deepEqual(smartsVisibleIndices(reordered, result), [0, 1, 2, 3], 'stale matches cannot filter a new, same-length result list');

// Execute the actual UI's select-all operation on filtered original indices.
// Duplicate IDs and fallback identities must not collapse or renumber rows.
const identity = (row, index) => `${row.id || 'row'}-${index}`;
const visible = smartsVisibleIndices(rows, result);
const previous = new Set(['duplicate-0']);
const selected = selectVisibleSmartsRows(rows, visible, previous, identity, true);
assert.deepEqual([...selected], ['duplicate-0', 'duplicate-1']);
assert.deepEqual([...previous], ['duplicate-0'], 'filter selection never mutates previous state');
const cleared = selectVisibleSmartsRows(rows, visible, selected, identity, false);
assert.deepEqual([...cleared], ['duplicate-0'], 'deselecting filtered rows preserves hidden selections');
assert.equal(rows[1].SMILES_STRING, 'CO');

// Supplied rN atom primitives require RDKit's smallest perceived ring size.
// A fused 6/8 bicyclic structure has a 12-atom perimeter, but no r12 atom.
const fused = 'C1CCC2CCCCCCC2C1';
const fusedMol = rdkit.get_mol(fused);
const ringInfo = JSON.parse(fusedMol.get_json()).molecules[0].extensions.find((entry) => entry.name === 'rdkitRepresentation').atomRings;
assert.deepEqual(ringInfo.map((ring) => ring.length).sort((a, b) => a - b), [6, 8]);
fusedMol.delete();
assert.equal((await matchRows(patterns, [fused]))[0].state, 'no-match', 'preset labels do not classify every possible large graph cycle');

console.log('✓ multi-SMARTS: all 58 supplied queries, exact RDKit ring matching, imports, bounds, unknowns, OR/AND, immutable snapshots and filtered selection identities');
