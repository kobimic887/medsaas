import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import initRDKit from '../../server/node_modules/@rdkit/rdkit/dist/RDKit_minimal.js';
import { parseSdf, writeSdf, writeMolBlock, withSdfData } from './sdf.mjs';
import {
  prepareQuery,
  linkerDescriptor,
  fitAndJoin,
  fitAndJoinReference,
  attachmentGeometryError,
  inspectAttachmentSites,
  candidateDistanceWindow,
  connectionLength,
  ATTACHMENT_ELEMENTS,
  INDEX_ANCHOR_LENGTH,
  LruCache,
  TOPOLOGY_CACHE_LIMIT,
  resetTopologyCache,
  topologyCacheStats,
  linkerGraphKey,
  productGraphOutcome,
  anchorFrame,
  framePre,
  frameTorsion,
  vector3,
} from './engine.mjs';
import {
  TopProducts,
  comparePlacements,
  encodeThreshold,
  deferAboveOf,
  NO_THRESHOLD,
} from './jobs.mjs';
import {
  add,
  cross,
  sub,
  dot,
  scale,
  unit,
  twoAnchorTransform,
  distance,
  angle,
  rotateAround,
} from './geometry.mjs';
const fixture = (name) =>
  readFile(new URL(`fixtures/${name}.sdf`, import.meta.url), 'utf8');
const canonical = async (block) => {
  const r = await initRDKit(),
    m = r.get_mol(block),
    n = r.get_mol(m.remove_hs());
  try {
    return n.get_smiles();
  } finally {
    n.delete();
    m.delete();
  }
};
test('query atom limit is enforced independently of the application inspection route', async () => {
  const fragments = parseSdf(await fixture('query'));
  const atom = fragments[0].atoms[0];
  fragments[0].atoms = Array.from({ length: 201 }, (_, i) => ({
    ...atom,
    xyz: [i * 1.5, 0, 0],
  }));
  fragments[0].bonds = Array.from({ length: 200 }, (_, i) => ({
    a: i,
    b: i + 1,
    order: 1,
  }));
  const result = await prepareQuery(fragments.map(writeSdf).join(''), [1, 1]);
  assert.equal(result.ok, false);
  assert.equal(result.errors[0].code, 'QUERY_TOO_LARGE');
});
test('connection geometry preserves planar centers and screens linear saturated bonds', () => {
  const atom = (element, xyz) => ({ element, xyz, charge: 0 });
  const planar = {
    atoms: [
      atom('C', [0, 0, 0]),
      atom('C', [1, 0, 0]),
      atom('C', [-0.5, 0.866, 0]),
      atom('C', [-0.5, -0.866, 0]),
    ],
    bonds: [
      { a: 0, b: 1, order: 2 },
      { a: 0, b: 2, order: 1 },
      { a: 0, b: 3, order: 1 },
    ],
  };
  assert.equal(attachmentGeometryError(planar, 0, 3), null);
  planar.atoms[3].xyz = [-0.5, -0.3, 1];
  assert.equal(
    attachmentGeometryError(planar, 0, 3).code,
    'ATTACHMENT_PLANARITY',
  );
  const saturated = {
    atoms: [atom('C', [0, 0, 0]), atom('C', [1, 0, 0]), atom('N', [-1, 0, 0])],
    bonds: [
      { a: 0, b: 1, order: 1 },
      { a: 0, b: 2, order: 1 },
    ],
  };
  assert.equal(
    attachmentGeometryError(saturated, 0, 2).code,
    'ATTACHMENT_TETRAHEDRAL',
  );
  saturated.bonds[0].order = 3;
  assert.equal(attachmentGeometryError(saturated, 0, 2), null);
  saturated.atoms[2].xyz = [0, 1, 0];
  assert.equal(
    attachmentGeometryError(saturated, 0, 2).code,
    'ATTACHMENT_LINEARITY',
  );
});
test('amide nitrogen with single bonds still requires a planar new connection', () => {
  const product = {
    atoms: [
      { element: 'N', xyz: [0, 0, 0] },
      { element: 'C', xyz: [1, 0, 0] },
      { element: 'C', xyz: [-0.5, 0.866, 0] },
      { element: 'C', xyz: [-0.5, -0.3, 1] },
      { element: 'O', xyz: [1.5, 1, 0] },
    ],
    bonds: [
      { a: 0, b: 1, order: 1 },
      { a: 0, b: 2, order: 1 },
      { a: 0, b: 3, order: 1 },
      { a: 1, b: 4, order: 2 },
    ],
  };
  assert.equal(
    attachmentGeometryError(product, 0, 3).code,
    'ATTACHMENT_PLANARITY',
  );
  product.atoms[3].xyz = [-0.5, -0.866, 0];
  assert.equal(attachmentGeometryError(product, 0, 3), null);
  // The acyl C may be the partner across the new bond itself (aldehyde C–H
  // replaced by this N): N is still an amide centre.
  const across = {
    atoms: [
      { element: 'N', xyz: [0, 0, 0] },
      { element: 'C', xyz: [-0.5, 0.866, 0] },
      { element: 'C', xyz: [-0.5, -0.3, 1] },
      { element: 'C', xyz: [1, 0, 0] },
      { element: 'O', xyz: [1.5, 1, 0] },
    ],
    bonds: [
      { a: 0, b: 1, order: 1 },
      { a: 0, b: 2, order: 1 },
      { a: 0, b: 3, order: 1 },
      { a: 3, b: 4, order: 2 },
    ],
  };
  assert.equal(attachmentGeometryError(across, 0, 3).code, 'ATTACHMENT_PLANARITY');
  across.bonds[3].order = 1; // an alcohol C is no acyl partner: tetrahedral rules apply
  assert.equal(attachmentGeometryError(across, 0, 3), null);
});
test('native aromaticity protects Kekulé pyrrole nitrogen despite two single bonds', async () => {
  const toolkit = await initRDKit(),
    molecule = toolkit.get_mol('c1cc[nH]c1');
  const pyrrole = parseSdf(molecule.get_molblock())[0];
  molecule.delete();
  pyrrole.atoms.forEach((atom, i) => {
    atom.xyz = [
      1.2 * Math.cos((i * 2 * Math.PI) / 5),
      1.2 * Math.sin((i * 2 * Math.PI) / 5),
      0,
    ];
  });
  const partner = parseSdf(await fixture('query'))[1];
  const prepared = await prepareQuery(
    writeSdf(pyrrole) + writeSdf(partner),
    [4, 1],
  );
  assert.equal(prepared.ok, true, JSON.stringify(prepared.errors));
  const fragment = prepared.fragments[0],
    nitrogen = fragment.atoms[3];
  assert.equal(nitrogen.aromatic, true);
  fragment.atoms.push({
    element: 'C',
    xyz: [nitrogen.xyz[0], nitrogen.xyz[1], 1.45],
  });
  fragment.bonds.push({ a: 3, b: 5, order: 1 });
  assert.equal(
    attachmentGeometryError(fragment, 3, 5).code,
    'ATTACHMENT_PLANARITY',
  );
});
test('supplied example: fixed query coordinates, correct graph and chirality, +2 charge', async () => {
  const query = await fixture('query'),
    linker = await fixture('linker'),
    expected = await fixture('result');
  const prepared = await prepareQuery(query, [1, 1]),
    descriptor = linkerDescriptor(linker),
    result = await fitAndJoin(prepared, descriptor);
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.ok(Math.abs(result.rmsd - 0.163059559) < 1e-7);
  assert.equal(result.smiles, await canonical(expected));
  assert.equal(result.descriptors.NumHeavyAtoms, 41);
  assert.equal(result.descriptors.NumAtoms, 83);
  const product = parseSdf(result.sdf)[0];
  assert.equal(product.atoms.length, 79); // Four hydrogens are implicit, unlike the 83-atom MOE export.
  assert.equal(
    product.atoms.reduce((sum, a) => sum + a.charge, 0),
    2,
  );
  assert.equal(product.atoms.filter((a) => a.element === 'He').length, 0);
  const original = parseSdf(query).flatMap((m) => m.atoms);
  original.forEach((a, i) => {
    assert.deepEqual(product.atoms[i].xyz, a.xyz);
  });
  assert.equal(product.bonds.length, 83);
  // Contract fields: implicit H on atom 1 of both fragments, nothing removed.
  assert.equal(result.fragmentAtomCount, 29);
  assert.deepEqual(result.removedHydrogens, []);
  assert.deepEqual(
    result.attachments.map((a) => [a.fragment, a.atom, a.hydrogen, a.productAtom]),
    [
      [1, 1, 'implicit', 1],
      [2, 1, 'implicit', 12],
    ],
  );
  // Refinement fixes every surviving uploaded atom, explicit H included.
  assert.deepEqual(result.fixedAtoms, Array.from({ length: 29 }, (_, i) => i + 1));
  assert.equal(
    result.fixedHeavyAtoms.length,
    original.filter((a) => a.element !== 'H').length,
  );
  assert.match(result.sdf, /> <PYXIS_FIXED_ATOMS>\n1-29\n/);
  // Query records carry chiral flag 0, so the product claims no absolute configuration.
  assert.equal(product.chiral, 0);
  assert.ok(result.sourceAtomMappings.every((m, i) => m.productAtom === i + 1));
  assert.match(result.sdf, /> <PYXIS_METHOD>\n/);
  assert.match(result.sdf, /> <PYXIS_SOURCE_ATOM_MAP>\n1\.1=1 1\.2=2 /);
  assert.deepEqual(await fitAndJoinReference(prepared, descriptor), result);
});
test('strict parser preserves isotope, formal charge, stereo flags and rejects lossy formats', () => {
  const m = {
    title: 'isotope',
    is3D: true,
    chiral: 1,
    atoms: [
      { element: 'C', xyz: [1, 2, 3], charge: -1, isotope: 13, parity: 1 },
    ],
    bonds: [],
  };
  const block = writeSdf(m),
    round = parseSdf(block)[0];
  assert.equal(round.atoms[0].isotope, 13);
  assert.equal(round.atoms[0].charge, -1);
  assert.equal(round.atoms[0].parity, 1);
  assert.throws(() => parseSdf(block.replace('V2000', 'V3000')), /V2000/);
  assert.throws(
    () => parseSdf(block.replace('M  END', 'M  RAD  1   1   2\nM  END')),
    /radicals/,
  );
});
test('two-anchor fit preserves handedness and cannot reflect a tetrahedron', () => {
  const points = [
      [0, 0, 0],
      [2, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ],
    source = points.slice(0, 2),
    target = [
      [10, 2, 4],
      [10, 4, 4],
    ];
  const transform = twoAnchorTransform(source, target, 1.234),
    mapped = points.map(transform);
  const signed = (p) =>
    dot(sub(p[1], p[0]), cross(sub(p[2], p[0]), sub(p[3], p[0])));
  assert.ok(signed(points) * signed(mapped) > 0);
  assert.ok(distance(mapped[0], target[0]) < 1e-8);
  assert.ok(distance(mapped[1], target[1]) < 1e-8);
  for (let i = 0; i < 4; i++)
    for (let j = i + 1; j < 4; j++)
      assert.ok(
        Math.abs(
          distance(points[i], points[j]) - distance(mapped[i], mapped[j]),
        ) < 1e-8,
      );
});
test('query rejects missing selections, wrong count, occupied atom and non-3D data', async () => {
  const q = await fixture('query');
  assert.equal(
    (await prepareQuery(q, [])).errors[0].code,
    'ATTACHMENT_REQUIRED',
  );
  assert.equal(
    (await prepareQuery(writeSdf(parseSdf(q)[0]), [1, 1])).errors[0].code,
    'QUERY_FRAGMENT_COUNT',
  );
  // Atom 2 is CH2 with explicit H 3 and 4: now eligible, replacing ordinary H 3.
  const ch2 = await prepareQuery(q, [2, 1]);
  assert.equal(ch2.ok, true, JSON.stringify(ch2.errors));
  assert.equal(ch2.attachments[0].removedHydrogenAtom, 3);
  assert.equal(
    (await prepareQuery(q, [8, 1])).errors[0].code,
    'ATTACHMENT_NO_HYDROGEN',
  );
  assert.equal(
    (await prepareQuery(q, [9, 1])).errors[0].code,
    'UNSUPPORTED_ATTACHMENT',
  );
  assert.equal(
    (await prepareQuery(q, [{ atom: 2, hydrogenAtom: 6 }, 1])).errors[0].code,
    'INVALID_HYDROGEN_SELECTION',
  );
  assert.equal(
    (await prepareQuery(q, [3, 1])).errors[0].code,
    'INVALID_ATTACHMENT',
  );
  assert.equal(
    (await prepareQuery(q.replaceAll('3D', '2D'), [1, 1])).errors[0].code,
    'QUERY_NOT_3D',
  );
});
test('wrong endpoint spacing and over-strict RMSD refuse the supplied example', async () => {
  const q = await fixture('query'),
    l = await fixture('linker'),
    p = await prepareQuery(q, [1, 1]);
  assert.equal((await fitAndJoin(p, l, { maxRmsd: 0.05 })).ok, false);
  const moved = parseSdf(q);
  moved[1].atoms.forEach((a) => {
    a.xyz[0] += 30;
  });
  const far = await prepareQuery(moved.map(writeSdf).join(''), [1, 1]);
  const rejected = await fitAndJoin(far, l);
  assert.equal(rejected.ok, false);
  assert.ok(rejected.errors.some((e) => e.code === 'ANCHOR_DISTANCE'));
});
test('bonded He is treated as a label, never silently sanitized as helium chemistry', async () => {
  const l = parseSdf(await fixture('linker'))[0];
  assert.equal(linkerDescriptor(l).ok, true);
  l.bonds[0].order = 2;
  assert.equal(linkerDescriptor(l).errors[0].code, 'INVALID_LINKER_LABEL');
  const block = writeMolBlock(l).split('\n'),
    na = l.atoms.length;
  block[4 + na] = block[4 + na].slice(0, 6) + '  5' + block[4 + na].slice(9);
  assert.throws(() => parseSdf(block.join('\n')), /query bond/);
});

test('invalid valence and severe clashes refuse a product instead of returning an SDF', async () => {
  const prepared = await prepareQuery(await fixture('query'), [1, 1]);
  const linker = parseSdf(await fixture('linker'))[0];
  linker.atoms[8].charge = 0; // Four single bonds require the supplied positive nitrogen charge.
  const invalid = await fitAndJoin(prepared, linkerDescriptor(linker));
  assert.equal(invalid.ok, false);
  assert.equal(invalid.errors[0].code, 'INVALID_CHEMISTRY');
  const clash = await fitAndJoin(prepared, await fixture('linker'), {
    clashScale: 1,
  });
  assert.equal(clash.ok, false);
  assert.ok(clash.errors.some((e) => e.code === 'STERIC_CLASH'));
});
test('multiple library ports enumerate pairs and cap unused labels with hydrogen', async () => {
  const original = parseSdf(await fixture('multi-port'))[0],
    descriptor = linkerDescriptor(original);
  assert.equal(descriptor.ok, true, JSON.stringify(descriptor.errors));
  assert.equal(descriptor.labelCount, 4);
  assert.ok(descriptor.pairs.length >= 4);
  // Make test query attachment geometry from one real pair, not a fabricated library chemistry.
  const pair = descriptor.pairs[0],
    sites = [pair.a, pair.b].map((a) =>
      descriptor.sites.find((s) => s.atom === a),
    );
  const fragments = sites.map((s, i) => {
    const c = pair.anchors[i],
      away = [-s.direction[1], s.direction[0], s.direction[2]];
    return {
      title: '3D fragment',
      is3D: true,
      atoms: [
        { element: 'C', xyz: c, charge: 0, parity: 0 },
        {
          element: 'C',
          xyz: c.map((v, j) => v + away[j] * 1.5),
          charge: 0,
          parity: 0,
        },
      ],
      bonds: [{ a: 0, b: 1, order: 1 }],
    };
  });
  const p = await prepareQuery(fragments.map(writeSdf).join(''), [1, 1]);
  const result = await fitAndJoin(p, descriptor, {
    pair: [pair.a, pair.b],
    minAttachmentAngle: 30,
    clashScale: 0.1,
  });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  const molecule = parseSdf(result.sdf)[0];
  assert.equal(molecule.atoms.filter((a) => a.element === 'He').length, 0);
  assert.equal(molecule.atoms.length, original.atoms.length + 2);
  assert.equal(
    molecule.atoms.filter((a) => a.element === 'H').length,
    original.atoms.filter((a) => a.element === 'H').length + 2,
  );
});

// Optimized fitting must accept/reject exactly like the per-torsion reference
// and choose the identical best placement (error ordering may differ).
async function agree(prepared, linker, options) {
  const fast = await fitAndJoin(prepared, linker, options),
    reference = await fitAndJoinReference(prepared, linker, options);
  assert.equal(fast.ok, reference.ok, JSON.stringify([fast.errors, reference.errors]));
  if (fast.ok) assert.deepEqual(fast, reference);
  return fast;
}
const TETRAHEDRAL = (109.47 * Math.PI) / 180;
// Three bond directions completing a tetrahedron around u (the replaced bond).
const tetrahedron = (u, turn = 0) => {
  const p = unit(cross(u, Math.abs(u[0]) < 0.8 ? [1, 0, 0] : [0, 1, 0])),
    q = cross(u, p);
  return [0, 1, 2].map((k) => {
    const t = ((k + turn) * 2 * Math.PI) / 3;
    return add(
      scale(u, Math.cos(TETRAHEDRAL)),
      scale(add(scale(p, Math.cos(t)), scale(q, Math.sin(t))), Math.sin(TETRAHEDRAL)),
    );
  });
};
const at = (origin, direction, length) => add(origin, scale(direction, length));
const atom = (element, xyz, extra = {}) => ({ element, xyz, charge: 0, parity: 0, ...extra });
const record = (atoms, bonds) =>
  writeSdf({
    title: 'attach test',
    is3D: true,
    atoms,
    bonds: bonds.map(([a, b, order = 1]) => ({ a: a - 1, b: b - 1, order })),
  });
// Query centres placed exactly on one real multi-port pair's anchors (labels 8
// and 15, whose ring leaves room for small fragments) for the given query
// elements; `toward` points from each centre to its linker atom.
async function portFrame(elements) {
  const descriptor = linkerDescriptor(parseSdf(await fixture('multi-port'))[0]);
  const pair = descriptor.pairs.find((p) => p.a === 8 && p.b === 15);
  const sites = [pair.a, pair.b].map((a) => descriptor.sites.find((s) => s.atom === a));
  return {
    descriptor,
    pair,
    frames: sites.map((s, i) => ({
      center: at(
        s.neighborPosition,
        s.direction,
        connectionLength(elements[i], descriptor.molecule.atoms[s.neighbor].element),
      ),
      toward: scale(s.direction, -1),
    })),
  };
}
const stereoTags = async (block) => {
  const r = await initRDKit(),
    m = r.get_mol(block, '{"removeHs":false}');
  try {
    return Object.fromEntries(JSON.parse(m.get_stereo_tags()).CIP_atoms);
  } finally {
    m.delete();
  }
};
// Small RDKit-built records with explicit H and non-coincident 2D coordinates.
async function explicitRecord(smiles) {
  const r = await initRDKit(),
    m = r.get_mol(smiles),
    h = r.get_mol(m.add_hs());
  h.set_new_coords();
  const molecule = parseSdf(h.get_molblock())[0];
  m.delete();
  h.delete();
  molecule.atoms.forEach((a, i) => {
    a.xyz[2] = 0.01 * i;
  });
  return molecule;
}

test('explicit hydrogen on aromatic C6 of fragment 2 (H7) is a valid attachment', async () => {
  const q = await fixture('query');
  for (const selection of [{ atom: 6, hydrogenAtom: 7 }, 6]) {
    const prepared = await prepareQuery(q, [1, selection]);
    assert.equal(prepared.ok, true, JSON.stringify(prepared.errors));
    assert.deepEqual(
      prepared.attachments.map((a) => [a.atom, a.hydrogen, a.removedHydrogenAtom]),
      [
        [1, 'implicit', null],
        [6, 'explicit', 7],
      ],
    );
    assert.ok(prepared.attachments[1].maxExitAngle <= 35);
    await agree(prepared, await fixture('linker'), { maxRmsd: 1 });
  }
  assert.equal(
    (await prepareQuery(q, [1, { atom: 6, hydrogenAtom: 9 }])).errors[0].code,
    'INVALID_HYDROGEN_SELECTION',
  );
  assert.equal(
    (await prepareQuery(q, [1, 7])).errors[0].code,
    'INVALID_ATTACHMENT',
  );
});

test('inspection lists eligible sites and a reason for every ineligible atom', async () => {
  const inspected = await inspectAttachmentSites(await fixture('query'));
  assert.equal(inspected.ok, true, JSON.stringify(inspected.errors));
  const [one, two] = inspected.fragments;
  assert.equal(one.name, '7WH5.A');
  for (const fragment of inspected.fragments)
    for (const site of fragment.atoms)
      assert.equal(typeof site.reason === 'string' && site.reason.length > 0, !site.eligible || site.requiresHydrogenSelection);
  assert.deepEqual(
    [one.atoms[0].eligible, one.atoms[0].implicitHydrogens, one.atoms[0].recommendedHydrogenAtom],
    [true, 3, null],
  );
  assert.deepEqual(
    [one.atoms[1].eligible, one.atoms[1].explicitHydrogens, one.atoms[1].recommendedHydrogenAtom],
    [true, [3, 4], 3],
  );
  assert.match(one.atoms[7].reason, /No replaceable hydrogen/);
  assert.match(one.atoms[8].reason, /not a supported attachment/);
  assert.equal(two.atoms[5].aromatic, true);
  assert.deepEqual(two.atoms[5].explicitHydrogens, [7]);
  assert.equal(two.atoms[5].recommendedHydrogenAtom, 7);
  assert.equal(two.atoms[6].heavy, false);
  assert.match(two.atoms[6].reason, /select heavy atom 6/);
  const q = await fixture('query');
  assert.equal(
    (await inspectAttachmentSites(writeSdf(parseSdf(q)[0]))).errors[0].code,
    'QUERY_FRAGMENT_COUNT',
  );
});

test('isotope-labelled hydrogens are never auto-selected but may be chosen explicitly', async () => {
  const partner = parseSdf(await fixture('query'))[1];
  const cd3 = await explicitRecord('[2H]C([2H])([2H])c1ccccc1');
  const carbon = cd3.atoms.findIndex((a) => a.element === 'C') + 1;
  const deuteria = cd3.atoms.flatMap((a, i) => (a.isotope === 2 ? [i + 1] : []));
  assert.equal(deuteria.length, 3);
  const sdf = writeSdf(cd3) + writeSdf(partner);
  const inspected = await inspectAttachmentSites(sdf);
  const site = inspected.fragments[0].atoms[carbon - 1];
  assert.equal(site.eligible, true);
  assert.equal(site.requiresHydrogenSelection, true);
  assert.equal(site.recommendedHydrogenAtom, null);
  assert.match(site.reason, /isotope-labelled/);
  assert.equal(
    (await prepareQuery(sdf, [carbon, 1])).errors[0].code,
    'ISOTOPE_H_SELECTION_REQUIRED',
  );
  const chosen = await prepareQuery(sdf, [{ atom: carbon, hydrogenAtom: deuteria[1] }, 1]);
  assert.equal(chosen.ok, true, JSON.stringify(chosen.errors));
  assert.equal(chosen.attachments[0].removedHydrogenAtom, deuteria[1]);
  // The D element symbol is the same label as H with M ISO 2.
  cd3.atoms[deuteria[0] - 1] = { ...cd3.atoms[deuteria[0] - 1], element: 'D', isotope: null };
  const symbol = await prepareQuery(writeSdf(cd3) + writeSdf(partner), [carbon, 1]);
  assert.equal(symbol.errors[0].code, 'ISOTOPE_H_SELECTION_REQUIRED');
  // A CH2D centre auto-selects the ordinary hydrogen.
  const mixed = await explicitRecord('[2H]Cc1ccccc1');
  const mixedCarbon = mixed.atoms.findIndex((a) => a.element === 'C') + 1;
  const auto = await prepareQuery(writeSdf(mixed) + writeSdf(partner), [mixedCarbon, 1]);
  assert.equal(auto.ok, true, JSON.stringify(auto.errors));
  const removed = mixed.atoms[auto.attachments[0].removedHydrogenAtom - 1];
  assert.equal(removed.isotope, null);
});

test('explicit-H replacement keeps coordinates, charges, isotopes, numbering and stereo', async () => {
  const { descriptor, pair, frames } = await portFrame(['C', 'C']);
  const [f1, f2] = frames;
  const t1 = tetrahedron(f1.toward, 1),
    stereo = at(f1.center, t1[2], 1.53),
    s = tetrahedron(unit(sub(f1.center, stereo)));
  const one = [
    atom('C', f1.center, { parity: 1 }),
    atom('H', at(f1.center, f1.toward, 1.09)),
    atom('H', at(f1.center, t1[0], 1.09)),
    atom('F', at(f1.center, t1[1], 1.35)),
    atom('C', stereo),
    atom('Cl', at(stereo, s[0], 1.78)),
    atom('C', at(stereo, s[1], 1.53), { isotope: 13 }),
    atom('H', at(stereo, s[2], 1.09), { isotope: 2 }),
  ];
  const t2 = tetrahedron(f2.toward);
  const two = [
    atom('C', f2.center),
    atom('H', at(f2.center, f2.toward, 1.09)),
    atom('H', at(f2.center, t2[0], 1.09)),
    atom('H', at(f2.center, t2[1], 1.09)),
    atom('O', at(f2.center, t2[2], 1.43), { charge: -1 }),
  ];
  const sdf =
    record(one, [[1, 2], [1, 3], [1, 4], [1, 5], [5, 6], [5, 7], [5, 8]]) +
    record(two, [[1, 2], [1, 3], [1, 4], [1, 5]]);
  const query = parseSdf(sdf);
  const prepared = await prepareQuery(sdf, [{ atom: 1, hydrogenAtom: 2 }, 1]);
  assert.equal(prepared.ok, true, JSON.stringify(prepared.errors));
  assert.equal(prepared.attachments[1].removedHydrogenAtom, 2); // first ordinary H
  const result = await agree(prepared, descriptor, { pair: [pair.a, pair.b] });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.ok(result.rmsd < 1e-3); // only 4-decimal SDF rounding
  assert.deepEqual(result.removedHydrogens, [
    { fragment: 1, atom: 2 },
    { fragment: 2, atom: 2 },
  ]);
  const product = parseSdf(result.sdf)[0];
  assert.equal(product.atoms.length, 8 - 1 + 5 - 1 + descriptor.atomCount - 2);
  assert.equal(result.fragmentAtomCount, 11);
  assert.deepEqual(
    result.sourceAtomMappings.filter((m) => m.removed).map((m) => [m.fragment, m.atom, m.productAtom]),
    [
      [1, 2, null],
      [2, 2, null],
    ],
  );
  // Surviving uploaded atoms occupy product atoms 1..11 in original order with exact coordinates.
  const kept = result.sourceAtomMappings.filter((m) => !m.removed);
  kept.forEach((m, i) => {
    assert.equal(m.productAtom, i + 1);
    const source = query[m.fragment - 1].atoms[m.atom - 1],
      target = product.atoms[m.productAtom - 1];
    assert.deepEqual(target.xyz, source.xyz);
    assert.equal(target.element, source.element);
    assert.equal(target.charge, source.charge);
    assert.equal(target.isotope, source.isotope);
  });
  assert.deepEqual(result.fixedAtoms, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  assert.deepEqual(result.fixedHeavyAtoms, [1, 3, 4, 5, 6, 8, 11]);
  assert.equal(product.atoms.reduce((sum, a) => sum + a.charge, 0), 2 - 1);
  assert.match(result.smiles, /\[13CH3\]/);
  assert.match(result.smiles, /\[2H\]/);
  // The new bond sits in the removed hydrogen's direction.
  const [x1, l1] = [result.attachments[0].productAtom, result.attachments[0].linkerProductAtom].map((i) => product.atoms[i - 1].xyz);
  assert.ok(angle(sub(l1, x1), f1.toward) <= 35);
  assert.ok(product.bonds.some((b) => [b.a, b.b].sort().join() === [x1, l1].map((p) => product.atoms.findIndex((a) => a.xyz === p)).sort().join()));
  // V2000 parity ranks hydrogens highest: neighbours H2 (replaced), H3, F4, C5
  // rank F4 < C5 < H2 < H3 and become F3 < C4 < linker N < H2, the same
  // permutation, so parity 1 is kept.
  assert.equal(product.atoms[0].parity, 1);
  // RDKit CIP from 3D: the untouched stereocentre keeps its label; the new
  // centre matches the fragment with N standing in the replaced H position.
  const productTags = await stereoTags(result.sdf.split('$$$$')[0]);
  const fragmentTags = await stereoTags(writeMolBlock(query[0]));
  assert.ok(fragmentTags[4]);
  assert.equal(productTags[3], fragmentTags[4]);
  const standIn = structuredClone(query[0]);
  standIn.atoms[1].element = descriptor.molecule.atoms[descriptor.sites.find((x) => x.atom === result.selectedLabels[0]).neighbor].element;
  const standInTags = await stereoTags(writeMolBlock(standIn));
  assert.ok(standInTags[0]);
  assert.equal(productTags[0], standInTags[0]);
  // Replacing the other H yields the other configuration or is refused by the exit cone.
  const other = await agree(await prepareQuery(sdf, [{ atom: 1, hydrogenAtom: 3 }, 1]), descriptor, { pair: [pair.a, pair.b] });
  if (other.ok) assert.notEqual((await stereoTags(other.sdf.split('$$$$')[0]))[0], productTags[0]);
  else assert.ok(other.errors.some((e) => e.code === 'ATTACHMENT_STEREO'));
});

// RDKit's own perception of a 3D record: the atom parities it writes back and
// each atom's isotope (0 = natural). The oracle for parity and isotope output.
const rdkitView = async (block) => {
  const r = await initRDKit(),
    m = r.get_mol(block, '{"removeHs":false}');
  try {
    const written = m.get_molblock(),
      lines = written.split('\n'),
      n = Number(lines[3].slice(0, 3)),
      isotopes = new Array(n).fill(0);
    for (const line of lines.filter((l) => l.startsWith('M  ISO')))
      for (let j = 0; j < Number(line.slice(6, 9)); j++)
        isotopes[Number(line.slice(10 + j * 8, 14 + j * 8)) - 1] = Number(line.slice(14 + j * 8, 18 + j * 8));
    return {
      parities: lines.slice(4, 4 + n).map((l) => Number(l.slice(39, 42))),
      massDifferences: lines.slice(4, 4 + n).map((l) => Number(l.slice(34, 36))),
      isotopes,
      smiles: m.get_smiles(),
    };
  } finally {
    m.delete();
  }
};
const firstBlock = (sdf) => sdf.split('$$$$')[0];
const perpendicular = (u) => unit(cross(u, Math.abs(u[0]) < 0.8 ? [1, 0, 0] : [0, 1, 0]));
// Two directions at 120° from u and each other, in the plane of u and perpendicular(u).
const trigonal = (u) => {
  const p = perpendicular(u);
  return [2, 4].map((k) => add(scale(u, Math.cos((k * Math.PI) / 3)), scale(p, Math.sin((k * Math.PI) / 3))));
};
// Rewrites every hydrogen M  ISO entry as the atom-block mass difference (cols 35-36).
const hydrogenMassDifferenceForm = (sdf) =>
  sdf
    .split('$$$$\n')
    .filter((r) => r.trim())
    .map((r) => {
      const lines = r.split('\n'),
        isotopes = new Map();
      for (const line of lines.filter((l) => l.startsWith('M  ISO')))
        for (let j = 0; j < Number(line.slice(6, 9)); j++)
          isotopes.set(Number(line.slice(10 + j * 8, 14 + j * 8)), Number(line.slice(14 + j * 8, 18 + j * 8)));
      return `${lines
        .map((line, i) => {
          const iso = isotopes.get(i - 3);
          if (i < 4 || !iso || line.slice(31, 34).trim() !== 'H') return line;
          return line.slice(0, 34) + String(iso - 1).padStart(2) + line.slice(36);
        })
        .filter((line) => !line.startsWith('M  ISO'))
        .join('\n')}$$$$\n`;
    })
    .join('');
// Linker C1–C2 whose He labels 3 (on C1) and 4 (on C2) are anti, with query
// centres placed on both anchors, so torsion 0 of the rigid fit is the identity.
function ethaneLinker(chiral = 0) {
  const c1 = [0, 0, 0],
    c2 = [1.53, 0, 0],
    d1 = tetrahedron([1, 0, 0])[0],
    d2 = scale(d1, -1); // anti: parallel and opposite directions
  const linker = {
    title: 'linker',
    is3D: true,
    chiral,
    atoms: [atom('C', c1), atom('C', c2), atom('He', at(c1, d1, 1.1)), atom('He', at(c2, d2, 1.1))],
    bonds: [
      { a: 0, b: 1, order: 1 },
      { a: 0, b: 2, order: 1 },
      { a: 1, b: 3, order: 1 },
    ],
  };
  return { linker, anchors: [at(c1, d1, 1.5), at(c2, d2, 1.5)], toward: [scale(d1, -1), scale(d2, -1)] };
}

test('V2000 parity ranks hydrogens highest and agrees with RDKit 3D perception after explicit-H replacement', async () => {
  const { linker, anchors, toward } = ethaneLinker();
  // Fragment 1: stereocentre C1 (H2 replaced, F3, Cl4, C5) next to stereocentre
  // C5 (C1, Br6, D7 written as an atom-block mass difference, C8).
  const q1 = anchors[0],
    t1 = tetrahedron(toward[0]),
    c5 = at(q1, t1[2], 1.53),
    t5 = tetrahedron(unit(sub(q1, c5)));
  const one = {
    title: 'one',
    is3D: true,
    atoms: [
      atom('C', q1),
      atom('H', at(q1, toward[0], 1.09)),
      atom('F', at(q1, t1[0], 1.35)),
      atom('Cl', at(q1, t1[1], 1.78)),
      atom('C', c5),
      atom('Br', at(c5, t5[0], 1.94)),
      atom('H', at(c5, t5[1], 1.09), { isotope: 2 }),
      atom('C', at(c5, t5[2], 1.53)),
    ],
    bonds: [[0, 1], [0, 2], [0, 3], [0, 4], [4, 5], [4, 6], [4, 7]].map(([a, b]) => ({ a, b, order: 1 })),
  };
  const q2 = anchors[1];
  const two = {
    title: 'two',
    is3D: true,
    atoms: [atom('C', q2), atom('C', at(q2, tetrahedron(toward[1])[0], 1.53))],
    bonds: [{ a: 0, b: 1, order: 1 }],
  };
  // Source parities are RDKit's own perception of fragment 1's coordinates.
  const perceived = (await rdkitView(writeMolBlock(one))).parities;
  assert.ok([1, 2].includes(perceived[0]) && [1, 2].includes(perceived[4]));
  one.atoms[0].parity = perceived[0];
  one.atoms[4].parity = perceived[4];
  const sdf = hydrogenMassDifferenceForm(writeSdf(one) + writeSdf(two));
  assert.doesNotMatch(sdf, /M {2}ISO/);
  assert.equal(parseSdf(sdf)[0].atoms[6].isotope, 2);
  const descriptor = linkerDescriptor(writeSdf(linker));
  const prepared = await prepareQuery(sdf, [{ atom: 1, hydrogenAtom: 2 }, 1]);
  assert.equal(prepared.ok, true, JSON.stringify(prepared.errors));
  const result = await agree(prepared, descriptor, { maxRmsd: 0.05 });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  const block = firstBlock(result.sdf),
    product = parseSdf(block)[0],
    rdkit = await rdkitView(block);
  // Written parity equals RDKit's parity for the product's 3D coordinates, at
  // the replaced-H centre (now C1 with F2, Cl3, C4 and the linker C) and the
  // untouched adjacent centre (product atom 4).
  assert.equal(product.atoms[0].parity, rdkit.parities[0]);
  assert.equal(product.atoms[3].parity, rdkit.parities[3]);
  assert.ok([1, 2].includes(rdkit.parities[0]));
  // Same ranks before and after (F < Cl < C < H → F < Cl < C < linker C): no flip.
  assert.equal(product.atoms[0].parity, perceived[0]);
  // The mass-difference D survives as an isotope, in the SMILES and the RDKit reading.
  assert.equal(product.atoms[5].isotope, 2);
  assert.equal(rdkit.isotopes[5], 2);
  assert.match(result.smiles, /\[2H\]/);
  // No record set the chiral flag, so neither does the product.
  assert.equal(product.chiral, 0);
});

test('linker parity: an unused He label becomes an H cap that ranks highest; chiral flag needs every record', async () => {
  const ca = [0, 0, 0],
    cb = [1.53, 0, 0],
    t = tetrahedron([1, 0, 0]);
  // C1 carries F2, He3 (unused → H cap), C4 and He5 (joined); C4 carries He6.
  // The H cap is numbered below C4, so ranking it by atom number would give the
  // opposite parity.
  const linkerAtoms = [
    atom('C', ca),
    atom('F', at(ca, t[0], 1.35)),
    atom('He', at(ca, t[1], 1.1)),
    atom('C', cb),
    atom('He', at(ca, t[2], 1.1)),
    atom('He', at(cb, scale(t[2], -1), 1.1)),
  ];
  const linkerBonds = [[0, 1], [0, 2], [0, 3], [0, 4], [3, 5]].map(([a, b]) => ({ a, b, order: 1 }));
  // The record's parity (He labels ranked by atom number) is RDKit's
  // perception of the same coordinates with distinct non-H stand-ins.
  const proxy = { title: 'proxy', is3D: true, atoms: linkerAtoms.map((a, i) => ({ ...a, element: ['C', 'F', 'Cl', 'C', 'Br', 'Cl'][i] })), bonds: linkerBonds };
  const linkerParity = (await rdkitView(writeMolBlock(proxy))).parities[0];
  assert.ok([1, 2].includes(linkerParity));
  linkerAtoms[0].parity = linkerParity;
  const methyl = (center, toward, chiral) => ({
    title: 'methyl',
    is3D: true,
    chiral,
    atoms: [atom('C', center), atom('C', at(center, tetrahedron(toward)[0], 1.53))],
    bonds: [{ a: 0, b: 1, order: 1 }],
  });
  const q1 = at(ca, t[2], 1.5),
    q2 = at(cb, scale(t[2], -1), 1.5);
  const run = async (flags) => {
    const [l, f1, f2] = flags;
    const descriptor = linkerDescriptor(writeSdf({ title: 'linker', is3D: true, chiral: l, atoms: linkerAtoms, bonds: linkerBonds }));
    const prepared = await prepareQuery(
      writeSdf(methyl(q1, scale(t[2], -1), f1)) + writeSdf(methyl(q2, t[2], f2)),
      [1, 1],
    );
    assert.equal(prepared.ok, true, JSON.stringify(prepared.errors));
    const result = await agree(prepared, descriptor, { pair: [5, 6], maxRmsd: 0.05 });
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    return result;
  };
  const result = await run([1, 0, 0]),
    block = firstBlock(result.sdf),
    product = parseSdf(block)[0],
    rdkit = await rdkitView(block);
  const center = 4; // product atom 5: linker C1 after the two 2-atom query records
  assert.equal(product.atoms[center].element, 'C');
  assert.ok(product.atoms.some((a, i) => a.element === 'H' && product.bonds.some((b) => [b.a, b.b].includes(i) && [b.a, b.b].includes(center))));
  assert.ok([1, 2].includes(rdkit.parities[center]));
  assert.equal(product.atoms[center].parity, rdkit.parities[center]);
  // Chiral flag 1 only when the linker and both query records set it.
  assert.equal(product.chiral, 0);
  assert.equal(parseSdf((await run([1, 1, 1])).sdf)[0].chiral, 1);
  assert.equal(parseSdf((await run([0, 1, 1])).sdf)[0].chiral, 0);
  assert.equal(parseSdf((await run([1, 1, 0])).sdf)[0].chiral, 0);
});

test('amide across the new bond: an acyl partner makes the N centre planar on both sides', async () => {
  // Query or linker N joined to an acyl C (aldehyde/formamide C–H, or a linker
  // C=O) must pass the amide planarity check. A pyramidal N is refused; the
  // same N laid out planar is accepted. Fragment 2 is a thiol S and maxRmsd is
  // tight, so the swapped label assignment (rmsd ~0.01 Å) cannot fit.
  const thiol = (center, toward) => {
    const dir = add(scale(toward, Math.cos((100 * Math.PI) / 180)), scale(perpendicular(toward), Math.sin((100 * Math.PI) / 180)));
    return { title: 'thiol', is3D: true, atoms: [atom('S', center), atom('C', at(center, dir, 1.82))], bonds: [{ a: 0, b: 1, order: 1 }] };
  };
  const fit = async (linker, one, two, pair) => {
    const descriptor = linkerDescriptor(writeSdf(linker));
    assert.equal(descriptor.ok, true, JSON.stringify(descriptor.errors));
    const prepared = await prepareQuery(writeSdf(one) + writeSdf(two), [{ atom: 1, hydrogenAtom: 2 }, 1]);
    assert.equal(prepared.ok, true, JSON.stringify(prepared.errors));
    return agree(prepared, descriptor, { pair, maxRmsd: 0.005 });
  };
  const bonds = (list) => list.map(([a, b, order = 1]) => ({ a, b, order }));
  const u = [1, 0, 0],
    origin = [0, 0, 0],
    cb = [1.5, 0, 0];
  // Linker C(b)–S label anchor, anti to the first label.
  const secondLabel = (labelDirection) => {
    const options = tetrahedron(scale(u, -1));
    return options.reduce((best, d) => (dot(d, labelDirection) < dot(best, labelDirection) ? d : best));
  };
  for (const planar of [false, true]) {
    // 1) Linker N1 (He2, methyl C3, C4 with He5) joined to a query aldehyde C–H.
    const nDirs = planar ? trigonal(u) : tetrahedron(u).slice(0, 2);
    const [methylDir, labelDir] = nDirs,
      d2 = secondLabel(labelDir);
    const linker = {
      title: 'N linker',
      is3D: true,
      atoms: [atom('N', origin), atom('He', at(origin, labelDir, 1.0)), atom('C', at(origin, methylDir, 1.47)), atom('C', cb), atom('He', at(cb, d2, 1.1))],
      bonds: bonds([[0, 1], [0, 2], [0, 3], [3, 4]]),
    };
    const q1 = at(origin, labelDir, connectionLength('C', 'N')),
      h1 = scale(labelDir, -1),
      [oDir, cDir] = trigonal(h1);
    const aldehyde = {
      title: 'aldehyde',
      is3D: true,
      atoms: [atom('C', q1), atom('H', at(q1, h1, 1.09)), atom('O', at(q1, oDir, 1.22)), atom('C', at(q1, cDir, 1.5))],
      bonds: bonds([[0, 1], [0, 2, 2], [0, 3]]),
    };
    const q2 = at(cb, d2, connectionLength('S', 'C'));
    const linked = await fit(linker, aldehyde, thiol(q2, scale(d2, -1)), [2, 5]);
    if (planar) {
      assert.equal(linked.ok, true, JSON.stringify(linked.errors));
      assert.deepEqual(linked.selectedLabels, [2, 5]);
    } else {
      assert.equal(linked.ok, false);
      assert.ok(linked.errors.some((e) => e.code === 'ATTACHMENT_PLANARITY'), JSON.stringify(linked.errors));
    }
    // 2) Query N–H (two methyls) joined to a linker acyl C1 (=O2, He3, C4 with He5).
    const [oLinker, acylLabel] = trigonal(u),
      e2 = secondLabel(acylLabel);
    const acylLinker = {
      title: 'acyl linker',
      is3D: true,
      atoms: [atom('C', origin), atom('O', at(origin, oLinker, 1.22)), atom('He', at(origin, acylLabel, 1.0)), atom('C', cb), atom('He', at(cb, e2, 1.1))],
      bonds: bonds([[0, 1, 2], [0, 2], [0, 3], [3, 4]]),
    };
    const qn = at(origin, acylLabel, connectionLength('N', 'C')),
      hn = scale(acylLabel, -1),
      methyls = planar ? trigonal(hn) : tetrahedron(hn).slice(0, 2);
    const amine = {
      title: 'amine',
      is3D: true,
      atoms: [atom('N', qn), atom('H', at(qn, hn, 1.01)), ...methyls.map((d) => atom('C', at(qn, d, 1.47)))],
      bonds: bonds([[0, 1], [0, 2], [0, 3]]),
    };
    const q2b = at(cb, e2, connectionLength('S', 'C'));
    const amide = await fit(acylLinker, amine, thiol(q2b, scale(e2, -1)), [3, 5]);
    if (planar) {
      assert.equal(amide.ok, true, JSON.stringify(amide.errors));
      assert.deepEqual(amide.selectedLabels, [3, 5]);
    } else {
      assert.equal(amide.ok, false, JSON.stringify([amide.selectedLabels, amide.rmsd, amide.torsionDegrees, amide.smiles]));
      assert.ok(amide.errors.some((e) => e.code === 'ATTACHMENT_PLANARITY'), JSON.stringify(amide.errors));
    }
  }
});

test('atom-block mass differences are isotopes: never auto-selected, written once as M  ISO', async () => {
  const partner = parseSdf(await fixture('query'))[1];
  // CD3 and CH2D written with mass differences only (no M  ISO).
  const cd3 = await explicitRecord('[2H]C([2H])([2H])c1ccccc1');
  const cd3Text = hydrogenMassDifferenceForm(writeSdf(cd3));
  assert.doesNotMatch(cd3Text, /M {2}ISO/);
  const parsed = parseSdf(cd3Text)[0];
  assert.deepEqual(parsed.atoms.map((a) => a.isotope), cd3.atoms.map((a) => a.isotope));
  // writeMolBlock emits each isotope once (mass difference 0, absolute M  ISO)
  // and RDKit reads the same isotopes from the original and the rewritten block.
  const rewritten = writeMolBlock(parsed),
    original = await rdkitView(cd3Text),
    again = await rdkitView(rewritten);
  assert.deepEqual(again.isotopes, original.isotopes);
  assert.equal(original.isotopes.filter((i) => i === 2).length, 3);
  assert.equal(again.smiles, original.smiles);
  assert.ok(rewritten.split('\n').slice(4, 4 + parsed.atoms.length).every((l) => l.slice(34, 36) === ' 0'));
  assert.match(rewritten, /M {2}ISO {2}3/);
  assert.deepEqual(parseSdf(rewritten)[0].atoms.map((a) => a.isotope), parsed.atoms.map((a) => a.isotope));
  // M  ISO overrides an atom's mass difference, per atom (RDKit semantics).
  const d = parsed.atoms.findIndex((a) => a.isotope === 2);
  const overridden = cd3Text.replace('M  END', `M  ISO  1 ${String(d + 1).padStart(3)}   3\nM  END`);
  assert.deepEqual(
    parseSdf(overridden)[0].atoms.map((a) => a.isotope),
    (await rdkitView(overridden)).isotopes.map((i) => i || null),
  );
  assert.equal(parseSdf(overridden)[0].atoms[d].isotope, 3);
  // Selection: a mass-difference D is never chosen automatically.
  const carbon = parsed.atoms.findIndex((a) => a.element === 'C') + 1;
  const sdf = cd3Text + writeSdf(partner);
  assert.equal((await prepareQuery(sdf, [carbon, 1])).errors[0].code, 'ISOTOPE_H_SELECTION_REQUIRED');
  const mixed = await explicitRecord('[2H]Cc1ccccc1');
  const mixedText = hydrogenMassDifferenceForm(writeSdf(mixed));
  const mixedCarbon = mixed.atoms.findIndex((a) => a.element === 'C') + 1;
  const auto = await prepareQuery(mixedText + writeSdf(partner), [mixedCarbon, 1]);
  assert.equal(auto.ok, true, JSON.stringify(auto.errors));
  assert.equal(mixed.atoms[auto.attachments[0].removedHydrogenAtom - 1].isotope, null);
  // A mass difference on an element without a known reference mass is refused.
  const unknown = cd3Text.replace(/^(.{31})C {2}(.{2})/m, '$1Uu  1');
  assert.throws(() => parseSdf(unknown), /mass difference/);
});

test('oxygen and sulfur centres: two-coordinate O–H/S–H accepted, others refused', async () => {
  const { descriptor, pair, frames } = await portFrame(['O', 'S']);
  const [f1, f2] = frames;
  const t1 = tetrahedron(f1.toward),
    t2 = tetrahedron(f2.toward);
  const sdf =
    record(
      [atom('O', f1.center), atom('H', at(f1.center, f1.toward, 0.97)), atom('C', at(f1.center, t1[0], 1.43))],
      [[1, 2], [1, 3]],
    ) + record([atom('S', f2.center), atom('C', at(f2.center, t2[0], 1.82))], [[1, 2]]);
  const prepared = await prepareQuery(sdf, [1, 1]);
  assert.equal(prepared.ok, true, JSON.stringify(prepared.errors));
  assert.deepEqual(
    prepared.attachments.map((a) => [a.element, a.hydrogen]),
    [
      ['O', 'explicit'],
      ['S', 'implicit'],
    ],
  );
  const result = await agree(prepared, descriptor, { pair: [pair.a, pair.b] });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  const product = parseSdf(result.sdf)[0];
  for (const a of result.attachments)
    assert.ok(
      product.bonds.some(
        (b) =>
          [b.a + 1, b.b + 1].sort((x, y) => x - y).join() ===
          [a.productAtom, a.linkerProductAtom].sort((x, y) => x - y).join(),
      ),
    );
  assert.deepEqual(result.attachments.map((a) => product.atoms[a.linkerProductAtom - 1].element), ['N', 'N']);
  // Refused element pairs and unvalidated centres.
  for (const [q, l] of [['O', 'O'], ['O', 'S'], ['S', 'S'], ['C', 'P'], ['P', 'C'], ['C', 'Cl']])
    assert.equal(connectionLength(q, l), null);
  const bent = (element, degrees, extra = []) => {
    const r = (degrees * Math.PI) / 180;
    return {
      atoms: [atom(element, [0, 0, 0]), atom('C', [1.4, 0, 0]), atom('C', [1.5 * Math.cos(r), 1.5 * Math.sin(r), 0]), ...extra],
      bonds: [{ a: 0, b: 1, order: 1 }, { a: 0, b: 2, order: 1 }, ...extra.map((_, i) => ({ a: 0, b: 3 + i, order: 1 }))],
    };
  };
  assert.equal(attachmentGeometryError(bent('O', 110), 0, 2), null);
  assert.equal(attachmentGeometryError(bent('S', 100), 0, 2), null);
  assert.equal(attachmentGeometryError(bent('O', 60), 0, 2).code, 'ATTACHMENT_BENT');
  assert.equal(attachmentGeometryError(bent('S', 150), 0, 2).code, 'ATTACHMENT_BENT');
  assert.equal(
    attachmentGeometryError(bent('O', 110, [atom('C', [0, 0, 1.4])]), 0, 2).code,
    'UNSUPPORTED_ATTACHMENT_GEOMETRY',
  );
  const charged = bent('O', 110);
  charged.atoms[0].charge = 1;
  assert.equal(attachmentGeometryError(charged, 0, 2).code, 'UNSUPPORTED_ATTACHMENT_GEOMETRY');
  assert.equal(attachmentGeometryError(bent('P', 110), 0, 2).code, 'UNSUPPORTED_ATTACHMENT_GEOMETRY');
  // Static eligibility reasons before any search.
  const partner = writeSdf(parseSdf(await fixture('query'))[1]);
  const reasons = async (smiles, element) => {
    const molecule = await explicitRecord(smiles);
    const inspected = await inspectAttachmentSites(writeSdf(molecule) + partner);
    assert.equal(inspected.ok, true, JSON.stringify(inspected.errors));
    return inspected.fragments[0].atoms.find((a) => a.element === element);
  };
  assert.equal((await reasons('CO', 'O')).eligible, true);
  assert.equal((await reasons('CS', 'S')).eligible, true);
  assert.match((await reasons('C[OH2+]', 'O')).reason, /neutral, two-coordinate/);
  assert.match((await reasons('COC', 'O')).reason, /No replaceable hydrogen/);
  assert.match((await reasons('CP', 'P')).reason, /Phosphorus/);
  assert.equal((await reasons('c1ccsc1', 'S')).eligible, false);
});

test('candidate distance window never excludes a pair the engine could accept', async () => {
  // Formula level: random anchors, every element pairing and both assignments.
  let accepted = 0;
  const random = () => [Math.random() * 20 - 10, Math.random() * 20 - 10, Math.random() * 20 - 10];
  for (let trial = 0; trial < 20000; trial++) {
    const q = [0, 1].map(() => ATTACHMENT_ELEMENTS[Math.floor(Math.random() * 4)]);
    const l = [0, 1].map(() => ATTACHMENT_ELEMENTS[Math.floor(Math.random() * 4)]);
    const sites = [0, 1].map(() => ({ position: random(), direction: unit(random()) }));
    const indexed = distance(...sites.map((s) => at(s.position, s.direction, INDEX_ANCHOR_LENGTH)));
    const lengths = [0, 1].map((i) => connectionLength(q[i], l[i]));
    if (lengths.includes(null)) continue;
    const engine = distance(...sites.map((s, i) => at(s.position, s.direction, lengths[i])));
    const maxRmsd = 0.1 + Math.random() * 0.9;
    const D = engine + (Math.random() * 2 - 1) * 2 * maxRmsd;
    if (Math.abs(engine - D) / 2 > maxRmsd) continue;
    accepted++;
    const window = candidateDistanceWindow({ ok: true, distance: D, attachments: q.map((element) => ({ element })) }, maxRmsd);
    assert.ok(indexed >= window.lo && indexed <= window.hi, JSON.stringify({ q, l, D, indexed, window }));
  }
  assert.ok(accepted > 5000);
  // Engine level: any placement passing the anchor gate lies inside the window.
  const real = await prepareQuery(await fixture('query'), [1, 1]);
  const descriptor = linkerDescriptor(await fixture('multi-port'));
  let gated = 0;
  for (let D = 0.5; D < 14; D += 0.25) {
    const prepared = { ...real, distance: D };
    const window = candidateDistanceWindow(prepared, 0.3);
    for (const p of descriptor.pairs) {
      const result = await fitAndJoin(prepared, descriptor, { pair: [p.a, p.b], maxRmsd: 0.3 });
      const anchorOnly = !result.ok && result.errors.every((e) => e.code === 'ANCHOR_DISTANCE');
      if (anchorOnly) continue;
      gated++;
      assert.ok(p.distance >= window.lo && p.distance <= window.hi);
    }
  }
  assert.ok(gated > 0);
  // The supplied example's matching pair is inside the window.
  const example = linkerDescriptor(await fixture('linker'));
  const w = candidateDistanceWindow(real, 0.75);
  assert.ok(example.pairs[0].distance >= w.lo && example.pairs[0].distance <= w.hi);
  assert.throws(() => candidateDistanceWindow({ ok: false }, 0.5), /valid two-fragment/);
});

test('optimized fitting matches the reference algorithm on fixtures and settings', async () => {
  const q = await fixture('query'),
    linker = await fixture('linker'),
    descriptor = linkerDescriptor(linker);
  let accepted = 0;
  for (const selection of [[1, 1], [1, 6], [2, 1], [5, 1], [1, 13], [2, 4]]) {
    const prepared = await prepareQuery(q, selection);
    assert.equal(prepared.ok, true, JSON.stringify([selection, prepared.errors]));
    for (const options of [{}, { maxRmsd: 1 }, { maxRmsd: 1, clashScale: 0.45 }, { maxRmsd: 1, minAttachmentAngle: 70 }, { maxRmsd: 2, torsionStepDegrees: 7 }])
      if ((await agree(prepared, descriptor, options)).ok) accepted++;
  }
  assert.ok(accepted >= 1);
  const multi = linkerDescriptor(await fixture('multi-port'));
  for (const p of multi.pairs) await agree(await prepareQuery(q, [1, 1]), multi, { pair: [p.a, p.b], maxRmsd: 2, clashScale: 0.1, minAttachmentAngle: 30 });
});

test('SD data items are written before $$$$ and survive parsing', async () => {
  const molecule = parseSdf(await fixture('query'))[0];
  const text = writeSdf(molecule, { PYXIS_METHOD: 'rigid fit', PYXIS_NOTE: 'two\n\nlines' });
  assert.match(text, /M {2}END\n> <PYXIS_METHOD>\nrigid fit\n\n> <PYXIS_NOTE>\ntwo\nlines\n\n\$\$\$\$\n$/);
  const annotated = withSdfData(text + text, { PYXIS_METHOD: 'replaced', EXTRA: 1 });
  const records = parseSdf(annotated);
  assert.equal(records.length, 2);
  assert.deepEqual(records[0].atoms, molecule.atoms);
  assert.equal(annotated.match(/PYXIS_METHOD/g).length, 2);
  assert.equal(annotated.match(/replaced/g).length, 2);
  assert.equal(annotated.match(/PYXIS_NOTE/g).length, 2);
  assert.throws(() => writeSdf(molecule, { 'bad key': 1 }), /SD data keys/);
  assert.throws(() => writeSdf(molecule, { KEY: 'a$$$$b' }), /\$\$\$\$/);
  assert.equal(writeSdf(molecule), `${writeMolBlock(molecule)}$$$$\n`);
});

// ---------------------------------------------------------------------------
// Full-scan hot path: bit-identical geometry, topology-keyed RDKit validity
// cache and deferred materialization. fitAndJoinReference stays the oracle.

// Deterministic PRNG (mulberry32) so fuzz failures reproduce.
const prng = (seed) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const same = (a, b, message) =>
  assert.ok(
    a.length === b.length && a.every((v, i) => Object.is(v, b[i])),
    `${message}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`,
  );

test('split anchor frame and vector helpers are bit-identical to geometry.mjs', () => {
  const random = prng(7),
    vector = (s = 20) => [0, 1, 2].map(() => (random() - 0.5) * s);
  for (let trial = 0; trial < 3000; trial++) {
    const source = [vector(), vector()];
    let target = [vector(), vector()];
    // Parallel and antiparallel axes take twoAnchorTransform's fallback branch.
    if (trial % 7 === 0) {
      const d = sub(source[1], source[0]),
        k = trial % 14 ? 1.7 : -0.6;
      target = [target[0], add(target[0], scale(d, k))];
    }
    const frame = anchorFrame(source, target);
    for (let t = 0; t < 4; t++) {
      const radians = ((Math.floor(random() * 36) * 10 + (t === 3 ? 7 : 0)) * Math.PI) / 180;
      const reference = twoAnchorTransform(source, target, radians);
      const p = vector(30);
      same(
        frameTorsion(frame, framePre(frame, p), Math.cos(radians), Math.sin(radians), [0, 0, 0]),
        reference(p),
        'frameTorsion',
      );
    }
    const a = vector(),
      b = vector();
    assert.ok(Object.is(vector3.dot(a, b), dot(a, b)));
    same(vector3.sub(a, b), sub(a, b), 'sub');
    same(vector3.cross(a, b), cross(a, b), 'cross');
    same(vector3.unit(a), unit(a), 'unit');
    assert.ok(Object.is(vector3.angle(a, b), angle(a, b)));
  }
  assert.equal(vector3.unit([0, 0, 1e-12]), null);
  assert.equal(anchorFrame([[0, 0, 0], [0, 0, 0]], [[0, 0, 0], [1, 0, 0]]), null);
});

test('LRU cache keeps the most recently used entries within its bound', () => {
  const cache = new LruCache(3);
  for (const k of ['a', 'b', 'c']) cache.set(k, k.toUpperCase());
  assert.equal(cache.get('a'), 'A'); // refresh a: b is now the oldest
  cache.set('d', 'D');
  assert.equal(cache.size, 3);
  assert.equal(cache.get('b'), undefined);
  assert.deepEqual([...cache.map.keys()], ['c', 'a', 'd']);
  cache.set('c', 'C2'); // re-set refreshes too
  cache.set('e', 'E');
  assert.deepEqual([...cache.map.keys()], ['d', 'c', 'e']);
  const none = new LruCache(0);
  none.set('x', 1);
  assert.equal(none.size, 0);
  assert.throws(() => new LruCache(-1), RangeError);
  assert.throws(() => new LruCache(1.5), RangeError);
  assert.equal(TOPOLOGY_CACHE_LIMIT, 20000);
});

// A product record re-parsed from a materialized SDF, plus the same record with
// the supplied positive nitrogen neutralized (invalid valence).
async function fixtureProducts() {
  const prepared = await prepareQuery(await fixture('query'), [1, 1]);
  const fit = await fitAndJoinReference(prepared, await fixture('linker'));
  assert.equal(fit.ok, true);
  const valid = parseSdf(fit.sdf)[0];
  const invalid = structuredClone(valid);
  const charged = invalid.atoms.findIndex((a) => a.element === 'N' && a.charge === 1);
  invalid.atoms[charged].charge = 0;
  return { valid, invalid };
}

test('RDKit validity is a graph property: coordinates and parity never change it', async () => {
  const { valid, invalid } = await fixtureProducts();
  const random = prng(11);
  for (const product of [valid, invalid]) {
    const expected = await productGraphOutcome(product);
    assert.equal(expected.ok, product === valid, JSON.stringify(expected));
    for (let trial = 0; trial < 12; trial++) {
      const moved = structuredClone(product);
      const axis = unit([random() - 0.5, random() - 0.5, random() - 0.5]),
        turn = random() * 2 * Math.PI,
        shift = [0, 1, 2].map(() => (random() - 0.5) * 200),
        jitter = trial % 3 ? 0.4 : 0; // also distorted, not just rigid moves
      for (const a of moved.atoms) {
        a.xyz = add(rotateAround(a.xyz, axis, turn), shift).map(
          (v) => v + (random() - 0.5) * jitter,
        );
        a.parity = Math.floor(random() * 4);
      }
      moved.chiral = trial % 2;
      assert.deepEqual(await productGraphOutcome(moved), expected);
    }
  }
});

test('linker graph key follows the actual graph, not coordinates, parity or identifiers', async () => {
  const text = await fixture('linker');
  const base = parseSdf(text)[0];
  const key = linkerGraphKey(base);
  assert.match(key, /^[A-Za-z0-9_-]{43}$/);
  const moved = structuredClone(base);
  moved.title = 'another linker id';
  moved.atoms.forEach((a, i) => {
    a.xyz = a.xyz.map((v) => v + 0.3 * Math.sin(i + v));
    a.parity = (i % 3) + 1;
  });
  assert.equal(linkerGraphKey(moved), key);
  const variants = [
    (m) => { m.atoms[8].charge = 0; },
    (m) => { m.atoms[2].isotope = 13; },
    (m) => { m.bonds[5].order = m.bonds[5].order === 1 ? 2 : 1; },
    (m) => { m.atoms[3].element = 'N'; },
    (m) => { m.chiral = 0; },
    (m) => { m.atoms[4].tail = `${m.atoms[4].tail.slice(0, 11)}  1${m.atoms[4].tail.slice(14)}`; },
    (m) => { m.bonds[0].tail = '  1  0  0  0'; },
  ];
  const keys = new Set([key]);
  for (const change of variants) {
    const m = parseSdf(text)[0];
    change(m);
    keys.add(linkerGraphKey(m));
  }
  assert.equal(keys.size, variants.length + 1);
});

// Linker descriptors with the same graph as the fixtures but other coordinates
// (jittered "conformers"), plus a charge-neutralized graph that fails RDKit.
function linkerFamily(text, random, copies) {
  const base = parseSdf(text)[0];
  const out = [linkerDescriptor(text)];
  for (let c = 0; c < copies; c++) {
    const m = structuredClone(base);
    for (const a of m.atoms) a.xyz = a.xyz.map((v) => Number((v + (random() - 0.5) * 0.08).toFixed(4)));
    out.push(linkerDescriptor(writeSdf(m)));
  }
  return out.filter((d) => d.ok);
}

// A random two-fragment query built around one real linker pair: C/N/O/S
// centres near the pair's anchors (jittered), one to three methyl
// substituents, sometimes an explicit H to replace, then a random rigid move.
function fuzzQuery(random, descriptor, pair) {
  const pick = (list) => list[Math.floor(random() * list.length)];
  const sites = [pair.a, pair.b].map((a) => descriptor.sites.find((s) => s.atom === a));
  const axis = unit([random() - 0.5, random() - 0.5, random() - 0.5]),
    turn = random() * 2 * Math.PI,
    shift = [0, 1, 2].map(() => (random() - 0.5) * 20);
  const move = (xyz) => add(rotateAround(xyz, axis, turn), shift);
  const records = [],
    attachments = [];
  for (const s of sites) {
    const element = pick(['C', 'C', 'C', 'N', 'N', 'O', 'S']);
    const length = connectionLength(element, descriptor.molecule.atoms[s.neighbor].element);
    if (length === null) return null;
    const spread = pick([0.05, 0.3, 0.6]);
    const center = at(s.neighborPosition, s.direction, length).map((v) => v + (random() - 0.5) * spread);
    const toward = unit(scale(s.direction, -1).map((v) => v + (random() - 0.5) * spread));
    const t = tetrahedron(toward, random() * 3);
    const count = element === 'O' || element === 'S' ? 1 : element === 'N' ? pick([1, 2]) : pick([1, 2, 3]);
    const atoms = [atom(element, center)],
      bonds = [];
    for (let k = 0; k < count; k++) {
      atoms.push(atom('C', at(center, t[k], 1.5)));
      bonds.push([1, atoms.length]);
    }
    let selection = 1;
    if (element === 'C' && count < 3 && random() < 0.35) {
      atoms.push(atom('H', at(center, toward, 1.09)));
      bonds.push([1, atoms.length]);
      selection = { atom: 1, hydrogenAtom: atoms.length };
    }
    for (const a of atoms) a.xyz = move(a.xyz);
    records.push(record(atoms, bonds));
    attachments.push(selection);
  }
  return { sdf: records.join(''), attachments };
}

test('fuzz: fast fit equals the reference; deferral and cache hits never change acceptance', { timeout: 600_000 }, async () => {
  const random = prng(2026);
  const neutral = parseSdf(await fixture('linker'))[0];
  neutral.atoms[8].charge = 0;
  const families = [
    linkerFamily(await fixture('linker'), random, 3),
    linkerFamily(await fixture('multi-port'), random, 3),
    linkerFamily(writeSdf(neutral), random, 1),
  ];
  resetTopologyCache();
  const tally = { cases: 0, accepted: 0, deferred: 0, tie: 0, invalidChemistry: 0, hits: 0, misses: 0 };
  const reset = () => {
    const { hits, misses } = topologyCacheStats();
    tally.hits += hits;
    tally.misses += misses;
    resetTopologyCache();
  };
  for (let trial = 0; trial < 48; trial++) {
    const family = families[trial % families.length];
    const pair = family[0].pairs[Math.floor(random() * family[0].pairs.length)];
    const built = fuzzQuery(random, family[0], pair);
    if (!built) continue;
    const prepared = await prepareQuery(built.sdf, built.attachments);
    if (!prepared.ok) continue;
    const options = {
      pair: random() < 0.8 ? [pair.a, pair.b] : undefined,
      maxRmsd: 0.5 + random(),
      clashScale: 0.45 + random() * 0.15,
      minAttachmentAngle: 75 + random() * 15,
      torsionStepDegrees: [10, 10, 15, 7, 30][Math.floor(random() * 5)],
    };
    if (!options.pair) delete options.pair;
    // Every conformer of the family: equal graphs share topology keys.
    for (const descriptor of family) {
      const reference = await fitAndJoinReference(prepared, descriptor, options);
      const fast = await fitAndJoin(prepared, descriptor, options);
      tally.cases++;
      assert.equal(fast.ok, reference.ok, JSON.stringify([fast.errors, reference.errors]));
      if (reference.ok) {
        tally.accepted++;
        assert.deepEqual(fast, reference);
      } else if (reference.errors.some((e) => e.code === 'INVALID_CHEMISTRY')) tally.invalidChemistry++;
      // Every threshold: strictly worse -> deferred summary; otherwise (ties
      // included) the full reference result. Hit and miss paths agree.
      const thresholds = [0, Infinity, random() * 1.5];
      if (reference.ok) thresholds.push(reference.rmsd, reference.rmsd - 1e-9, reference.rmsd + 1e-9);
      for (const deferAbove of thresholds) {
        const cached = await fitAndJoin(prepared, descriptor, { ...options, deferAbove });
        reset();
        const miss = await fitAndJoin(prepared, descriptor, { ...options, deferAbove });
        const hit = await fitAndJoin(prepared, descriptor, { ...options, deferAbove });
        assert.deepEqual(miss, cached);
        assert.deepEqual(hit, miss);
        assert.equal(miss.ok, reference.ok);
        if (!reference.ok) continue;
        if (reference.rmsd > deferAbove) {
          tally.deferred++;
          assert.deepEqual(miss, {
            ok: true,
            deferred: true,
            rmsd: reference.rmsd,
            anchorRmsd: reference.rmsd,
            selectedLabels: reference.selectedLabels,
          });
        } else {
          if (deferAbove === reference.rmsd) tally.tie++;
          assert.deepEqual(miss, reference);
        }
      }
    }
  }
  reset();
  assert.ok(
    tally.accepted >= 20 && tally.deferred >= 20 && tally.tie >= 10 && tally.invalidChemistry >= 1 &&
      tally.hits >= 20 && tally.misses >= 20 && tally.cases - tally.accepted >= 10,
    JSON.stringify(tally),
  );
});

test('cache hit path equals miss path, including cached refusals and 3D stereo SMILES', async () => {
  const prepared = await prepareQuery(await fixture('query'), [1, 1]);
  const text = await fixture('linker');
  const base = linkerDescriptor(text);
  resetTopologyCache();
  const miss = await fitAndJoin(prepared, base, { deferAbove: 0 });
  assert.deepEqual(topologyCacheStats(), { size: 1, limit: TOPOLOGY_CACHE_LIMIT, hits: 0, misses: 1 });
  // A fresh parse of the same record (another "conformer" object) hits.
  const hit = await fitAndJoin(prepared, linkerDescriptor(text), { deferAbove: 0 });
  assert.equal(topologyCacheStats().hits, 1);
  assert.deepEqual(hit, miss);
  assert.equal(hit.deferred, true);
  // Materialized fits compute stereo SMILES from their own 3D coordinates
  // (the cache holds only a graph-level ok/refusal). Mirroring query and
  // linker gives the enantiomeric product; with the unmirrored query the
  // mirror-image conformer (same linker graph key) is materialized from its
  // own coordinates on the cache miss and again on the hit.
  const mirror = parseSdf(text)[0];
  for (const a of mirror.atoms) a.xyz = [-a.xyz[0], a.xyz[1], a.xyz[2]];
  const mirrorText = writeSdf(mirror);
  assert.equal(linkerGraphKey(mirror), linkerGraphKey(base.molecule));
  const mirrorQuery = parseSdf(await fixture('query'));
  for (const f of mirrorQuery) for (const a of f.atoms) a.xyz = [-a.xyz[0], a.xyz[1], a.xyz[2]];
  const mirrored = await prepareQuery(mirrorQuery.map((f) => writeSdf(f)).join(''), [1, 1]);
  const direct = await fitAndJoin(prepared, base);
  const enantiomer = await fitAndJoin(mirrored, linkerDescriptor(mirrorText));
  assert.deepEqual(enantiomer, await fitAndJoinReference(mirrored, mirrorText));
  assert.equal(enantiomer.ok, true);
  assert.notEqual(enantiomer.smiles, direct.smiles);
  assert.equal(enantiomer.smiles.replaceAll('@', ''), direct.smiles.replaceAll('@', ''));
  const mirrorReference = await fitAndJoinReference(prepared, mirrorText);
  assert.equal(mirrorReference.ok, true);
  const before = topologyCacheStats().hits;
  for (let i = 0; i < 2; i++)
    assert.deepEqual(await fitAndJoin(prepared, linkerDescriptor(mirrorText)), mirrorReference);
  assert.ok(topologyCacheStats().hits > before);
  // An RDKit-invalid linker graph is refused by its cached skeleton outcome
  // for every conformer object, exactly as the reference reports it.
  const broken = parseSdf(text)[0];
  broken.atoms[8].charge = 0;
  const brokenText = writeSdf(broken);
  const expected = await fitAndJoinReference(prepared, brokenText);
  assert.deepEqual(expected.errors, [
    { code: 'INVALID_CHEMISTRY', message: 'Invalid valence or unsupported molecular structure.' },
  ]);
  for (const deferAbove of [0, 0, Infinity, 0]) {
    const refused = await fitAndJoin(prepared, linkerDescriptor(brokenText), { deferAbove });
    assert.deepEqual(refused, expected);
    assert.deepEqual(await fitAndJoinReference(prepared, linkerDescriptor(brokenText)), expected);
  }
});

test('topology cache stays within its LRU bound and recomputes evicted outcomes', async () => {
  const q = await fixture('query');
  const text = await fixture('linker');
  const descriptor = linkerDescriptor(text);
  resetTopologyCache({ limit: 3 });
  try {
    // Each prepared query is a distinct fragment graph, so each fit is a new key.
    const queries = [];
    for (let i = 0; i < 6; i++) queries.push(await prepareQuery(q, [1, 1]));
    const first = [];
    for (const prepared of queries) {
      first.push(await fitAndJoin(prepared, descriptor, { deferAbove: 0 }));
      assert.ok(topologyCacheStats().size <= 3);
    }
    assert.deepEqual(topologyCacheStats(), { size: 3, limit: 3, hits: 0, misses: 6 });
    // The three most recent keys hit; the evicted first query misses again.
    await fitAndJoin(queries[5], descriptor, { deferAbove: 0 });
    assert.equal(topologyCacheStats().hits, 1);
    const again = await fitAndJoin(queries[0], descriptor, { deferAbove: 0 });
    assert.equal(topologyCacheStats().misses, 7);
    assert.deepEqual(again, first[0]);
    assert.equal(topologyCacheStats().size, 3);
  } finally {
    resetTopologyCache();
  }
});

test('threshold encoding: deferral never drops a placement that ends in the final top-K', () => {
  // Encoded threshold decodes strictly above the K-th rmsd (ties materialize).
  const random = prng(99);
  for (let i = 0; i < 20000; i++) {
    const rmsd = i % 5 ? random() * 2 : Math.floor(random() * 2e9) / 1e9;
    assert.ok(deferAboveOf(encodeThreshold(rmsd)) > rmsd);
  }
  assert.equal(deferAboveOf(NO_THRESHOLD), Infinity);
  assert.equal(deferAboveOf(encodeThreshold(5)), Infinity);
  // Simulated scans: several workers read stale thresholds, fits are merged
  // later in arbitrary order. The final top-K equals the no-deferral scan and
  // an offline sort, and no deferred placement belongs to it.
  for (let scan = 0; scan < 60; scan++) {
    const limit = 1 + Math.floor(random() * 8),
      grid = [0.1, 0.2, 0.2000000001, 0.25, 0.3];
    const placements = Array.from({ length: 400 }, (_, i) => ({
      smiles: `P${Math.floor(random() * (scan % 3 ? 30 : 5))}`,
      rmsd: random() < 0.5 ? grid[Math.floor(random() * grid.length)] : random() * 0.75,
      ratio: random() < 0.1 ? null : [0.6, 0.7, Math.random()][Math.floor(random() * 3)],
      conformerId: 1 + i,
      pair: [1 + Math.floor(random() * 3), 5],
      conformers: 1,
      detail: {},
    }));
    const baseline = new TopProducts(limit);
    for (const p of placements) baseline.offer(p);
    const top = new TopProducts(limit),
      published = [NO_THRESHOLD],
      pending = [],
      deferred = [];
    const publish = () =>
      published.push(top.size >= limit ? encodeThreshold(top.worst().rmsd) : NO_THRESHOLD);
    for (const p of placements) {
      // Read a threshold at most 5 publications old; merge a random backlog.
      const raw = published[Math.max(0, published.length - 1 - Math.floor(random() * 6))];
      if (p.rmsd > deferAboveOf(raw)) deferred.push(p);
      else pending.push(p);
      while (pending.length && random() < 0.4) {
        top.offer(pending.splice(Math.floor(random() * pending.length), 1)[0]);
        publish();
      }
    }
    for (const p of pending) top.offer(p);
    const offline = [...new Map(
      [...placements].sort(comparePlacements).reverse().map((p) => [p.smiles, p]),
    ).values()]
      .sort(comparePlacements)
      .slice(0, limit)
      .map((p) => `${p.conformerId}`);
    const ids = (t) => t.entries.map((e) => `${e.conformerId}`);
    assert.deepEqual(ids(top), ids(baseline));
    assert.deepEqual(ids(top), offline);
    const kept = new Set(ids(top));
    assert.ok(deferred.every((p) => !kept.has(`${p.conformerId}`)));
  }
});
