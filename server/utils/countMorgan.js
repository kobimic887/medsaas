// Count (frequency-weighted) Morgan similarity in RDKit's own bit space.
//
// Why this file exists: @rdkit/rdkit 2025.3.4-1.0.0 exposes only BINARY Morgan
// fingerprints (useCounts / bitInfo are ignored by the WASM binding — verified
// live), and the tonomitosql stock service maps every fingerprint to a binary
// cartridge type. A count metric therefore cannot be delegated to either
// engine, so Pyxis computes the count vector itself — for the query and for the
// library — using RDKit's own Morgan environment rules, its own
// gboost::hash_combine, and its own 2048-bit fold.
//
// The contract that makes this honest:
//   * The SUPPORT of a count vector (bits with count >= 1) is exactly the bit
//     set of the binary Morgan fingerprint RDKit produces for the same
//     molecule. server/test/count-morgan.test.mjs asserts that against
//     RDKit's own output for a diverse corpus, so the replica cannot drift
//     silently.
//   * The counts are the number of retained Morgan environments folding into
//     each bit, including RDKit's neighborhood dedup (includeRedundantEnvironments
//     = false), so this is the same environment list RDKit's count fingerprint
//     would histogram.
//
// This is a Pyxis method, not MOE ctanimoto. The numbers are not comparable with
// MOE and no label may claim MOE equivalence or reproduce MOE's ~2000-hit
// behaviour (docs/REFERENCE-STOCK-FP-METRICS.md).
//
// Known, documented deviation: RDKit's connectivity invariant includes a
// deltaMass term, trunc(mass(isotope) - atomicWeight(element)). That term is
// exactly 0 for every atom without an isotope label, which is every atom in the
// macrocycle corpora — the index build refuses to publish a row that carries an
// isotope label rather than index a subtly different invariant. The search
// service rejects isotope-labelled queries for count metrics; binary Tanimoto
// remains available for those queries.

export const COUNT_MORGAN_RADIUS = 2;
export const COUNT_MORGAN_BITS = 2048;
export const COUNT_MORGAN_MAX_COUNT = 255;

const AROMATIC_BOND_TYPE = 12;

/** gboost::hash_combine over uint32 (RDGeneral/hash/hash.hpp). */
function hashCombine(seed, value) {
  const shifted = (value + 0x9e3779b9) >>> 0;
  const withLeft = (shifted + ((seed << 6) >>> 0)) >>> 0;
  return (seed ^ ((withLeft + (seed >>> 2)) >>> 0)) >>> 0;
}

/** gboost::hash_value(std::pair<int32_t, uint32_t>) — bond invariant + neighbor code. */
function hashPair(first, second) {
  return hashCombine(hashCombine(0, first >>> 0), second >>> 0);
}

function hashComponents(components) {
  let seed = 0;
  for (const component of components) seed = hashCombine(seed, component >>> 0);
  return seed;
}

/**
 * Build the atom/bond view of one RDKit molecule from its JSON graph.
 * `source` is either an RDKit mol (uses get_json()) or a get_json() value.
 */
export function countMorganGraph(source) {
  if (!source) return null;
  const json = typeof source.get_json === 'function' ? source.get_json() : source;
  const parsed = typeof json === 'string' ? JSON.parse(json) : json;
  const molecule = parsed?.molecules?.[0];
  if (!molecule || !Array.isArray(molecule.atoms) || molecule.atoms.length === 0) return null;

  const atomDefaults = parsed?.defaults?.atom || {};
  const bondDefaults = parsed?.defaults?.bond || {};
  const extension = (molecule.extensions || [])
    .find((entry) => entry && entry.name === 'rdkitRepresentation') || {};
  const aromaticBonds = new Set(extension.aromaticBonds || []);
  const ringAtoms = new Set();
  for (const ring of extension.atomRings || []) {
    for (const atomIndex of ring) ringAtoms.add(atomIndex);
  }

  const rawBonds = Array.isArray(molecule.bonds) ? molecule.bonds : [];
  const degree = new Array(molecule.atoms.length).fill(0);
  const neighbors = Array.from({ length: molecule.atoms.length }, () => []);
  for (let index = 0; index < rawBonds.length; index++) {
    const bond = { ...bondDefaults, ...rawBonds[index] };
    const [from, to] = bond.atoms || [];
    if (!Number.isInteger(from) || !Number.isInteger(to)) continue;
    // RDKit's real bond type is AROMATIC for aromatic bonds; the JSON writer
    // emits a kekulized order, so the aromatic index list is authoritative.
    const type = aromaticBonds.has(index) ? AROMATIC_BOND_TYPE : Number(bond.bo ?? 1);
    degree[from] += 1;
    degree[to] += 1;
    neighbors[from].push({ to, type, index });
    neighbors[to].push({ to: from, type, index });
  }

  const atoms = molecule.atoms.map((raw, index) => {
    const atom = { ...atomDefaults, ...raw };
    return {
      atomicNumber: Number(atom.z ?? 6),
      // RDKit's JSON "impHs" is the total hydrogen count (implicit + explicit).
      hydrogens: Number(atom.impHs ?? 0),
      charge: Number(atom.chg ?? 0),
      isotope: Number(atom.isotope ?? 0),
      degree: degree[index],
      inRing: ringAtoms.has(index),
    };
  });
  const hydrogenNeighbors = neighbors.map((list) => {
    let count = 0;
    for (const edge of list) if (atoms[edge.to].atomicNumber === 1) count += 1;
    return count;
  });

  return { atoms, neighbors, hydrogenNeighbors, isotopicAtoms: atoms.filter((a) => a.isotope !== 0).length };
}

/** RDKit MorganAtomInvGenerator::getAtomInvariants (connectivity invariants). */
function connectivityInvariants(graph) {
  return graph.atoms.map((atom, index) => {
    const components = [
      atom.atomicNumber,
      atom.hydrogens + atom.degree, // Atom::getTotalDegree()
      atom.hydrogens + graph.hydrogenNeighbors[index], // Atom::getTotalNumHs(true)
      atom.charge,
      0, // deltaMass — see the module note
    ];
    if (atom.inRing) components.push(1); // MorganAtomInvGenerator includeRingMembership
    return hashComponents(components);
  });
}

/** Canonical key for one accumulated bond neighborhood (equality grouping only). */
function bondSetKey(bondSet) {
  const sorted = [...bondSet].sort((a, b) => a - b);
  let key = '';
  for (const bond of sorted) key += `${bond}.`;
  return key;
}

/**
 * Every Morgan environment RDKit's generator retains for this molecule, as the
 * 2048-bit bucket each folds into (bitId = code % fpSize). The order is RDKit's
 * layer order; duplicates are preserved so callers can histogram them.
 */
function environmentBitsFromGraph(graph, options = {}) {
  const radius = options.radius ?? COUNT_MORGAN_RADIUS;
  const nBits = options.nBits ?? COUNT_MORGAN_BITS;
  const atomCount = graph.atoms.length;
  let invariants = connectivityInvariants(graph);
  const bits = new Array(atomCount);
  for (let index = 0; index < atomCount; index++) bits[index] = invariants[index] % nBits;

  if (radius === 0) return bits;

  // RDKit keeps one environment per distinct neighborhood; the survivor is the
  // first in std::sort order, which for equal neighborhoods is the smallest
  // (code, atomIndex). Neighborhoods seen in earlier layers also dedupe.
  const seen = new Set();
  const dead = new Array(atomCount).fill(false);
  let previous = Array.from({ length: atomCount }, () => new Set());

  for (let layer = 0; layer < radius; layer++) {
    // RDKit accumulates into a copy of last round's neighborhoods while reading
    // last round's values, so the round is order independent.
    const current = previous.map((bondSet) => new Set(bondSet));
    const candidates = [];
    for (let index = 0; index < atomCount; index++) {
      if (dead[index]) continue;
      if (graph.atoms[index].degree === 0) { dead[index] = true; continue; }
      for (const edge of graph.neighbors[index]) {
        current[index].add(edge.index);
        for (const bond of previous[edge.to]) current[index].add(bond);
      }
      let code = hashCombine(layer, invariants[index]);
      const pairs = graph.neighbors[index].map((edge) => [edge.type, invariants[edge.to]]);
      pairs.sort((a, b) => (a[0] - b[0]) || ((a[1] >>> 0) - (b[1] >>> 0)));
      for (const [bondType, neighborCode] of pairs) code = hashCombine(code, hashPair(bondType, neighborCode));
      candidates.push({ atom: index, code, key: bondSetKey(current[index]) });
    }
    candidates.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)
      || ((a.code >>> 0) - (b.code >>> 0)) || (a.atom - b.atom));
    const nextInvariants = new Array(atomCount).fill(0);
    for (const candidate of candidates) {
      if (seen.has(candidate.key)) { dead[candidate.atom] = true; continue; }
      seen.add(candidate.key);
      bits.push(candidate.code % nBits);
      nextInvariants[candidate.atom] = candidate.code;
    }
    previous = current;
    invariants = nextInvariants;
  }
  return bits;
}

/** Sparse count vector: ascending set bits with their (capped) frequencies. */
export function countMorganPacked(mol, options = {}) {
  const graph = countMorganGraph(mol);
  if (!graph) return null;
  const bits = environmentBitsFromGraph(graph, options);
  const histogram = new Map();
  for (const bit of bits) histogram.set(bit, (histogram.get(bit) || 0) + 1);
  const sorted = [...histogram.keys()].sort((a, b) => a - b);
  let capped = false;
  const counts = Uint8Array.from(sorted, (bit) => {
    const count = histogram.get(bit);
    if (count > COUNT_MORGAN_MAX_COUNT) capped = true;
    return Math.min(count, COUNT_MORGAN_MAX_COUNT);
  });
  return {
    bits: Int32Array.from(sorted),
    counts,
    capped,
    // See the module note: the index build refuses isotope-labelled rows.
    isotopic: graph.isotopicAtoms > 0,
    atomCount: graph.atoms.length,
  };
}

/** Dense count vector (2048 uint8) for a query structure. */
export function countMorganVector(mol, options = {}) {
  const graph = countMorganGraph(mol);
  if (!graph) return null;
  const nBits = options.nBits ?? COUNT_MORGAN_BITS;
  const bits = environmentBitsFromGraph(graph, options);
  const vector = new Uint8Array(nBits);
  for (const bit of bits) {
    if (vector[bit] < COUNT_MORGAN_MAX_COUNT) vector[bit] += 1;
  }
  return vector;
}

export function countVectorSumSquares(vector) {
  let sumSquares = 0;
  for (let bit = 0; bit < vector.length; bit++) sumSquares += vector[bit] * vector[bit];
  return sumSquares;
}

/** Anna's ctanimoto denominator: dot / (sumSqA + sumSqB - dot). */
export function countTanimotoValue(dot, sumSquaresA, sumSquaresB) {
  const denominator = sumSquaresA + sumSquaresB - dot;
  return denominator > 0 ? dot / denominator : 0;
}

export function countDiceValue(dot, sumSquaresA, sumSquaresB) {
  const denominator = sumSquaresA + sumSquaresB;
  return denominator > 0 ? (2 * dot) / denominator : 0;
}

export function countMetricValue(metric, dot, sumSquaresA, sumSquaresB) {
  return metric === 'count_dice'
    ? countDiceValue(dot, sumSquaresA, sumSquaresB)
    : countTanimotoValue(dot, sumSquaresA, sumSquaresB);
}

/** Similarity between two dense count vectors (test/utility helper). */
export function countSimilarity(a, b, metric = 'count_tanimoto') {
  if (!a || !b) return 0;
  let dot = 0;
  const n = Math.min(a.length, b.length);
  for (let bit = 0; bit < n; bit++) dot += a[bit] * b[bit];
  return countMetricValue(metric, dot, countVectorSumSquares(a), countVectorSumSquares(b));
}
