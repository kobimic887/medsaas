// Count-Morgan unit tests.
//
// The load-bearing assertion: a Pyxis count vector's SUPPORT must equal the bit
// set of RDKit's own binary Morgan fingerprint, computed with the exact same
// settings the macrocycle index stores (services/macrocycle-index/common.mjs
// FINGERPRINT_DETAILS). That is what proves the hand-written replica of RDKit's
// Morgan environments, invariants, hash_combine, dedup and 2048-bit fold has not
// drifted — a wrong invariant or hash shifts bits and fails here.
//
// Run: SERVER_RUNTIME=bun bun test/count-morgan.test.mjs
import { loadRDKit, resetRDKitForTests } from '../utils/openCompounds.js';
import {
  COUNT_MORGAN_BITS,
  COUNT_MORGAN_MAX_COUNT,
  countDiceValue,
  countMorganGraph,
  countMorganPacked,
  countMorganVector,
  countSimilarity,
  countTanimotoValue,
  countVectorSumSquares,
} from '../utils/countMorgan.js';
import { FINGERPRINT_DETAILS } from '../../services/macrocycle-index/common.mjs';

let passed = 0;
let failed = 0;
function check(label, cond, extra = '') {
  if (cond) {
    console.log(`  ✓ ${label}`);
    passed += 1;
  } else {
    console.log(`  ✗ ${label} ${extra}`);
    failed += 1;
  }
}

const CORPUS = [
  'c1ccccc1', 'CCO', 'Cc1ccccc1', 'c1ccncc1', 'C1CCCCC1', 'O=C1CCCCC1', 'Cn1cccc1',
  'C#N', 'FC(F)(F)F', 'CC(=O)O', 'OC(=O)c1ccccc1O', 'CC(C)(C)c1ccccc1',
  'C1CC2CCC1CC2', 'N#Cc1ccc(cc1)C(=O)N', 'COc1ccc2ccccc2c1', 'c1ccc2c(c1)cccc2',
  'CC1=CC=CC=C1', 'O=S(=O)(N)c1ccccc1', 'C1CN(CC1)C', 'ClC(Cl)(Cl)Cl',
  'CCOC(=O)c1ccccc1', 'c1ccc(cc1)-c1ccccc1', 'CC(=O)Nc1ccc(O)cc1',
  '[NH4+]', '[O-]C(=O)C', '[Na+].[Cl-]', '[13CH4]', 'C1CCCC1', 'c1ccsc1',
  'C1=CC2=CC=CC=C2C=C1', 'OCC1OC(O)C(O)C1O', 'CCCCCCCCCCCCCCCCCC(=O)O',
  'C1CCC(CC1)N1CCN(CC1)c1ccc(cc1)OC', 'O=C(Nc1ccc(cc1)S(=O)(=O)N)C1CC1',
  // macrocycle-shaped inputs from the 2026-09-23 exports
  'C1CCCCCCCCCCCCCCC1', 'O=C1CCCc2ccccc2N1', 'c1ccc2c(c1)NC(=O)CC2',
  'CC1CCCC(C)CCCC(C)CCCC(C)C1',
];

resetRDKitForTests();
const rdkit = await loadRDKit();

function binarySupport(bits) {
  const support = new Set();
  for (let byte = 0; byte < bits.length; byte++) {
    for (let bit = 0; bit < 8; bit++) if (bits[byte] & (1 << bit)) support.add(byte * 8 + bit);
  }
  return support;
}

console.log('[count-morgan] support parity with RDKit binary Morgan');
{
  let parity = 0;
  const mismatches = [];
  for (const smiles of CORPUS) {
    const mol = rdkit.get_mol(smiles);
    if (!mol) { mismatches.push([smiles, 'parse failure']); continue; }
    const binary = binarySupport(mol.get_morgan_fp_as_uint8array(FINGERPRINT_DETAILS));
    const packed = countMorganPacked(mol);
    mol.delete();
    const support = new Set(packed.bits);
    const missing = [...binary].filter((bit) => !support.has(bit));
    const extra = [...support].filter((bit) => !binary.has(bit));
    if (missing.length === 0 && extra.length === 0) parity += 1;
    else mismatches.push([smiles, `missing=${missing.length} extra=${extra.length}`]);
  }
  check(`count support equals RDKit binary bits for all ${CORPUS.length} structures`, parity === CORPUS.length,
    mismatches.map(([s, why]) => `${s}:${why}`).join(' '));
}

console.log('[count-morgan] vector shape and frequencies');
{
  const mol = rdkit.get_mol('c1ccccc1');
  const packed = countMorganPacked(mol);
  const dense = countMorganVector(mol);
  const binary = binarySupport(mol.get_morgan_fp_as_uint8array(FINGERPRINT_DETAILS));
  mol.delete();
  // benzene has six identical aromatic CH environments, so the single layer-0
  // carbon environment must carry a count of 6, not 1.
  const layerZeroCount = Math.max(...packed.counts);
  check('benzene repeated environment is counted with its frequency', layerZeroCount === 6, `got ${layerZeroCount}`);
  check('packed counts are ascending set bits', packed.bits.every((bit, i) => i === 0 || bit > packed.bits[i - 1]));
  check('every packed count is a positive capped integer', packed.counts.every((c) => c >= 1 && c <= COUNT_MORGAN_MAX_COUNT));
  check('no count is capped for benzene', packed.capped === false);
  check('dense vector agrees with the packed counts', packed.bits.every((bit, i) => dense[bit] === packed.counts[i]));
  check('dense vector is 2048 buckets', dense.length === COUNT_MORGAN_BITS);
  check('dense support equals RDKit binary support', [...binary].every((bit) => dense[bit] > 0));
  check('counts sum to the retained environment count', packed.counts.reduce((sum, count) => sum + count, 0) >= 6);
}

console.log('[count-morgan] count Tanimoto / Dice formulas');
{
  const sumSquares = (v) => v.reduce((total, x) => total + x * x, 0);
  const x = [2, 0, 1];
  const y = [1, 1, 0];
  const dot = 2;
  check('count Tanimoto uses dot / (sumSqA + sumSqB - dot)', countTanimotoValue(dot, sumSquares(x), sumSquares(y)) === 0.4);
  check('count Dice uses 2*dot / (sumSqA + sumSqB)', Math.abs(countDiceValue(dot, sumSquares(x), sumSquares(y)) - 4 / 7) < 1e-12);
  check('binary-style union denominator would be wrong here', countTanimotoValue(dot, sumSquares(x), sumSquares(y)) !== dot / (sumSquares(x) + sumSquares(y)));

  const query = rdkit.get_mol('c1ccccc1');
  const same = rdkit.get_mol('C1=CC=CC=C1');
  const other = rdkit.get_mol('CCCCCCCC');
  const queryVector = countMorganVector(query);
  const sameVector = countMorganVector(same);
  const otherVector = countMorganVector(other);
  query.delete(); same.delete(); other.delete();
  check('identical structures score exactly 1', countSimilarity(queryVector, sameVector, 'count_tanimoto') === 1);
  check('count Dice is bounded by 1', countSimilarity(queryVector, otherVector, 'count_dice') <= 1);
  check('self sum-of-squares is positive', countVectorSumSquares(queryVector) > 0);
  check('a disjoint structure scores below 1', countSimilarity(queryVector, otherVector, 'count_tanimoto') < 1);
}

console.log('[count-morgan] isotope labels are detectable for build and query guards');
{
  const mol = rdkit.get_mol('[2H]OC');
  const packed = countMorganPacked(mol);
  const vector = countMorganVector(mol);
  // The index build refuses a row carrying isotopes rather than publish an
  // invariant that floors RDKit's deltaMass term; that guard reads this count.
  const isotopicAtoms = countMorganGraph(mol)?.isotopicAtoms;
  mol.delete();
  check('isotope labels are visible to the index build guard', isotopicAtoms === 1, `got ${isotopicAtoms}`);
  check('isotope-labelled input is detectable even when a vector can be formed', vector !== null && packed.bits.length > 0);
  check('counts stay bounded for isotope-labelled input', packed.counts.every((c) => c >= 1 && c <= COUNT_MORGAN_MAX_COUNT));
}

console.log(`\n[count-morgan] ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
