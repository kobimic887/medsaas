import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import initRDKit from '../../server/node_modules/@rdkit/rdkit/dist/RDKit_minimal.js';
import { parseSdf, writeSdf, writeMolBlock } from './sdf.mjs';
import {
  prepareQuery,
  linkerDescriptor,
  fitAndJoin,
  attachmentGeometryError,
} from './engine.mjs';
import { cross, sub, dot, twoAnchorTransform, distance } from './geometry.mjs';
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
  assert.equal(
    (await prepareQuery(q, [2, 1])).errors[0].code,
    'ATTACHMENT_NO_IMPLICIT_H',
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
