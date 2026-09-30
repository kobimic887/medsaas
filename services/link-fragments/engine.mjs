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
export const DEFAULT_SETTINGS = Object.freeze({
  maxRmsd: 0.5,
  torsionStepDegrees: 10,
  minBondLength: 1.15,
  maxBondLength: 1.9,
  minAttachmentAngle: 85,
  clashScale: 0.55,
});
const radii = {
  H: 1.2,
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
const bondLengths = { C: 1.5, N: 1.45, O: 1.4, S: 1.8, P: 1.8 };
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
async function validate(m) {
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
      smiles: mol.get_smiles(),
      descriptors: JSON.parse(mol.get_descriptors()),
      json: JSON.parse(mol.get_json()),
    };
  } finally {
    mol?.delete();
  }
}
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
        index = attachmentAtoms[i] - 1,
        atom = m.atoms[index];
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
      if (
        m.bonds.some((b) => distance(m.atoms[b.a].xyz, m.atoms[b.b].xyz) < 0.1)
      )
        error(
          'INVALID_COORDINATES',
          'Query has a bond with coincident coordinates.',
        );
      if (
        !Number.isInteger(index) ||
        !atom ||
        ['H', 'He'].includes(atom.element)
      )
        error('INVALID_ATTACHMENT', `Fragment ${i + 1}: select a heavy atom.`);
      if (!['C', 'N'].includes(atom.element))
        error(
          'UNSUPPORTED_ATTACHMENT',
          'This first version supports carbon and nitrogen attachment atoms.',
        );
      const validation = await validate(m),
        aj = validation.json.molecules[0].atoms[index];
      const aromatic = new Set(
        validation.json.molecules[0].extensions?.find(
          (extension) => extension.name === 'rdkitRepresentation',
        )?.aromaticAtoms || [],
      );
      m.atoms.forEach((a, atomIndex) => {
        a.aromatic = aromatic.has(atomIndex);
      });
      if (!(aj.impHs > 0))
        error(
          'ATTACHMENT_NO_IMPLICIT_H',
          `Fragment ${i + 1}: the selected atom needs an implicit hydrogen available for replacement. Explicit hydrogen removal is not supported yet.`,
        );
      const ns = neighbors(m, index),
        vectors = ns.map((n) => unit(sub(m.atoms[n.index].xyz, atom.xyz)));
      // One missing H at a tetrahedral carbon has a defined hemisphere. A
      // methyl group has three possible directions and gets no invented vector.
      const exitDirection =
        atom.element === 'C' &&
        aj.impHs === 1 &&
        vectors.length === 3 &&
        vectors.every(Boolean) &&
        Math.abs(dot(vectors[0], cross(vectors[1], vectors[2]))) > 0.05
          ? unit(scale(vectors.reduce(add, [0, 0, 0]), -1))
          : null;
      attachments.push({
        atom: index + 1,
        index,
        element: atom.element,
        xyz: atom.xyz,
        implicitHydrogens: aj.impHs,
        exitDirection,
      });
    }
    if (distance(attachments[0].xyz, attachments[1].xyz) < 0.5)
      error(
        'OVERLAPPING_ATTACHMENTS',
        'Attachment points must be separated in the supplied 3D frame.',
      );
    for (const a of fragments[0].atoms)
      for (const b of fragments[1].atoms)
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
function join(prepared, descriptor, selected, transform) {
  const atoms = [],
    bonds = [],
    maps = [];
  for (const fragment of prepared.fragments) {
    const map = fragment.atoms.map((a) => {
      atoms.push({ ...a, xyz: [...a.xyz] });
      return atoms.length - 1;
    });
    maps.push(map);
    bonds.push(
      ...fragment.bonds.map((b) => ({ ...b, a: map[b.a], b: map[b.b] })),
    );
  }
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
  // Atom parity depends on neighbor numbering: remap its permutation, keeping 3D handedness.
  descriptor.molecule.atoms.forEach((a, i) => {
    if (!a.parity || removed.has(i)) return;
    const old = neighbors(descriptor.molecule, i)
      .map((n) => n.index)
      .sort((x, y) => x - y);
    const mapped = old.map((n) => {
      const which = selected.findIndex((s) => s.index === n);
      return which >= 0
        ? maps[which][prepared.attachments[which].index]
        : linkerMap[n];
    });
    let inversions = 0;
    for (let x = 0; x < mapped.length; x++)
      for (let y = x + 1; y < mapped.length; y++)
        if (mapped[x] > mapped[y]) inversions++;
    if (inversions % 2 && [1, 2].includes(a.parity))
      atoms[linkerMap[i]].parity = 3 - a.parity;
  });
  return {
    title: 'Pyxis linked fragments',
    atoms,
    bonds,
    chiral: descriptor.molecule.chiral,
    fragmentCount: prepared.fragments.reduce((s, m) => s + m.atoms.length, 0),
    linkerMap,
    newBonds: bonds.slice(-2),
    attachments: prepared.attachments,
  };
}
/** Connectivity-derived screening only; no force field or energetic validation. */
export function attachmentGeometryError(product, center, other) {
  const atom = product.atoms[center];
  if (!['C', 'N'].includes(atom.element))
    return {
      code: 'UNSUPPORTED_ATTACHMENT_GEOMETRY',
      message:
        'Only carbon and nitrogen connection centers are supported in this version.',
    };
  const existing = neighbors(product, center).filter((n) => n.index !== other);
  const vectors = existing.map((n) =>
    unit(sub(product.atoms[n.index].xyz, atom.xyz)),
  );
  const incoming = unit(sub(product.atoms[other].xyz, atom.xyz));
  if (!incoming || vectors.some((v) => !v))
    return {
      code: 'ATTACHMENT_GEOMETRY',
      message: 'A connection center has coincident bond coordinates.',
    };
  const amide =
    atom.element === 'N' &&
    existing.some(
      (n) =>
        n.order === 1 &&
        product.atoms[n.index].element === 'C' &&
        neighbors(product, n.index).some(
          (adj) =>
            adj.order === 2 &&
            ['O', 'S'].includes(product.atoms[adj.index].element),
        ),
    );
  const planar =
    atom.aromatic || amide || existing.some((n) => [2, 4].includes(n.order));
  const linear = existing.some((n) => n.order === 3);
  const angles = vectors.map((v) => angle(incoming, v));
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
        const candidate = cross(vectors[i], vectors[j]);
        if (dot(candidate, candidate) > 0.01) {
          normal = unit(candidate);
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
      Math.abs(dot(incoming, normal)) > Math.sin((20 * Math.PI) / 180) ||
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
function geometryCheck(product, settings) {
  for (const [i, b] of product.newBonds.entries()) {
    const d = distance(product.atoms[b.a].xyz, product.atoms[b.b].xyz);
    const elements = [product.atoms[b.a].element, product.atoms[b.b].element]
      .sort()
      .join('-');
    const bounds = {
      'C-C': [1.3, 1.85],
      'C-N': [1.3, 1.85],
      'N-N': [1.25, 1.8],
    }[elements];
    if (!bounds)
      return {
        code: 'UNSUPPORTED_ATTACHMENT_GEOMETRY',
        message: 'Only C–C, C–N and N–N connections are supported.',
      };
    if (
      d < Math.max(settings.minBondLength, bounds[0]) ||
      d > Math.min(settings.maxBondLength, bounds[1])
    )
      return {
        code: 'BOND_LENGTH',
        message: 'Joined bond length is outside the allowed range.',
      };
    const exit = product.attachments[i].exitDirection;
    if (
      exit &&
      angle(exit, sub(product.atoms[b.b].xyz, product.atoms[b.a].xyz)) > 65
    )
      return {
        code: 'ATTACHMENT_STEREO',
        message:
          'The bond would leave the permitted tetrahedral attachment direction.',
      };
    for (const center of [b.a, b.b]) {
      const other = center === b.a ? b.b : b.a;
      const chemistryError = attachmentGeometryError(product, center, other);
      if (chemistryError) return chemistryError;
      for (const n of neighbors(product, center)) {
        if (n.index === other) continue;
        const degrees = angle(
          sub(product.atoms[other].xyz, product.atoms[center].xyz),
          sub(product.atoms[n.index].xyz, product.atoms[center].xyz),
        );
        if (!Number.isFinite(degrees) || degrees < settings.minAttachmentAngle)
          return {
            code: 'ATTACHMENT_GEOMETRY',
            message: 'The new bond clashes with an existing bond direction.',
          };
      }
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
export async function fitAndJoin(prepared, linker, options = {}) {
  try {
    if (!prepared?.ok)
      return {
        ok: false,
        errors: prepared?.errors || [
          {
            code: 'INVALID_QUERY',
            message: 'Prepare a valid two-fragment query first.',
          },
        ],
      };
    let descriptor =
      typeof linker === 'string' ? linkerDescriptor(linker) : linker;
    if (!descriptor?.ok)
      return {
        ok: false,
        errors: descriptor?.errors || [
          { code: 'INVALID_LINKER', message: 'Supply a valid linker.' },
        ],
      };
    // He is a site label, not helium chemistry. Native sanitization of the
    // hydrogen-capped skeleton provides aromaticity even for Kekulé [nH].
    const capped = {
      ...descriptor.molecule,
      atoms: descriptor.molecule.atoms.map((atom) => ({
        ...atom,
        element: atom.element === 'He' ? 'H' : atom.element,
      })),
    };
    const cappedValidation = await validate(capped);
    const aromatic = new Set(
      cappedValidation.json.molecules[0].extensions?.find(
        (extension) => extension.name === 'rdkitRepresentation',
      )?.aromaticAtoms || [],
    );
    descriptor = {
      ...descriptor,
      molecule: {
        ...descriptor.molecule,
        atoms: descriptor.molecule.atoms.map((atom, atomIndex) => ({
          ...atom,
          aromatic: aromatic.has(atomIndex),
        })),
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
    let best = null;
    const failures = new Map();
    for (const pair of pairs)
      for (const swap of [false, true]) {
        const selected = [pair.a, pair.b].map((id) =>
          descriptor.sites.find((s) => s.atom === id),
        );
        if (swap) selected.reverse();
        const source = selected.map((s, i) =>
          add(
            s.neighborPosition,
            scale(s.direction, bondLengths[prepared.attachments[i].element]),
          ),
        );
        const rmsd = Math.abs(distance(...source) - prepared.distance) / 2;
        if (rmsd > settings.maxRmsd) {
          failures.set('ANCHOR_DISTANCE', {
            code: 'ANCHOR_DISTANCE',
            message:
              'Linker anchor spacing cannot fit the query within the RMSD tolerance.',
          });
          continue;
        }
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
          if (
            !best ||
            rmsd < best.rmsd - 1e-8 ||
            (Math.abs(rmsd - best.rmsd) < 1e-8 &&
              checked.minimumNonbondedRadiusRatio >
                best.minimumNonbondedRadiusRatio)
          )
            best = {
              product,
              rmsd,
              torsionDegrees: degrees,
              pair: selected.map((s) => s.atom),
              ...checked,
            };
        }
      }
    if (!best)
      return {
        ok: false,
        errors: [...failures.values()].length
          ? [...failures.values()]
          : [
              {
                code: 'NO_MATCH',
                message: 'No supported linker pair matched.',
              },
            ],
      };
    const validation = await validate(best.product);
    // Remove explicit H only for canonical graph identification; the export preserves all input H coordinates.
    const toolkit = await rdkit(),
      molecule = toolkit.get_mol(writeMolBlock(best.product));
    let smiles, identifier;
    try {
      identifier = toolkit.get_mol(molecule.remove_hs());
      smiles = identifier.get_smiles();
    } finally {
      identifier?.delete();
      molecule?.delete();
    }
    return {
      ok: true,
      rmsd: best.rmsd,
      anchorRmsd: best.rmsd,
      torsionDegrees: best.torsionDegrees,
      selectedLabels: best.pair,
      minimumNonbondedRadiusRatio: best.minimumNonbondedRadiusRatio,
      sdf: writeSdf(best.product),
      smiles,
      descriptors: validation.descriptors,
      atomCount: best.product.atoms.length,
      method:
        'Rigid two-anchor fit with torsion scan; fragments fixed; unused He labels capped by H; no energy minimization.',
    };
  } catch (e) {
    return { ok: false, errors: [structured(e)] };
  }
}
