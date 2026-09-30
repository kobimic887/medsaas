// RDKit's minimal browser API provides amw, but not calcMolFormula. Count the
// elements and implicit hydrogens in its parsed JSON, never in SMILES text.
const ELEMENTS = 'H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca Sc Ti V Cr Mn Fe Co Ni Cu Zn Ga Ge As Se Br Kr Rb Sr Y Zr Nb Mo Tc Ru Rh Pd Ag Cd In Sn Sb Te I Xe Cs Ba La Ce Pr Nd Pm Sm Eu Gd Tb Dy Ho Er Tm Yb Lu Hf Ta W Re Os Ir Pt Au Hg Tl Pb Bi Po At Rn Fr Ra Ac Th Pa U Np Pu Am Cm Bk Cf Es Fm Md No Lr Rf Db Sg Bh Hs Mt Ds Rg Cn Nh Fl Mc Lv Ts Og'.split(' ');

export function formulaFromRdkitJson(json) {
  const atoms = json?.molecules?.[0]?.atoms;
  if (!Array.isArray(atoms) || atoms.length === 0) return null;
  const defaults = json.defaults?.atom || {};
  const counts = new Map();
  let charge = 0;
  for (const atom of atoms) {
    const z = atom.z ?? defaults.z;
    const symbol = ELEMENTS[z - 1];
    const hydrogens = atom.impHs ?? defaults.impHs ?? 0;
    const atomCharge = atom.chg ?? defaults.chg ?? 0;
    if (!Number.isInteger(z) || !symbol || !Number.isInteger(hydrogens) || hydrogens < 0 || !Number.isInteger(atomCharge)) return null;
    counts.set(symbol, (counts.get(symbol) || 0) + 1);
    if (hydrogens) counts.set('H', (counts.get('H') || 0) + hydrogens);
    charge += atomCharge;
  }
  const symbols = [...counts.keys()].sort();
  const order = counts.has('C') ? ['C', ...(counts.has('H') ? ['H'] : []), ...symbols.filter(symbol => symbol !== 'C' && symbol !== 'H')] : symbols;
  const formula = order.map(symbol => `${symbol}${counts.get(symbol) === 1 ? '' : counts.get(symbol)}`).join('');
  return formula + (charge ? `${charge > 0 ? '+' : '-'}${Math.abs(charge) === 1 ? '' : Math.abs(charge)}` : '');
}

export function calculateCompoundDescriptors(rdkit, smiles) {
  let molecule;
  try {
    molecule = rdkit.get_mol(smiles);
    if (!molecule?.is_valid()) throw new Error('Invalid structure');
    const formula = formulaFromRdkitJson(JSON.parse(molecule.get_json()));
    const mw = JSON.parse(molecule.get_descriptors()).amw;
    if (!formula || !Number.isFinite(mw) || mw <= 0) throw new Error('Descriptors unavailable');
    return { formula, mw };
  } finally {
    molecule?.delete();
  }
}

// Share work across both cells and repeated structures without retaining every
// page of a large search. Failed loads can retry after the row is remounted.
const descriptorCache = new Map();
export function loadCompoundDescriptors(smiles, loadRdkit = () => window.loadRDKit()) {
  if (!descriptorCache.has(smiles)) {
    const promise = Promise.resolve().then(loadRdkit).then(rdkit => calculateCompoundDescriptors(rdkit, smiles));
    descriptorCache.set(smiles, promise);
    promise.catch(() => { if (descriptorCache.get(smiles) === promise) descriptorCache.delete(smiles); });
    if (descriptorCache.size > 300) descriptorCache.delete(descriptorCache.keys().next().value);
  }
  return descriptorCache.get(smiles);
}
