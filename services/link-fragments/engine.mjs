import { createHash } from 'node:crypto';
import { scoreReceptor, compareReceptorScores } from './receptor.mjs';
import initRDKit from '../../server/node_modules/@rdkit/rdkit/dist/RDKit_minimal.js';
import {
  LinkFragmentsError,
  parseSdf,
  neighbors,
  writeMolBlock,
  writeSdf,
} from './sdf.mjs';
import {
  add,
  sub,
  scale,
  unit,
  cross,
  dot,
  distance,
  angle,
  twoAnchorTransform,
  rotateAround,
} from './geometry.mjs';
let chemistry;
const rdkit = () => (chemistry ||= initRDKit());
const error = (code, message, detail) => {
  throw new LinkFragmentsError(code, message, detail);
};
const structured = (e) =>
  e instanceof LinkFragmentsError
    ? e.toJSON()
    : {
        code: 'INVALID_CHEMISTRY',
        message: 'Molecule could not be chemically validated.',
      };
// maxBondLength only caps the element-pair bounds below; C–S needs 2.05 Å.
export const DEFAULT_SETTINGS = Object.freeze({
  maxRmsd: 0.5,
  torsionStepDegrees: 10,
  minBondLength: 1.15,
  maxBondLength: 2.05,
  minAttachmentAngle: 85,
  clashScale: 0.55,
});
export const METHOD =
  'Rigid two-anchor fit with torsion scan; uploaded fragment coordinates fixed; the selected hydrogen (implicit or explicit) is replaced by the linker bond; unused He labels capped by H; no energy minimization.';
const radii = {
  H: 1.2,
  D: 1.2,
  T: 1.2,
  C: 1.7,
  N: 1.55,
  O: 1.52,
  F: 1.47,
  P: 1.8,
  S: 1.8,
  Cl: 1.75,
  Br: 1.85,
  I: 1.98,
};
const HYDROGENS = new Set(['H', 'D', 'T']);
/** Attachment centres validated for both the query and the linker side. P is refused. */
export const ATTACHMENT_ELEMENTS = Object.freeze(['C', 'N', 'O', 'S']);
// Nominal anchor length for C/N pairs depends on the query element only; these
// original values keep implicit-H C/N results identical to the first release.
const bondLengths = { C: 1.5, N: 1.45 };
// Supported single-bond connections: [min, max] Å and, for new pairs, a nominal
// length. Peroxide-like O–O, O–S and S–S connections stay refused.
const connections = {
  'C-C': { bounds: [1.3, 1.85] },
  'C-N': { bounds: [1.3, 1.85] },
  'N-N': { bounds: [1.25, 1.8] },
  'C-O': { nominal: 1.43, bounds: [1.25, 1.7] },
  'C-S': { nominal: 1.82, bounds: [1.6, 2.05] },
  'N-O': { nominal: 1.42, bounds: [1.25, 1.75] },
  'N-S': { nominal: 1.7, bounds: [1.5, 1.95] },
};
// Two-coordinate O/S bond-angle windows (ethers ~105–120°, thioethers ~99–105°).
const bentBounds = { O: [95, 135], S: [85, 120] };
const connectionKey = (a, b) => (a < b ? `${a}-${b}` : `${b}-${a}`);
const unsupportedConnection = () => ({
  code: 'UNSUPPORTED_ATTACHMENT_GEOMETRY',
  message:
    'Only C–C, C–N, N–N, C–O, C–S, N–O and N–S single-bond connections are supported.',
});
/** Anchor length used to place the linker; null when the element pair is refused. */
export function connectionLength(queryElement, linkerElement) {
  const c = connections[connectionKey(queryElement, linkerElement)];
  return c ? (c.nominal ?? bondLengths[queryElement]) : null;
}
/** The library indexes anchors at this nominal length along each He direction. */
export const INDEX_ANCHOR_LENGTH = 1.5;
/**
 * Safe prefilter on indexed 1.5 Å anchor distances. Anchors slide along unit
 * vectors, so |d_engine - d_1.5| <= |l_a - 1.5| + |l_b - 1.5| (triangle
 * inequality) and the engine accepts only |d_engine - D| <= 2 maxRmsd.
 */
export function candidateDistanceWindow(
  prepared,
  maxRmsd,
  linkerElements = ATTACHMENT_ELEMENTS,
) {
  if (!prepared?.ok || !Number.isFinite(prepared.distance))
    error('INVALID_QUERY', 'Prepare a valid two-fragment query first.');
  if (!Number.isFinite(maxRmsd) || maxRmsd < 0)
    error('INVALID_SETTINGS', 'Invalid maxRmsd.');
  const deviation = (queryElement) =>
    Math.max(
      0,
      ...linkerElements
        .map((l) => connectionLength(queryElement, l))
        .filter((l) => l !== null)
        .map((l) => Math.abs(l - INDEX_ANCHOR_LENGTH)),
    );
  const margin =
    2 * maxRmsd +
    prepared.attachments.reduce((s, a) => s + deviation(a.element), 0) +
    1e-6;
  return {
    lo: Math.max(0, prepared.distance - margin),
    hi: prepared.distance + margin,
    margin,
  };
}
function connected(m) {
  const seen = new Set([0]),
    pending = [0];
  while (pending.length)
    for (const n of neighbors(m, pending.pop()))
      if (!seen.has(n.index)) {
        seen.add(n.index);
        pending.push(n.index);
      }
  return seen.size === m.atoms.length;
}
async function validate(m, { descriptors = true, json = true } = {}) {
  const toolkit = await rdkit();
  let mol;
  try {
    mol = toolkit.get_mol(writeMolBlock(m), '{"removeHs":false}');
    if (!mol?.is_valid())
      error(
        'INVALID_CHEMISTRY',
        'Invalid valence or unsupported molecular structure.',
      );
    return {
      smiles: descriptors ? mol.get_smiles() : null,
      descriptors: descriptors ? JSON.parse(mol.get_descriptors()) : null,
      json: json ? JSON.parse(mol.get_json()) : null,
    };
  } finally {
    mol?.delete();
  }
}
const aromaticAtoms = (validation) =>
  new Set(
    validation.json.molecules[0].extensions?.find(
      (extension) => extension.name === 'rdkitRepresentation',
    )?.aromaticAtoms || [],
  );
function adjacencyOf(m) {
  const adjacency = m.atoms.map(() => []);
  for (const b of m.bonds) {
    adjacency[b.a].push({ index: b.b, order: b.order });
    adjacency[b.b].push({ index: b.a, order: b.order });
  }
  return adjacency;
}
/**
 * Per-atom attachment eligibility before any geometry. `code` is internal:
 * prepareQuery reports it; inspection shows `reason`.
 */
function attachmentSites(m, validation) {
  const json = validation.json.molecules[0],
    aromatic = aromaticAtoms(validation),
    adjacency = adjacencyOf(m);
  return m.atoms.map((atom, index) => {
    const info = json.atoms[index] || {},
      ns = adjacency[index],
      implicitHydrogens = info.impHs || 0;
    const site = {
      atom: index + 1,
      element: atom.element,
      charge: atom.charge || 0,
      isotope: atom.isotope || null,
      aromatic: aromatic.has(index),
      heavy: !HYDROGENS.has(atom.element),
      eligible: false,
      reason: null,
      implicitHydrogens,
      explicitHydrogens: [],
      recommendedHydrogenAtom: null,
      requiresHydrogenSelection: false,
    };
    const refuse = (code, reason) => ({ ...site, reason, code });
    if (!site.heavy)
      return refuse(
        'INVALID_ATTACHMENT',
        ns.length === 1
          ? `Hydrogen atom: select heavy atom ${ns[0].index + 1}; this hydrogen can then be chosen for replacement.`
          : 'Hydrogen atom: hydrogens are replaced, never used as attachment centres.',
      );
    if (!ATTACHMENT_ELEMENTS.includes(atom.element))
      return refuse(
        'UNSUPPORTED_ATTACHMENT',
        atom.element === 'P'
          ? 'Phosphorus attachment centres are not validated yet; choose C, N, O or S.'
          : `${atom.element} is not a supported attachment centre; choose C, N, O or S.`,
      );
    if (info.nRad)
      return refuse(
        'ATTACHMENT_RADICAL',
        'Radical centres cannot be attachment points.',
      );
    const hydrogens = ns.filter(
      (n) =>
        n.order === 1 &&
        HYDROGENS.has(m.atoms[n.index].element) &&
        adjacency[n.index].length === 1,
    );
    const replaceable = hydrogens.filter((n) => !m.atoms[n.index].charge);
    // Isotope-labelled H (D, T or any M ISO on H) is never chosen automatically.
    const ordinary = replaceable.filter(
      (n) => m.atoms[n.index].element === 'H' && !m.atoms[n.index].isotope,
    );
    site.explicitHydrogens = replaceable.map((n) => n.index + 1);
    if (!implicitHydrogens && !replaceable.length)
      return refuse(
        'ATTACHMENT_NO_HYDROGEN',
        hydrogens.length
          ? 'Only charged hydrogens are attached; they cannot be replaced.'
          : 'No replaceable hydrogen: this atom is saturated or fully substituted.',
      );
    if (
      (atom.element === 'O' || atom.element === 'S') &&
      (atom.charge ||
        site.aromatic ||
        ns.length + implicitHydrogens !== 2 ||
        ns.some((n) => n.order !== 1))
    )
      return refuse(
        'UNSUPPORTED_ATTACHMENT',
        `${atom.element === 'O' ? 'Oxygen' : 'Sulfur'} attachment is limited to neutral, two-coordinate, single-bonded ${atom.element}–H centres.`,
      );
    const requiresHydrogenSelection = !implicitHydrogens && !ordinary.length;
    return {
      ...site,
      eligible: true,
      reason: requiresHydrogenSelection
        ? 'Only isotope-labelled hydrogens are attached; select the hydrogen to replace explicitly.'
        : null,
      recommendedHydrogenAtom:
        implicitHydrogens || !ordinary.length ? null : ordinary[0].index + 1,
      requiresHydrogenSelection,
    };
  });
}
function structuralError(m) {
  if (!m.is3D)
    error(
      'QUERY_NOT_3D',
      'Query records must contain 3D coordinates (a 3D molfile header).',
    );
  if (!connected(m))
    error(
      'DISCONNECTED_FRAGMENT',
      'Each query record must contain one connected fragment.',
    );
  if (m.bonds.some((b) => distance(m.atoms[b.a].xyz, m.atoms[b.b].xyz) < 0.1))
    error('INVALID_COORDINATES', 'Query has a bond with coincident coordinates.');
}
/** Eligible attachment sites and a reason for every ineligible atom, before any search. */
export async function inspectAttachmentSites(sdf) {
  try {
    const fragments = parseSdf(sdf);
    if (fragments.length !== 2)
      error(
        'QUERY_FRAGMENT_COUNT',
        'Supply exactly two molecular records in the same 3D coordinate frame.',
      );
    if (fragments.some((fragment) => fragment.atoms.length > 200))
      error(
        'QUERY_TOO_LARGE',
        'Each query fragment may contain at most 200 atoms.',
      );
    const result = [];
    for (const m of fragments) {
      structuralError(m);
      const sites = attachmentSites(m, await validate(m));
      result.push({
        name: m.title,
        atoms: sites.map(({ code, ...site }) => site),
      });
    }
    return { ok: true, fragments: result };
  } catch (e) {
    return { ok: false, errors: [structured(e)] };
  }
}
const selectionOf = (value) =>
  Number.isInteger(value)
    ? { atom: value }
    : value && typeof value === 'object' && Number.isInteger(value.atom)
      ? { atom: value.atom, hydrogenAtom: value.hydrogenAtom ?? undefined }
      : null;
/**
 * attachments = [sel, sel]; sel is a one-based atom number or {atom, hydrogenAtom?}.
 * Without hydrogenAtom an implicit H is used when present, otherwise the
 * recommended ordinary explicit H is removed and the linker bonds in its place.
 */
export async function prepareQuery(sdf, attachmentAtoms) {
  try {
    const fragments = parseSdf(sdf);
    if (fragments.length !== 2)
      error(
        'QUERY_FRAGMENT_COUNT',
        'Supply exactly two molecular records in the same 3D coordinate frame.',
      );
    if (fragments.some((fragment) => fragment.atoms.length > 200))
      error(
        'QUERY_TOO_LARGE',
        'Each query fragment may contain at most 200 atoms.',
      );
    if (!Array.isArray(attachmentAtoms) || attachmentAtoms.length !== 2)
      error(
        'ATTACHMENT_REQUIRED',
        'Select one one-based atom number in each fragment.',
      );
    const attachments = [];
    for (let i = 0; i < 2; i++) {
      const m = fragments[i],
        selection = selectionOf(attachmentAtoms[i]),
        index = selection ? selection.atom - 1 : NaN,
        atom = m.atoms[index];
      structuralError(m);
      if (
        !Number.isInteger(index) ||
        !atom ||
        HYDROGENS.has(atom.element) ||
        atom.element === 'He'
      )
        error('INVALID_ATTACHMENT', `Fragment ${i + 1}: select a heavy atom.`);
      if (!ATTACHMENT_ELEMENTS.includes(atom.element))
        error(
          'UNSUPPORTED_ATTACHMENT',
          `Fragment ${i + 1}: supported attachment centres are C, N, O and S.`,
        );
      const validation = await validate(m),
        aj = validation.json.molecules[0].atoms[index],
        aromatic = aromaticAtoms(validation);
      m.atoms.forEach((a, atomIndex) => {
        a.aromatic = aromatic.has(atomIndex);
      });
      const site = attachmentSites(m, validation)[index];
      if (!site.eligible) error(site.code, `Fragment ${i + 1}: ${site.reason}`);
      let removedHydrogenIndex = null;
      if (selection.hydrogenAtom !== undefined) {
        if (!site.explicitHydrogens.includes(selection.hydrogenAtom))
          error(
            'INVALID_HYDROGEN_SELECTION',
            `Fragment ${i + 1}: atom ${selection.hydrogenAtom} is not a neutral, singly bonded hydrogen on atom ${selection.atom}.`,
          );
        removedHydrogenIndex = selection.hydrogenAtom - 1;
      } else if (!site.implicitHydrogens) {
        if (site.requiresHydrogenSelection)
          error(
            'ISOTOPE_H_SELECTION_REQUIRED',
            `Fragment ${i + 1}: atom ${selection.atom} carries only isotope-labelled hydrogens; select the one to replace.`,
          );
        removedHydrogenIndex = site.recommendedHydrogenAtom - 1;
      }
      const ns = neighbors(m, index).filter(
          (n) => n.index !== removedHydrogenIndex,
        ),
        vectors = ns.map((n) => unit(sub(m.atoms[n.index].xyz, atom.xyz)));
      let exitDirection = null,
        maxExitAngle = 65;
      if (removedHydrogenIndex !== null) {
        // The linker takes this hydrogen's place. The bond must stay closer to
        // the removed H than to any surviving neighbour (half the smallest
        // H–X–neighbour angle), so the new stereo configuration is unambiguous.
        exitDirection = unit(sub(m.atoms[removedHydrogenIndex].xyz, atom.xyz));
        const spread = Math.min(
          ...vectors.map((v) => angle(exitDirection, v)),
        );
        maxExitAngle = Math.min(35, spread / 2 - 1);
      } else if (
        // One missing H at a tetrahedral carbon has a defined hemisphere. A
        // methyl group has three possible directions and gets no invented vector.
        atom.element === 'C' &&
        aj.impHs === 1 &&
        vectors.length === 3 &&
        vectors.every(Boolean) &&
        Math.abs(dot(vectors[0], cross(vectors[1], vectors[2]))) > 0.05
      )
        exitDirection = unit(scale(vectors.reduce(add, [0, 0, 0]), -1));
      attachments.push({
        fragment: i + 1,
        atom: index + 1,
        index,
        element: atom.element,
        xyz: atom.xyz,
        implicitHydrogens: aj.impHs || 0,
        hydrogen: removedHydrogenIndex === null ? 'implicit' : 'explicit',
        removedHydrogenIndex,
        removedHydrogenAtom:
          removedHydrogenIndex === null ? null : removedHydrogenIndex + 1,
        exitDirection,
        maxExitAngle,
      });
    }
    if (distance(attachments[0].xyz, attachments[1].xyz) < 0.5)
      error(
        'OVERLAPPING_ATTACHMENTS',
        'Attachment points must be separated in the supplied 3D frame.',
      );
    const surviving = (f) =>
      fragments[f].atoms.filter(
        (_, i) => i !== attachments[f].removedHydrogenIndex,
      );
    for (const a of surviving(0))
      for (const b of surviving(1))
        if (
          distance(a.xyz, b.xyz) <
          DEFAULT_SETTINGS.clashScale *
            ((radii[a.element] || 1.8) + (radii[b.element] || 1.8))
        )
          error(
            'FRAGMENT_CLASH',
            'The two fixed query fragments contain a severe nonbonded overlap.',
          );
    return {
      ok: true,
      fragments,
      attachments,
      distance: distance(attachments[0].xyz, attachments[1].xyz),
    };
  } catch (e) {
    return { ok: false, errors: [structured(e)] };
  }
}
/** Pairs are indexed separately; unused He labels are hydrogen caps, never purchase IDs. */
export function linkerDescriptor(sdf) {
  try {
    const records = typeof sdf === 'string' ? parseSdf(sdf) : [sdf];
    if (records.length !== 1)
      error(
        'LINKER_RECORD_COUNT',
        'A linker descriptor requires one molecular record.',
      );
    const molecule = records[0];
    if (!molecule.is3D || !connected(molecule))
      error(
        'INVALID_LINKER',
        'Linker must be one connected 3D molecular record.',
      );
    const labels = molecule.atoms.flatMap((a, i) =>
      a.element === 'He' ? [i] : [],
    );
    if (labels.length < 2 || labels.length > 8)
      error(
        'LINKER_LABEL_COUNT',
        'Linker requires two to eight He attachment labels.',
      );
    const sites = labels.map((i) => {
      const ns = neighbors(molecule, i);
      if (
        ns.length !== 1 ||
        ns[0].order !== 1 ||
        ['H', 'He'].includes(molecule.atoms[ns[0].index].element) ||
        molecule.atoms[i].charge ||
        molecule.atoms[i].isotope
      )
        error(
          'INVALID_LINKER_LABEL',
          'Each neutral He label must have exactly one single bond to a heavy atom.',
        );
      const direction = unit(
        sub(molecule.atoms[i].xyz, molecule.atoms[ns[0].index].xyz),
      );
      if (!direction)
        error(
          'INVALID_LINKER_LABEL',
          'A He label cannot coincide with its neighbor.',
        );
      return {
        atom: i + 1,
        index: i,
        neighbor: ns[0].index,
        direction,
        neighborPosition: molecule.atoms[ns[0].index].xyz,
      };
    });
    const pairs = [];
    for (let i = 0; i < sites.length; i++)
      for (let j = i + 1; j < sites.length; j++) {
        const a = sites[i],
          b = sites[j];
        if (a.neighbor === b.neighbor) continue;
        const anchors = [a, b].map((s) =>
          add(s.neighborPosition, scale(s.direction, 1.5)),
        );
        pairs.push({
          a: a.atom,
          b: b.atom,
          distance: distance(...anchors),
          anchors,
        });
      }
    if (!pairs.length)
      error(
        'INVALID_LINKER_LABEL',
        'No pair of labels on distinct linker atoms is available.',
      );
    return {
      ok: true,
      molecule,
      sites,
      pairs,
      atomCount: molecule.atoms.length,
      labelCount: labels.length,
    };
  } catch (e) {
    return { ok: false, errors: [structured(e)] };
  }
}
const parityInversions = (mapped) => {
  let inversions = 0;
  for (let x = 0; x < mapped.length; x++)
    for (let y = x + 1; y < mapped.length; y++)
      if (mapped[x] > mapped[y]) inversions++;
  return inversions;
};
/**
 * V2000 atom parity numbers a centre's neighbours by atom number, except that
 * any hydrogen (explicit H/D/T or implicit H) ranks highest (the CTfile rule
 * RDKit follows). `rank` turns a neighbour into that sort key.
 */
const IMPLICIT_H_RANK = 2e6;
const parityRank = (element, index) =>
  (HYDROGENS.has(element) ? 1e6 : 0) + index;
/**
 * The parity describing the same 3D arrangement after renumbering/relabelling
 * the neighbours; each entry is {before, after} rank.
 */
function remapParity(parity, ranks) {
  if (![1, 2].includes(parity)) return parity;
  const mapped = [...ranks]
    .sort((x, y) => x.before - y.before)
    .map((r) => r.after);
  return parityInversions(mapped) % 2 ? 3 - parity : parity;
}
function join(prepared, descriptor, selected, transform) {
  const atoms = [],
    bonds = [],
    maps = [];
  for (const [f, fragment] of prepared.fragments.entries()) {
    const removedH = prepared.attachments[f].removedHydrogenIndex;
    const map = fragment.atoms.map((a, atomIndex) => {
      if (atomIndex === removedH) return null;
      atoms.push({ ...a, xyz: [...a.xyz] });
      return atoms.length - 1;
    });
    maps.push(map);
    bonds.push(
      ...fragment.bonds
        .filter((b) => b.a !== removedH && b.b !== removedH)
        .map((b) => ({ ...b, a: map[b.a], b: map[b.b] })),
    );
  }
  const fragmentCount = atoms.length;
  const removed = new Set(selected.map((s) => s.index)),
    linkerMap = [];
  descriptor.molecule.atoms.forEach((a, i) => {
    if (removed.has(i)) return;
    linkerMap[i] = atoms.length;
    atoms.push({
      ...a,
      element: a.element === 'He' ? 'H' : a.element,
      parity: a.element === 'He' ? 0 : a.parity,
      xyz: transform(a.xyz),
    });
  });
  descriptor.molecule.bonds.forEach((b) => {
    if (!removed.has(b.a) && !removed.has(b.b))
      bonds.push({ ...b, a: linkerMap[b.a], b: linkerMap[b.b] });
  });
  selected.forEach((s, i) => {
    bonds.push({
      a: maps[i][prepared.attachments[i].index],
      b: linkerMap[s.neighbor],
      order: 1,
      tail: '  0  0  0  0',
    });
  });
  // V2000 parity is relative to neighbour ranks (atom number, hydrogens last).
  // Removing the replaced H keeps the order of every other fragment atom, so
  // only an attachment centre can change: its replaced H (explicit, or the
  // implicit H that ranked highest) becomes a heavy linker atom.
  prepared.fragments.forEach((fragment, f) => {
    const { index: center, removedHydrogenIndex: removedH } =
        prepared.attachments[f],
      linkerAtom = linkerMap[selected[f].neighbor];
    const ranks = neighbors(fragment, center).map(({ index }) =>
      index === removedH
        ? { before: parityRank(fragment.atoms[index].element, index), after: linkerAtom }
        : {
            before: parityRank(fragment.atoms[index].element, index),
            after: parityRank(fragment.atoms[index].element, maps[f][index]),
          },
    );
    if (removedH === null)
      ranks.push({ before: IMPLICIT_H_RANK, after: linkerAtom });
    atoms[maps[f][center]].parity = remapParity(
      fragment.atoms[center].parity,
      ranks,
    );
  });
  // Linker centres: a replaced He label becomes the (heavy) query centre and
  // every unused He label becomes an H cap that now ranks highest.
  descriptor.molecule.atoms.forEach((a, i) => {
    if (!a.parity || removed.has(i)) return;
    const ranks = neighbors(descriptor.molecule, i).map(({ index }) => {
      const before = parityRank(descriptor.molecule.atoms[index].element, index),
        which = selected.findIndex((s) => s.index === index);
      return which >= 0
        ? { before, after: maps[which][prepared.attachments[which].index] }
        : {
            before,
            after: parityRank(atoms[linkerMap[index]].element, linkerMap[index]),
          };
    });
    atoms[linkerMap[i]].parity = remapParity(a.parity, ranks);
  });
  // 3D coordinates carry stereo; claim absolute configuration (chiral flag 1)
  // only when every source record did.
  const chiral =
    descriptor.molecule.chiral === 1 &&
    prepared.fragments.every((fragment) => fragment.chiral === 1)
      ? 1
      : 0;
  return {
    title: 'Pyxis linked fragments',
    atoms,
    bonds,
    chiral,
    fragmentCount,
    maps,
    linkerMap,
    newBonds: bonds.slice(-2),
    attachments: prepared.attachments,
  };
}
/**
 * Connectivity-derived screening only; no force field or energetic validation.
 * view = {element, charge, aromatic, amide, xyz, existing:[{xyz, order}]}, where
 * existing lists the centre's other neighbours in product bond order.
 */
// Allocation-light 3-vector helpers for the per-torsion checks. They perform
// geometry.mjs's operations in the same order (dot is ((0 + x0y0) + x1y1) +
// x2y2; unit scales by 1/norm), so results are bit-identical; test.mjs fuzzes
// them against geometry.mjs. A null input throws a TypeError as geometry does.
const dot3 = (a, b) => 0 + a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
function unit3(a) {
  const n = Math.sqrt(dot3(a, a));
  if (!(n > 1e-9)) return null;
  const s = 1 / n;
  return [a[0] * s, a[1] * s, a[2] * s];
}
const cross3 = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const angle3 = (a, b) =>
  (Math.acos(Math.max(-1, Math.min(1, dot3(unit3(a), unit3(b))))) * 180) /
  Math.PI;
export const vector3 = Object.freeze({
  dot: dot3,
  sub: sub3,
  unit: unit3,
  cross: cross3,
  angle: angle3,
});
function centerGeometryError(view, otherXyz) {
  const { element, existing } = view;
  if (!ATTACHMENT_ELEMENTS.includes(element))
    return {
      code: 'UNSUPPORTED_ATTACHMENT_GEOMETRY',
      message: 'Connection centres must be carbon, nitrogen, oxygen or sulfur.',
    };
  const vectors = existing.map((n) => unit3(sub3(n.xyz, view.xyz)));
  const incoming = unit3(sub3(otherXyz, view.xyz));
  if (!incoming || vectors.some((v) => !v))
    return {
      code: 'ATTACHMENT_GEOMETRY',
      message: 'A connection center has coincident bond coordinates.',
    };
  const angles = vectors.map((v) => angle3(incoming, v));
  if (element === 'O' || element === 'S') {
    if (
      view.charge ||
      view.aromatic ||
      existing.length !== 1 ||
      existing[0].order !== 1
    )
      return {
        code: 'UNSUPPORTED_ATTACHMENT_GEOMETRY',
        message:
          'Oxygen and sulfur connections must be neutral, single-bonded and two-coordinate.',
      };
    const [lo, hi] = bentBounds[element];
    if (angles.some((degrees) => degrees < lo || degrees > hi))
      return {
        code: 'ATTACHMENT_BENT',
        message: `A two-coordinate ${element} connection must keep its bond angle within ${lo}–${hi} degrees.`,
      };
    return null;
  }
  const planar =
    view.aromatic || view.amide || existing.some((n) => [2, 4].includes(n.order));
  const linear = existing.some((n) => n.order === 3);
  if (linear) {
    if (angles.some((degrees) => degrees < 160))
      return {
        code: 'ATTACHMENT_LINEARITY',
        message:
          'A triple-bond connection must remain nearly linear (at least 160 degrees).',
      };
  } else if (planar) {
    let normal = null;
    for (let i = 0; i < vectors.length && !normal; i++)
      for (let j = i + 1; j < vectors.length; j++) {
        const candidate = cross3(vectors[i], vectors[j]);
        if (dot3(candidate, candidate) > 0.01) {
          normal = unit3(candidate);
          break;
        }
      }
    if (!normal)
      return {
        code: 'ATTACHMENT_PLANARITY',
        message:
          'This unsaturated connection lacks enough non-collinear neighbors to define its plane.',
      };
    if (
      Math.abs(dot3(incoming, normal)) > Math.sin((20 * Math.PI) / 180) ||
      angles.some((degrees) => degrees < 95 || degrees > 145)
    )
      return {
        code: 'ATTACHMENT_PLANARITY',
        message:
          'An aromatic, double-bond or amide connection must stay near its plane and within 95–145 degree bond angles.',
      };
  } else if (angles.some((degrees) => degrees < 85 || degrees > 135)) {
    return {
      code: 'ATTACHMENT_TETRAHEDRAL',
      message:
        'A saturated carbon or nitrogen connection must keep bond angles within 85–135 degrees.',
    };
  }
  return null;
}
function connectionCenterError(view, otherXyz, settings) {
  const chemistryError = centerGeometryError(view, otherXyz);
  if (chemistryError) return chemistryError;
  for (const n of view.existing) {
    const degrees = angle3(sub3(otherXyz, view.xyz), sub3(n.xyz, view.xyz));
    if (!Number.isFinite(degrees) || degrees < settings.minAttachmentAngle)
      return {
        code: 'ATTACHMENT_GEOMETRY',
        message: 'The new bond clashes with an existing bond direction.',
      };
  }
  return null;
}
// A C that carries C=O/C=S (carbonyl or thiocarbonyl carbon).
const isAcylCarbon = (element, neighborList, elementOf) =>
  element === 'C' &&
  neighborList.some(
    (adj) => adj.order === 2 && ['O', 'S'].includes(elementOf(adj.index)),
  );
// An N single-bonded to an acyl C is treated as a planar amide centre. The
// neighbour list must include the partner across the new bond: an aldehyde or
// formamide C–H joined to an N makes that N an amide. `partnerAcyl` supplies
// that partner when the list excludes it (the per-torsion hot path).
const isAmide = (element, neighborList, elementOf, neighborsOf, partnerAcyl = false) =>
  element === 'N' &&
  (partnerAcyl ||
    neighborList.some(
      (n) =>
        n.order === 1 &&
        isAcylCarbon(elementOf(n.index), neighborsOf(n.index), elementOf),
    ));
function productCenterView(product, center, other) {
  const atom = product.atoms[center],
    all = neighbors(product, center),
    existing = all.filter((n) => n.index !== other);
  return {
    element: atom.element,
    charge: atom.charge || 0,
    aromatic: !!atom.aromatic,
    amide: isAmide(
      atom.element,
      all,
      (i) => product.atoms[i].element,
      (i) => neighbors(product, i),
    ),
    xyz: atom.xyz,
    existing: existing.map((n) => ({
      xyz: product.atoms[n.index].xyz,
      order: n.order,
    })),
  };
}
/** Connectivity-derived screening only; no force field or energetic validation. */
export function attachmentGeometryError(product, center, other) {
  return centerGeometryError(
    productCenterView(product, center, other),
    product.atoms[other].xyz,
  );
}
function geometryCheck(product, settings) {
  for (const [i, b] of product.newBonds.entries()) {
    const d = distance(product.atoms[b.a].xyz, product.atoms[b.b].xyz);
    const connection =
      connections[
        connectionKey(product.atoms[b.a].element, product.atoms[b.b].element)
      ];
    if (!connection) return unsupportedConnection();
    const bounds = connection.bounds;
    if (
      d < Math.max(settings.minBondLength, bounds[0]) ||
      d > Math.min(settings.maxBondLength, bounds[1])
    )
      return {
        code: 'BOND_LENGTH',
        message: 'Joined bond length is outside the allowed range.',
      };
    const attachment = product.attachments[i],
      exit = attachment.exitDirection;
    if (
      exit &&
      angle(exit, sub(product.atoms[b.b].xyz, product.atoms[b.a].xyz)) >
        attachment.maxExitAngle
    )
      return {
        code: 'ATTACHMENT_STEREO',
        message:
          'The bond would leave the permitted attachment direction of the replaced hydrogen.',
      };
    for (const center of [b.a, b.b]) {
      const other = center === b.a ? b.b : b.a;
      const centerError = connectionCenterError(
        productCenterView(product, center, other),
        product.atoms[other].xyz,
        settings,
      );
      if (centerError) return centerError;
    }
  }
  const adjacency = product.atoms.map(
    (_, i) => new Set(neighbors(product, i).map((n) => n.index)),
  );
  let minimumRatio = Infinity;
  for (let i = 0; i < product.fragmentCount; i++)
    for (let j = product.fragmentCount; j < product.atoms.length; j++) {
      if (
        adjacency[i].has(j) ||
        [...adjacency[i]].some((n) => adjacency[n].has(j))
      )
        continue;
      const ratio =
        distance(product.atoms[i].xyz, product.atoms[j].xyz) /
        ((radii[product.atoms[i].element] || 1.8) +
          (radii[product.atoms[j].element] || 1.8));
      minimumRatio = Math.min(minimumRatio, ratio);
      if (ratio < settings.clashScale)
        return {
          code: 'STERIC_CLASH',
          message: 'A severe nonbonded fragment–linker overlap was found.',
        };
    }
  return {
    minimumNonbondedRadiusRatio: Number.isFinite(minimumRatio)
      ? minimumRatio
      : null,
  };
}
/**
 * Bounded least-recently-used map. Map iteration order is insertion order, so
 * re-inserting on every hit keeps the eviction candidate first. A limit of 0
 * stores nothing.
 */
export class LruCache {
  constructor(limit) {
    if (!Number.isInteger(limit) || limit < 0)
      throw new RangeError('LRU limit must be a non-negative integer.');
    this.limit = limit;
    this.map = new Map();
  }
  get size() {
    return this.map.size;
  }
  get(key) {
    if (!this.map.has(key)) return undefined;
    const value = this.map.get(key);
    this.map.delete(key);
    this.map.set(key, value);
    return value;
  }
  set(key, value) {
    this.map.delete(key);
    if (!this.limit) return;
    this.map.set(key, value);
    while (this.map.size > this.limit)
      this.map.delete(this.map.keys().next().value);
  }
  clear() {
    this.map.clear();
  }
}
const DEFAULT_ATOM_TAIL = '  0  0  0  0  0  0  0  0  0  0  0  0',
  DEFAULT_BOND_TAIL = '  0  0  0  0';
// writeMolBlock rewrites tail columns 1-8 (mass difference, charge code,
// parity; isotope and charge are keyed as values) and writes the rest
// verbatim, so the key keeps those characters exactly (no normalization).
const atomFlags = (atom) =>
  JSON.stringify((atom.tail || DEFAULT_ATOM_TAIL).slice(8));
const bondFlags = (bond) => JSON.stringify(bond.tail || DEFAULT_BOND_TAIL);
const linkerGraphKeys = new WeakMap();
/**
 * SHA-256 (base64url) of everything writeMolBlock emits for a linker except
 * coordinates and atom parity: elements (He labels included), charges,
 * isotopes, the remaining atom-block flag text, bonds with their flag text,
 * and the chiral flag.
 * It is built from the actual record, never from linker or conformer
 * identifiers; hashing keeps cache keys ~43 bytes instead of ~2 KB.
 */
export function linkerGraphKey(molecule) {
  let key = linkerGraphKeys.get(molecule);
  if (key !== undefined) return key;
  const graph = `${molecule.chiral || 0}|${molecule.atoms
    .map(
      (a) =>
        `${a.element}${a.charge || 0}${a.isotope ? `@${a.isotope}` : ''}${atomFlags(a)}`,
    )
    .join(',')}|${molecule.bonds
    .map((b) => `${b.a}-${b.b}-${b.order}${bondFlags(b)}`)
    .join(',')}`;
  key = createHash('sha256').update(graph).digest('base64url');
  linkerGraphKeys.set(molecule, key);
  return key;
}
// He is a site label, not helium chemistry. Native sanitization of the
// hydrogen-capped skeleton provides aromaticity even for Kekulé [nH].
// Aromaticity depends only on the graph, so conformers of one linker share a
// bounded topology-keyed cache; each parsed record also memoizes its flags.
// An RDKit refusal of the skeleton is a graph fact too and is cached as
// {error}, so every conformer of an invalid linker fails without RDKit.
const linkerAromaticityCache = new LruCache(20000);
const linkerAromaticityOf = new WeakMap();
async function linkerAromaticity(molecule) {
  let flags = linkerAromaticityOf.get(molecule);
  if (!flags) {
    const key = linkerGraphKey(molecule);
    flags = linkerAromaticityCache.get(key);
    if (!flags) {
      const capped = {
        ...molecule,
        atoms: molecule.atoms.map((atom) => ({
          ...atom,
          element: atom.element === 'He' ? 'H' : atom.element,
        })),
      };
      try {
        flags = aromaticAtoms(await validate(capped, { descriptors: false }));
      } catch (e) {
        if (!(e instanceof LinkFragmentsError && e.code === 'INVALID_CHEMISTRY'))
          throw e;
        flags = { error: e.toJSON() };
      }
      linkerAromaticityCache.set(key, flags);
    }
    linkerAromaticityOf.set(molecule, flags);
  }
  if (flags.error) {
    const { code, message, ...detail } = flags.error;
    error(code, message, detail);
  }
  return flags;
}
/**
 * Product-graph validation outcomes ({ok:true} or {ok:false, error}) keyed by
 * topologyKey. RDKit acceptance reads only the graph: tests re-parse products
 * with scrambled parity and moved coordinates and get the same outcome. Stereo
 * SMILES, descriptors and SDF are never cached.
 */
export const TOPOLOGY_CACHE_LIMIT = 20000;
const VALID_TOPOLOGY = Object.freeze({ ok: true });
let topologyValidation = new LruCache(TOPOLOGY_CACHE_LIMIT);
const topologyCounters = { hits: 0, misses: 0 };
export function topologyCacheStats() {
  return {
    size: topologyValidation.size,
    limit: topologyValidation.limit,
    ...topologyCounters,
  };
}
/** Tests and benchmarks: empty the cache, optionally with a new bound. */
export function resetTopologyCache({ limit = TOPOLOGY_CACHE_LIMIT } = {}) {
  topologyValidation = new LruCache(limit);
  topologyCounters.hits = topologyCounters.misses = 0;
}
/**
 * The product graph is fixed by (prepared query, linker graph, ordered pair of
 * replaced labels): join() copies the query fragments minus their removed H,
 * the linker minus the two selected labels (He caps become H) and adds the two
 * new single bonds in selection order. Only coordinates and parity vary.
 */
const topologyKey = (state, molecule, selected) =>
  `${state.serial}:${selected[0].index},${selected[1].index}:${linkerGraphKey(molecule)}`;
function setup(prepared, linker, options) {
  if (!prepared?.ok)
    return {
      failure: {
        ok: false,
        errors: prepared?.errors || [
          {
            code: 'INVALID_QUERY',
            message: 'Prepare a valid two-fragment query first.',
          },
        ],
      },
    };
  const descriptor =
    typeof linker === 'string' ? linkerDescriptor(linker) : linker;
  if (!descriptor?.ok)
    return {
      failure: {
        ok: false,
        errors: descriptor?.errors || [
          { code: 'INVALID_LINKER', message: 'Supply a valid linker.' },
        ],
      },
    };
  const settings = { ...DEFAULT_SETTINGS, ...options };
  for (const key of Object.keys(DEFAULT_SETTINGS))
    if (!Number.isFinite(settings[key]) || settings[key] <= 0)
      error('INVALID_SETTINGS', `Invalid ${key}.`);
  if (
    settings.torsionStepDegrees < 1 ||
    settings.torsionStepDegrees > 180 ||
    settings.maxRmsd > 2 ||
    settings.clashScale > 1 ||
    settings.minAttachmentAngle >= 180 ||
    settings.minBondLength >= settings.maxBondLength
  )
    error(
      'INVALID_SETTINGS',
      'Geometry tolerances are outside supported bounds.',
    );
  const pairs = options.pair
    ? descriptor.pairs.filter(
        (p) => p.a === options.pair[0] && p.b === options.pair[1],
      )
    : descriptor.pairs;
  return { descriptor, settings, pairs };
}
const ANCHOR_FAILURE = {
  code: 'ANCHOR_DISTANCE',
  message:
    'Linker anchor spacing cannot fit the query within the RMSD tolerance.',
};
/** Both label assignments per pair; the RMSD gate needs no RDKit or product. */
function* placements(prepared, descriptor, pairs, settings, failures) {
  for (const pair of pairs)
    for (const swap of [false, true]) {
      const selected = [pair.a, pair.b].map((id) =>
        descriptor.sites.find((s) => s.atom === id),
      );
      if (swap) selected.reverse();
      const lengths = selected.map((s, i) =>
        connectionLength(
          prepared.attachments[i].element,
          descriptor.molecule.atoms[s.neighbor].element,
        ),
      );
      if (lengths.includes(null)) {
        failures.set('UNSUPPORTED_ATTACHMENT_GEOMETRY', unsupportedConnection());
        continue;
      }
      const source = selected.map((s, i) =>
        add(s.neighborPosition, scale(s.direction, lengths[i])),
      );
      const rmsd = Math.abs(distance(...source) - prepared.distance) / 2;
      if (rmsd > settings.maxRmsd) {
        failures.set('ANCHOR_DISTANCE', ANCHOR_FAILURE);
        continue;
      }
      yield { selected, source, rmsd };
    }
}
const better = (best, rmsd, ratio) =>
  !best ||
  rmsd < best.rmsd - 1e-8 ||
  (Math.abs(rmsd - best.rmsd) < 1e-8 &&
    ratio > best.minimumNonbondedRadiusRatio);
const compactRanges = (numbers) => {
  const out = [];
  for (let i = 0; i < numbers.length; i++) {
    let j = i;
    while (j + 1 < numbers.length && numbers[j + 1] === numbers[j] + 1) j++;
    out.push(j > i ? `${numbers[i]}-${numbers[j]}` : `${numbers[i]}`);
    i = j;
  }
  return out.join(' ');
};
/**
 * The RDKit steps whose success decides whether a placement is accepted. They
 * read only the product graph (elements, charges, isotopes, bond orders and
 * flags written by writeMolBlock), never its coordinates or atom parity, so
 * their outcome is shared by every product with the same topologyKey. Stereo
 * SMILES and descriptors are computed only when `materialize` is set: stereo
 * comes from the 3D coordinates and is never cached.
 */
function productChemistry(toolkit, product, materialize) {
  // One RDKit parse validates the product, gives descriptors and, after removing
  // explicit H, the canonical graph identifier. The export keeps every input H.
  // Plain remove_hs() also drops D/T, so isotope-labelled products keep them.
  const isotopicH = product.atoms.some(
      (a) => HYDROGENS.has(a.element) && (a.element !== 'H' || a.isotope),
    ),
    block = writeMolBlock(product);
  let molecule, identifier;
  try {
    molecule = toolkit.get_mol(block, '{"removeHs":false}');
    if (!molecule?.is_valid())
      error(
        'INVALID_CHEMISTRY',
        'Invalid valence or unsupported molecular structure.',
      );
    const descriptors = materialize
      ? JSON.parse(molecule.get_descriptors())
      : null;
    identifier = toolkit.get_mol(
      isotopicH
        ? molecule.remove_hs(
            '{"removeIsotopes":false,"removeDefiningBondStereo":true}',
          )
        : molecule.remove_hs(),
    );
    // Same structured error the former `identifier.get_smiles()` TypeError gave.
    if (!identifier)
      error('INVALID_CHEMISTRY', 'Molecule could not be chemically validated.');
    return {
      descriptors,
      smiles: materialize ? identifier.get_smiles() : null,
    };
  } finally {
    identifier?.delete();
    molecule?.delete();
  }
}
/** Runs productChemistry and reports its graph-only outcome to `record`. */
function recordedChemistry(toolkit, product, materialize, record) {
  try {
    const result = productChemistry(toolkit, product, materialize);
    record?.(VALID_TOPOLOGY);
    return result;
  } catch (e) {
    // Only the explicit RDKit refusals are graph facts; anything else (WASM
    // failures, coordinates) is never cached.
    if (e instanceof LinkFragmentsError && e.code === 'INVALID_CHEMISTRY')
      record?.({ ok: false, error: e.toJSON() });
    throw e;
  }
}
/**
 * The graph-only outcome the topology cache stores for a product record
 * ({ok:true} or {ok:false, error}). Exported so tests can prove it ignores
 * coordinates and parity.
 */
export async function productGraphOutcome(product) {
  let outcome = null;
  try {
    recordedChemistry(await rdkit(), product, false, (value) => {
      outcome = value;
    });
  } catch (e) {
    if (!outcome) throw e;
  }
  return outcome;
}
// Receptor volume is ranked before anchor fit. It is never an affinity score.
const betterWithReceptor = (best, rmsd, ratio, receptor) => !best ||
  (receptor && best.receptor && compareReceptorScores(receptor, best.receptor) !== 0
    ? compareReceptorScores(receptor, best.receptor) < 0
    : better(best, rmsd, ratio));
async function finish(prepared, descriptor, best, failures, record) {
  if (!best)
    return {
      ok: false,
      errors: [...failures.values()].length
        ? [...failures.values()]
        : [{ code: 'NO_MATCH', message: 'No supported linker pair matched.' }],
    };
  const transform = twoAnchorTransform(
    best.source,
    prepared.attachments.map((a) => a.xyz),
    (best.torsionDegrees * Math.PI) / 180,
  );
  const product = join(prepared, descriptor, best.selected, transform);
  const { descriptors, smiles } = recordedChemistry(
    await rdkit(),
    product,
    true,
    record,
  );
  const sourceAtomMappings = prepared.fragments.flatMap((fragment, f) =>
    fragment.atoms.map((atom, i) => ({
      fragment: f + 1,
      atom: i + 1,
      productAtom: product.maps[f][i] === null ? null : product.maps[f][i] + 1,
      element: atom.element,
      removed: product.maps[f][i] === null,
    })),
  );
  // Refinement fixes every surviving uploaded atom (product atoms
  // 1..fragmentAtomCount), explicit hydrogens included; the heavy subset is
  // reported separately.
  const fixedAtoms = sourceAtomMappings.flatMap((m) =>
    m.productAtom ? [m.productAtom] : [],
  );
  const fixedHeavyAtoms = sourceAtomMappings.flatMap((m) =>
    m.productAtom && !HYDROGENS.has(m.element) ? [m.productAtom] : [],
  );
  const removedHydrogens = prepared.attachments.flatMap((a) =>
    a.removedHydrogenAtom ? [{ fragment: a.fragment, atom: a.removedHydrogenAtom }] : [],
  );
  const attachments = prepared.attachments.map((a, f) => ({
    fragment: a.fragment,
    atom: a.atom,
    element: a.element,
    hydrogen: a.hydrogen,
    removedHydrogenAtom: a.removedHydrogenAtom,
    productAtom: product.maps[f][a.index] + 1,
    linkerProductAtom: product.linkerMap[best.selected[f].neighbor] + 1,
  }));
  // SD data: fragment.atom=productAtom ('-' = removed hydrogen); X:hydrogen>productAtom.
  const data = {
    PYXIS_METHOD: METHOD,
    PYXIS_ANCHOR_RMSD: best.rmsd.toFixed(6),
    PYXIS_SOURCE_ATOM_MAP: sourceAtomMappings
      .map((m) => `${m.fragment}.${m.atom}=${m.productAtom ?? '-'}`)
      .join(' '),
    PYXIS_ATTACHMENTS: attachments
      .map(
        (a) =>
          `${a.fragment}.${a.atom}:${a.hydrogen === 'explicit' ? `H${a.removedHydrogenAtom}` : 'implicitH'}>${a.productAtom}-${a.linkerProductAtom}`,
      )
      .join(' '),
    PYXIS_FIXED_ATOMS: compactRanges(fixedAtoms),
    ...(best.receptor ? { PYXIS_SEARCH_RECEPTOR_CLASHES: String(best.receptor.clashes), PYXIS_SEARCH_RECEPTOR_SEVERE_CLASHES: String(best.receptor.severeClashes), PYXIS_SEARCH_RECEPTOR_OVERLAP_SQUARED: String(best.receptor.overlapSquared), PYXIS_SEARCH_RECEPTOR_SHA256: prepared.receptor.report.sha256, PYXIS_SEARCH_RECEPTOR_SCREENING: 'Rigid heavy-atom excluded volume during candidate scan; overlap >= 0.6 A; severe overlap >= 1.2 A; no affinity score.' } : {}),
  };
  return {
    ok: true,
    rmsd: best.rmsd,
    anchorRmsd: best.rmsd,
    torsionDegrees: best.torsionDegrees,
    selectedLabels: best.pair,
    minimumNonbondedRadiusRatio: best.minimumNonbondedRadiusRatio,
    receptor: best.receptor ?? null,
    sdf: writeSdf(product, data),
    smiles,
    descriptors,
    atomCount: product.atoms.length,
    method: METHOD,
    fragmentAtomCount: product.fragmentCount,
    fixedAtoms,
    fixedHeavyAtoms,
    sourceAtomMappings,
    removedHydrogens,
    attachments,
  };
}
/**
 * Straightforward algorithm: build and check a full product per torsion. Kept
 * as the equivalence oracle for the optimized fitAndJoin (tests only).
 */
export async function fitAndJoinReference(prepared, linker, options = {}) {
  try {
    const { failure, descriptor: plain, settings, pairs } = setup(
      prepared,
      linker,
      options,
    );
    if (failure) return failure;
    const aromatic = await linkerAromaticity(plain.molecule);
    const descriptor = {
      ...plain,
      molecule: {
        ...plain.molecule,
        atoms: plain.molecule.atoms.map((atom, atomIndex) => ({
          ...atom,
          aromatic: aromatic.has(atomIndex),
        })),
      },
    };
    let best = null;
    const failures = new Map();
    for (const { selected, source, rmsd } of placements(
      prepared,
      descriptor,
      pairs,
      settings,
      failures,
    ))
      for (
        let degrees = 0;
        degrees < 360;
        degrees += settings.torsionStepDegrees
      ) {
        const transform = twoAnchorTransform(
          source,
          prepared.attachments.map((a) => a.xyz),
          (degrees * Math.PI) / 180,
        );
        const product = join(prepared, descriptor, selected, transform),
          checked = geometryCheck(product, settings);
        if (checked.code) {
          failures.set(checked.code, checked);
          continue;
        }
        const receptor = prepared.receptor ? scoreReceptor(prepared.receptor, product.atoms) : null;
        if (betterWithReceptor(best, rmsd, checked.minimumNonbondedRadiusRatio, receptor))
          best = {
            receptor,
            selected,
            source,
            rmsd,
            torsionDegrees: degrees,
            pair: selected.map((s) => s.atom),
            ...checked,
          };
      }
    return await finish(prepared, plain, best, failures);
  } catch (e) {
    return { ok: false, errors: [structured(e)] };
  }
}
// Per-query state for the hot path, computed once per prepared query.
const queryStates = new WeakMap();
let querySerial = 0;
function queryState(prepared) {
  let state = queryStates.get(prepared);
  if (state) return state;
  const fragmentAtoms = [],
    maps = [];
  let fragmentBondCount = 0,
    maxFragmentCoordinate = 0;
  prepared.fragments.forEach((m, f) => {
    const removedH = prepared.attachments[f].removedHydrogenIndex;
    maps.push(
      m.atoms.map((a, i) => {
        if (i === removedH) return null;
        fragmentAtoms.push({ xyz: a.xyz, radius: radii[a.element] || 1.8 });
        for (const v of a.xyz)
          maxFragmentCoordinate = Math.max(maxFragmentCoordinate, Math.abs(v));
        return fragmentAtoms.length - 1;
      }),
    );
    fragmentBondCount += m.bonds.filter(
      (b) => b.a !== removedH && b.b !== removedH,
    ).length;
  });
  const centers = prepared.attachments.map((attachment, f) => {
    const m = prepared.fragments[f],
      atom = m.atoms[attachment.index],
      existing = neighbors(m, attachment.index).filter(
        (n) => n.index !== attachment.removedHydrogenIndex,
      );
    return {
      productIndex: maps[f][attachment.index],
      neighborProductIndices: existing.map((n) => maps[f][n.index]),
      // Makes a linker N joined here an amide centre.
      acyl: isAcylCarbon(atom.element, existing, (i) => m.atoms[i].element),
      view: {
        element: atom.element,
        charge: atom.charge || 0,
        aromatic: !!atom.aromatic,
        amide: isAmide(
          atom.element,
          existing,
          (i) => m.atoms[i].element,
          (i) => neighbors(m, i),
        ),
        xyz: atom.xyz,
        existing: existing.map((n) => ({
          xyz: m.atoms[n.index].xyz,
          order: n.order,
        })),
      },
    };
  });
  const targets = prepared.attachments.map((a) => a.xyz);
  state = {
    // Identifies this query's fragment graph inside topology keys.
    serial: ++querySerial,
    fragmentAtoms,
    fx: Float64Array.from(fragmentAtoms, (a) => a.xyz[0]),
    fy: Float64Array.from(fragmentAtoms, (a) => a.xyz[1]),
    fz: Float64Array.from(fragmentAtoms, (a) => a.xyz[2]),
    fr: Float64Array.from(fragmentAtoms, (a) => a.radius),
    fragmentBondCount,
    maxFragmentCoordinate,
    centers,
    targets,
    targetMidpoint: scale(add(...targets), 0.5),
  };
  queryStates.set(prepared, state);
  return state;
}
// writeMolBlock refuses |coordinate| > 9999 Å and more than 999 atoms/bonds.
const V2000_SAFE_COORDINATE = 9990;
/**
 * True when no torsion of any candidate can make writeMolBlock throw, so the
 * outcome of a placement is decided by geometry plus the product graph alone.
 * The fit is rigid and maps the source anchor midpoint onto the target
 * midpoint, so |T(p) - target midpoint| = |p - source midpoint| for every atom.
 * Otherwise fitAndJoin takes the plain path (no deferral, no cached outcome).
 */
function shortcutsSafe(state, molecule, candidates) {
  if (
    state.fragmentAtoms.length + molecule.atoms.length - 2 > 999 ||
    state.fragmentBondCount + molecule.bonds.length > 999 ||
    !(state.maxFragmentCoordinate <= V2000_SAFE_COORDINATE)
  )
    return false;
  const reach = Math.max(...state.targetMidpoint.map(Math.abs));
  for (const { source } of candidates) {
    const midpoint = scale(add(...source), 0.5);
    let radius = 0;
    for (const a of molecule.atoms)
      radius = Math.max(radius, distance(a.xyz, midpoint));
    if (!(reach + radius <= V2000_SAFE_COORDINATE)) return false;
  }
  return true;
}
/**
 * twoAnchorTransform(source, target, torsion) split into its torsion-
 * independent first rotation (computed once per candidate) and the per-torsion
 * rotation about the target axis. Every floating-point operation matches
 * geometry.mjs in value and order (JavaScript never fuses multiply-add), so
 * positions are bit-identical to twoAnchorTransform; test.mjs fuzzes this.
 */
export function anchorFrame(source, target) {
  const u = unit(sub(source[1], source[0])),
    v = unit(sub(target[1], target[0]));
  if (!u || !v) return null;
  const c = Math.max(-1, Math.min(1, dot(u, v)));
  let axis = unit(cross(u, v));
  if (!axis)
    axis = unit(cross(u, Math.abs(u[0]) < 0.8 ? [1, 0, 0] : [0, 1, 0]));
  return {
    axis,
    radians: Math.acos(c),
    sm: scale(add(...source), 0.5),
    tm: scale(add(...target), 0.5),
    v,
  };
}
/** First rotation of twoAnchorTransform: rotateAround(point - sm, axis, radians). */
export const framePre = (frame, point) =>
  rotateAround(sub(point, frame.sm), frame.axis, frame.radians);
/**
 * tm + rotateAround(pre, v, torsion) written out component-wise, with cos/sin
 * supplied by the caller (Math.cos/Math.sin are deterministic per argument).
 */
export function frameTorsion(frame, pre, cosT, sinT, out) {
  const [v0, v1, v2] = frame.v,
    [p0, p1, p2] = pre,
    d = 0 + v0 * p0 + v1 * p1 + v2 * p2,
    k = d * (1 - cosT);
  out[0] = frame.tm[0] + (p0 * cosT + (v1 * p2 - v2 * p1) * sinT + v0 * k);
  out[1] = frame.tm[1] + (p1 * cosT + (v2 * p0 - v0 * p2) * sinT + v1 * k);
  out[2] = frame.tm[2] + (p2 * cosT + (v0 * p1 - v1 * p0) * sinT + v2 * k);
  return out;
}
// Candidate RMSDs further apart than this are ordered strictly by `better`
// (which treats |Δ| < 1e-8 as a tie broken by clash ratio).
const RMSD_SEPARATION = 2e-8;
/**
 * Fit one linker (SDF text or linkerDescriptor result) to a prepared query.
 * Same accept/reject decisions and best placement as fitAndJoinReference, but
 * cheap numeric gates run first: anchor RMSD, bond lengths, exit cone, query
 * centre, linker centre, then clashes. Linker aromaticity (RDKit) is computed
 * only when a torsion reaches the linker-centre check, and the product is built
 * once for the winner. Aromaticity is cached by linker topology, so it is
 * shared by all conformers and pairs of one linker. Torsions reuse each atom's
 * first alignment rotation (anchorFrame/frameTorsion) and the centre checks use
 * allocation-light vector helpers; both are bit-identical to geometry.mjs.
 *
 * Pruning never changes the winner: a candidate whose RMSD cannot beat the
 * current best is skipped, and a torsion that ties the best RMSD stops its
 * clash scan once its minimum ratio can no longer exceed the best ratio.
 *
 * options.deferAbove (Å, default Infinity) is the caller's retention
 * threshold. A winner with rmsd strictly above it is still fully checked
 * (geometry plus product-graph RDKit validity, cached per topologyKey) but
 * returns {ok:true, deferred:true, rmsd, anchorRmsd, selectedLabels} without
 * SDF, stereo SMILES, descriptors, torsion or clash ratio. When every
 * candidate is above the threshold and their RMSDs are strictly separated, the
 * winner is the lowest-RMSD candidate with any passing torsion, so the scan
 * stops at that torsion. Results at or below the threshold (ties included) are
 * materialized exactly as fitAndJoinReference would return them.
 */
export async function fitAndJoin(prepared, linker, options = {}) {
  try {
    const { failure, descriptor, settings, pairs } = setup(
      prepared,
      linker,
      options,
    );
    if (failure) return failure;
    // A worse RMSD can still have better receptor clearance. Geometry-only
    // threshold deferral and dominance shortcuts are unsafe in this mode.
    const receptorContext = options.receptor ?? prepared.receptor ?? null;
    if (receptorContext && !prepared.receptor) prepared = { ...prepared, receptor: receptorContext };
    const deferAbove = receptorContext ? Infinity : (options.deferAbove ?? Infinity);
    if (typeof deferAbove !== 'number' || Number.isNaN(deferAbove))
      error('INVALID_SETTINGS', 'Invalid deferAbove.');
    const failures = new Map();
    const molecule = descriptor.molecule;
    const fail = (checked) => {
      failures.set(checked.code, checked);
    };
    let candidates = [
      ...placements(prepared, descriptor, pairs, settings, failures),
    ];
    if (!candidates.length)
      return await finish(prepared, descriptor, null, failures);
    const state = queryState(prepared);
    const shortcuts = shortcutsSafe(state, molecule, candidates);
    let firstPass = !receptorContext && shortcuts && candidates.every((c) => c.rmsd > deferAbove);
    if (firstPass) {
      const ordered = [...candidates].sort((x, y) => x.rmsd - y.rmsd);
      for (let i = 1; i < ordered.length && firstPass; i++)
        firstPass = ordered[i].rmsd - ordered[i - 1].rmsd > RMSD_SEPARATION;
      if (firstPass) candidates = ordered;
    }
    const { fx, fy, fz, fr } = state,
      fragmentCount = state.fragmentAtoms.length;
    let best = null,
      aromatic = null;
    for (const { selected, source, rmsd } of candidates) {
      if (
        !receptorContext && best &&
        !(rmsd < best.rmsd - 1e-8) &&
        !(Math.abs(rmsd - best.rmsd) < 1e-8)
      )
        continue; // better() can never accept any torsion of this candidate.
      const removed = new Set(selected.map((s) => s.index));
      const linkerCenters = selected.map((s, k) => {
        const existing = neighbors(molecule, s.neighbor).filter(
            (n) => !removed.has(n.index),
          ),
          element = molecule.atoms[s.neighbor].element,
          elementOf = (i) => molecule.atoms[i].element;
        return {
          index: s.neighbor,
          element,
          charge: molecule.atoms[s.neighbor].charge || 0,
          // The partner across the new bond counts: a query acyl C makes this N an amide.
          amide: isAmide(
            element,
            existing,
            elementOf,
            (i) => neighbors(molecule, i),
            state.centers[k].acyl,
          ),
          acyl: isAcylCarbon(element, existing, elementOf),
          existing,
        };
      });
      // Query centre views for this label assignment: a linker acyl C makes a
      // query N an amide.
      const queryViews = state.centers.map((center, k) =>
        linkerCenters[k].acyl && center.view.element === 'N'
          ? { ...center.view, amide: true }
          : center.view,
      );
      const bounds = linkerCenters.map((center, k) => {
        const c =
          connections[
            connectionKey(prepared.attachments[k].element, center.element)
          ].bounds;
        return [
          Math.max(settings.minBondLength, c[0]),
          Math.min(settings.maxBondLength, c[1]),
        ];
      });
      const linkerIndex = [],
        linkerRadius = [],
        slot = new Int32Array(molecule.atoms.length).fill(-1);
      molecule.atoms.forEach((a, i) => {
        if (removed.has(i)) return;
        slot[i] = linkerIndex.length;
        linkerIndex.push(i);
        linkerRadius.push(radii[a.element === 'He' ? 'H' : a.element] || 1.8);
      });
      const linkerCount = linkerIndex.length;
      // 1–2 and 1–3 fragment/linker pairs span only the two new bonds.
      const excluded = new Uint8Array(fragmentCount * linkerCount);
      selected.forEach((s, k) => {
        const center = state.centers[k];
        excluded[center.productIndex * linkerCount + slot[s.neighbor]] = 1;
        for (const n of linkerCenters[k].existing)
          excluded[center.productIndex * linkerCount + slot[n.index]] = 1;
        for (const i of center.neighborProductIndices)
          excluded[i * linkerCount + slot[s.neighbor]] = 1;
      });
      // Same failure point as calling a null twoAnchorTransform result.
      const frame = anchorFrame(source, state.targets);
      if (!frame) throw new TypeError('Degenerate anchor frame.');
      // Per-atom first rotation (torsion-independent) and per-torsion positions,
      // both computed lazily; `stamp` marks atoms moved for the current torsion.
      const atomCount = molecule.atoms.length,
        pre = new Array(atomCount),
        mx = new Float64Array(atomCount),
        my = new Float64Array(atomCount),
        mz = new Float64Array(atomCount),
        stamp = new Int32Array(atomCount),
        point = [0, 0, 0];
      let turn = 0,
        cosT = 1,
        sinT = 0;
      const move = (i) => {
        if (stamp[i] === turn) return;
        stamp[i] = turn;
        if (!pre[i]) pre[i] = framePre(frame, molecule.atoms[i].xyz);
        frameTorsion(frame, pre[i], cosT, sinT, point);
        mx[i] = point[0];
        my[i] = point[1];
        mz[i] = point[2];
      };
      const at = (i) => {
        move(i);
        return [mx[i], my[i], mz[i]];
      };
      for (
        let degrees = 0;
        degrees < 360;
        degrees += settings.torsionStepDegrees
      ) {
        const radians = (degrees * Math.PI) / 180;
        turn++;
        cosT = Math.cos(radians);
        sinT = Math.sin(radians);
        let checked = null;
        for (let k = 0; k < 2 && !checked; k++) {
          const x = state.centers[k].view.xyz,
            l = at(selected[k].neighbor),
            d = distance(x, l);
          if (d < bounds[k][0] || d > bounds[k][1])
            checked = {
              code: 'BOND_LENGTH',
              message: 'Joined bond length is outside the allowed range.',
            };
          else {
            const attachment = prepared.attachments[k];
            if (
              attachment.exitDirection &&
              angle3(attachment.exitDirection, sub3(l, x)) >
                attachment.maxExitAngle
            )
              checked = {
                code: 'ATTACHMENT_STEREO',
                message:
                  'The bond would leave the permitted attachment direction of the replaced hydrogen.',
              };
          }
        }
        for (let k = 0; k < 2 && !checked; k++)
          checked = connectionCenterError(
            queryViews[k],
            at(selected[k].neighbor),
            settings,
          );
        for (let k = 0; k < 2 && !checked; k++) {
          aromatic ||= await linkerAromaticity(molecule);
          const c = linkerCenters[k];
          checked = connectionCenterError(
            {
              element: c.element,
              charge: c.charge,
              aromatic: aromatic.has(c.index),
              amide: c.amide,
              xyz: at(c.index),
              existing: c.existing.map((n) => ({
                xyz: at(n.index),
                order: n.order,
              })),
            },
            state.centers[k].view.xyz,
            settings,
          );
        }
        if (checked) {
          fail(checked);
          continue;
        }
        // At an RMSD tie better() needs a strictly larger minimum ratio, so a
        // torsion whose running minimum reaches the best ratio cannot win.
        const bound =
          !receptorContext && best &&
          Math.abs(rmsd - best.rmsd) < 1e-8 &&
          best.minimumNonbondedRadiusRatio !== null
            ? best.minimumNonbondedRadiusRatio
            : -Infinity;
        let minimumRatio = Infinity,
          dominated = false;
        for (let k = 0; k < linkerCount; k++) move(linkerIndex[k]);
        clash: for (let i = 0; i < fragmentCount; i++) {
          const ax = fx[i],
            ay = fy[i],
            az = fz[i],
            radius = fr[i],
            row = i * linkerCount;
          for (let k = 0; k < linkerCount; k++) {
            if (excluded[row + k]) continue;
            const j = linkerIndex[k],
              dx = ax - mx[j],
              dy = ay - my[j],
              dz = az - mz[j];
            // Same operation order as distance(): bit-identical ratios.
            const ratio =
              Math.sqrt(dx * dx + dy * dy + dz * dz) /
              (radius + linkerRadius[k]);
            minimumRatio = Math.min(minimumRatio, ratio);
            if (ratio < settings.clashScale) {
              checked = {
                code: 'STERIC_CLASH',
                message: 'A severe nonbonded fragment–linker overlap was found.',
              };
              break clash;
            }
            if (minimumRatio <= bound) {
              dominated = true;
              break clash;
            }
          }
        }
        if (checked) {
          fail(checked);
          continue;
        }
        if (dominated) continue;
        const ratio = Number.isFinite(minimumRatio) ? minimumRatio : null;
        const receptor = receptorContext ? scoreReceptor(receptorContext,
          linkerIndex.map((i) => ({ element: molecule.atoms[i].element === 'He' ? 'H' : molecule.atoms[i].element, xyz: [mx[i], my[i], mz[i]] })), receptorContext.fixedScore) : null;
        if (betterWithReceptor(best, rmsd, ratio, receptor))
          best = {
            receptor,
            selected,
            source,
            rmsd,
            torsionDegrees: degrees,
            pair: selected.map((s) => s.atom),
            minimumNonbondedRadiusRatio: ratio,
          };
        if (firstPass) break;
      }
      if (firstPass && best) break;
    }
    if (!best || !shortcuts)
      return await finish(prepared, descriptor, best, failures);
    const key = topologyKey(state, molecule, best.selected),
      known = topologyValidation.get(key);
    if (known) topologyCounters.hits++;
    else topologyCounters.misses++;
    if (known && !known.ok) return { ok: false, errors: [{ ...known.error }] };
    const record = (outcome) => topologyValidation.set(key, outcome);
    if (!(best.rmsd > deferAbove))
      return await finish(prepared, descriptor, best, failures, record);
    if (!known) {
      // Any passing torsion gives the same graph; coordinates are irrelevant here.
      const transform = twoAnchorTransform(
        best.source,
        state.targets,
        (best.torsionDegrees * Math.PI) / 180,
      );
      recordedChemistry(
        await rdkit(),
        join(prepared, descriptor, best.selected, transform),
        false,
        record,
      );
    }
    return {
      ok: true,
      deferred: true,
      rmsd: best.rmsd,
      anchorRmsd: best.rmsd,
      selectedLabels: best.pair,
    };
  } catch (e) {
    return { ok: false, errors: [structured(e)] };
  }
}
