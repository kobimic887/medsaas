import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'bun:test';
import { refineProduct, refinementStatus } from './refine.mjs';
// Real Python RDKit refinement runs only where LINK_FRAGMENTS_PYTHON (default /usr/bin/python3)
// imports RDKit, i.e. the scientific host. Elsewhere those tests are reported as skipped.
const fixture = (name) => readFile(new URL(`fixtures/${name}`, import.meta.url), 'utf8');
const [product, boronic, pocket, ligand] = await Promise.all(['refine-product.sdf', 'refine-boronic.sdf', 'receptor-7WH5-pocket.pdb', 'receptor-7WH5-ligand.pdb'].map(fixture));
const status = await refinementStatus();
const real = status.available;
if (!real) console.warn(`SKIP: Python RDKit refinement tests skipped (${status.reason}). Run on the scientific host with Python RDKit.`);
const rdkitTest = (name, fn, timeout = 120_000) => test.skipIf(!real)(name, fn, timeout);

const atomLines = (sdf) => {
  const lines = sdf.replaceAll('\r', '').split('\n'), count = Number(lines[3].slice(0, 3));
  return lines.slice(4, 4 + count);
};
const atoms = (sdf) => atomLines(sdf).map((line, i) => ({ number: i + 1, element: line.slice(31, 34).trim(), xyz: [0, 10, 20].map((p) => Number(line.slice(p, p + 10))) }));
const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const FRAGMENT_ATOMS = 29;
const heavyFixed = (sdf, count) => atoms(sdf).slice(0, count).filter((a) => a.element !== 'H').map((a) => a.number);
const reference = { sdf: product, fragmentAtomCount: FRAGMENT_ATOMS, fixedAtoms: heavyFixed(product, FRAGMENT_ATOMS) };
const boronicInput = { sdf: boronic, fragmentAtomCount: 6, fixedAtoms: [1, 2, 3, 4, 5, 6] };
const timed = async (label, input) => {
  const started = performance.now(), result = await refineProduct(input);
  console.log(`${label}: ${((performance.now() - started) / 1000).toFixed(2)} s`);
  return result;
};
const pdbAtom = (serial, name, residue, chain, number, [x, y, z], element) =>
  `ATOM  ${String(serial).padStart(5)} ${name.padEnd(4)} ${residue.padStart(3)} ${chain}${String(number).padStart(4)}    ${x.toFixed(3).padStart(8)}${y.toFixed(3).padStart(8)}${z.toFixed(3).padStart(8)}  1.00 20.00          ${element.padStart(2)}`;
const translate = (pdb, dx) => pdb.split('\n').map((line) => /^(ATOM {2}|HETATM)/.test(line) ? line.slice(0, 30) + (Number(line.slice(30, 38)) + dx).toFixed(3).padStart(8) + line.slice(38) : line).join('\n');
const assertFixedExactly = (input, output, count) => {
  // Fixed uploaded atoms keep their exact written coordinates, numbering and elements.
  assert.deepEqual(atomLines(output).slice(0, count).map((l) => l.slice(0, 34)), atomLines(input).slice(0, count).map((l) => l.slice(0, 34)));
};

test('refinement input is validated before Python starts', async () => {
  for (const [input, code] of [
    [{}, 'INVALID_REFINEMENT_INPUT'],
    [{ ...reference, fixedAtoms: [] }, 'INVALID_REFINEMENT_INPUT'],
    [{ ...reference, fixedAtoms: [1.5] }, 'INVALID_REFINEMENT_INPUT'],
    [{ ...reference, fragmentAtomCount: 0 }, 'INVALID_REFINEMENT_INPUT'],
    [{ ...reference, forceField: 'GAFF' }, 'INVALID_REFINEMENT_INPUT'],
    [{ ...reference, maxIterations: 5 }, 'INVALID_REFINEMENT_INPUT'],
    [{ ...reference, receptorPdb: 42 }, 'INVALID_REFINEMENT_INPUT'],
    [{ ...reference, receptorPdb: 'A'.repeat(5 * 1024 * 1024 + 1) }, 'RECEPTOR_TOO_LARGE'],
  ]) {
    const result = await refineProduct(input);
    assert.equal(result.ok, false);
    assert.equal(result.errors[0].code, code);
  }
});

test('a missing interpreter reports refinement as unavailable, never as a result', async () => {
  const previous = process.env.LINK_FRAGMENTS_PYTHON;
  process.env.LINK_FRAGMENTS_PYTHON = '/nonexistent/pyxis-python3';
  try {
    const probe = await refinementStatus({ refresh: true });
    assert.equal(probe.available, false);
    assert.match(probe.reason, /not available/);
    const result = await refineProduct(reference);
    assert.equal(result.errors[0].code, 'REFINEMENT_UNAVAILABLE');
  } finally {
    if (previous === undefined) delete process.env.LINK_FRAGMENTS_PYTHON;
    else process.env.LINK_FRAGMENTS_PYTHON = previous;
  }
});

// Needs no RDKit: a fake interpreter answers the probe, then sleeps like a stuck refinement.
test('an aborted request kills the Python child and frees the slot; the timeout also kills it', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'pyxis-refine-abort-'));
  const pidFile = path.join(directory, 'child.pid');
  const fake = path.join(directory, 'fake-python');
  await writeFile(fake, `#!/bin/sh\nif [ "$2" = "--status" ]; then echo '{"available":true,"rdkitVersion":"fake"}'; exit 0; fi\necho $$ > '${pidFile}'\nexec sleep 30\n`);
  await chmod(fake, 0o755);
  const previous = process.env.LINK_FRAGMENTS_PYTHON;
  process.env.LINK_FRAGMENTS_PYTHON = fake;
  const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
  try {
    assert.equal((await refinementStatus({ refresh: true })).available, true);
    const preAborted = new AbortController();
    preAborted.abort();
    assert.equal((await refineProduct({ ...reference, signal: preAborted.signal })).errors[0].code, 'REFINEMENT_ABORTED');

    const controller = new AbortController();
    const started = performance.now();
    const running = refineProduct({ ...reference, timeoutMs: 60_000, signal: controller.signal });
    let pid = 0;
    for (let tries = 0; !pid; tries++) {
      assert.ok(tries < 200, 'fake interpreter never started');
      pid = Number(await readFile(pidFile, 'utf8').catch(() => '0')) || 0;
      if (!pid) await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.ok(alive(pid));
    assert.equal((await refineProduct(reference)).errors[0].code, 'REFINEMENT_BUSY');
    controller.abort();
    const result = await running;
    assert.equal(result.errors[0].code, 'REFINEMENT_ABORTED');
    assert.ok(performance.now() - started < 10_000);
    assert.equal(alive(pid), false, 'the child was killed');
    // The slot is free again: the next run is not BUSY, and its own timeout kills it.
    await rm(pidFile, { force: true });
    const timedOut = await refineProduct({ ...reference, timeoutMs: 300 });
    assert.equal(timedOut.errors[0].code, 'REFINEMENT_TIMEOUT');
    const second = Number(await readFile(pidFile, 'utf8'));
    assert.equal(alive(second), false);
  } finally {
    if (previous === undefined) delete process.env.LINK_FRAGMENTS_PYTHON;
    else process.env.LINK_FRAGMENTS_PYTHON = previous;
    await rm(directory, { recursive: true, force: true });
  }
});

rdkitTest('MMFF94 refines the reference product with uploaded atoms fixed and stereo preserved', async () => {
  const result = await timed('MMFF94 reference product', { ...reference, forceField: 'MMFF94' });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(result.forceField, 'MMFF94');
  assert.equal(result.requestedForceField, 'MMFF94');
  assert.equal(result.fallbackReason, null);
  assert.equal(result.energyUnits, 'kcal/mol');
  assert.equal(typeof result.converged, 'boolean');
  console.log(`MMFF94 converged=${result.converged} iterations<=${result.iterations} energy ${result.initialEnergy} -> ${result.finalEnergy} kcal/mol; moved RMSD ${result.moved.rmsd} A`);
  assert.ok(result.finalEnergy < result.initialEnergy);
  assert.equal(result.fixedAtoms.count, FRAGMENT_ATOMS);
  assert.equal(result.fixedAtoms.heavy, reference.fixedAtoms.length);
  assert.ok(result.fixedAtoms.maxDeviation < 1e-4);
  assert.ok(result.moved.atoms > 0 && result.moved.maxDisplacement > 0);
  assert.equal(result.stereo.preserved, true);
  assert.deepEqual(result.stereo.after, result.stereo.before);
  assert.ok(result.stereo.before.atoms.length >= 2);
  assert.equal(result.receptor, null);
  assert.equal(result.restraintEnergy, null);
  assert.deepEqual(result.unsupported, []);
  assert.equal(atomLines(result.sdf).length, atomLines(product).length + result.addedHydrogens);
  assertFixedExactly(product, result.sdf, FRAGMENT_ATOMS);
  assert.match(result.sdf, /> <PYXIS_REFINEMENT_FORCE_FIELD>\nMMFF94\n/);
  assert.match(result.sdf, new RegExp(`> <PYXIS_REFINEMENT_CONVERGED>\\n${result.converged}\\n`));
  assert.match(result.sdf, /> <PYXIS_REFINEMENT_ENERGY_KCAL_MOL>\n-?\d+\.\d{4}\n/);
  assert.ok(result.sdf.trimEnd().endsWith('$$$$'));
  assert.ok(result.limitations.some((l) => /not binding affinities/.test(l)));
  assert.ok(result.limitations.some((l) => /Not equivalent to MOE/.test(l)));
});

rdkitTest('explicit UFF is honored and auto uses MMFF94 when it is parameterized', async () => {
  const uff = await timed('UFF reference product', { ...reference, forceField: 'UFF' });
  assert.equal(uff.ok, true);
  assert.equal(uff.forceField, 'UFF');
  assert.equal(uff.fallbackReason, null);
  assert.ok(uff.finalEnergy < uff.initialEnergy);
  assert.ok(uff.fixedAtoms.maxDeviation < 1e-4);
  const auto = await refineProduct(reference);
  assert.equal(auto.forceField, 'MMFF94');
  assert.equal(auto.requestedForceField, 'auto');
});

rdkitTest('auto falls back to UFF for boron, which MMFF94 cannot type; explicit MMFF94 is refused', async () => {
  const auto = await timed('auto (UFF fallback) phenylboronic acid', boronicInput);
  assert.equal(auto.ok, true, JSON.stringify(auto.errors));
  assert.equal(auto.forceField, 'UFF');
  assert.match(auto.fallbackReason, /MMFF94 has no parameters for B/);
  assert.deepEqual(auto.unsupported[0].elements, ['B']);
  assert.deepEqual(auto.unsupported[0].atoms, [7]);
  assert.ok(auto.fixedAtoms.maxDeviation < 1e-4);
  const refused = await refineProduct({ ...boronicInput, forceField: 'MMFF94' });
  assert.equal(refused.ok, false);
  assert.equal(refused.errors[0].code, 'REFINEMENT_UNSUPPORTED');
  assert.deepEqual(refused.errors[0].details.unsupported[0].atoms, [7]);
});

rdkitTest('ligand-free 7WH5 pocket in the uploaded frame: clashes reported before and after', async () => {
  const result = await timed('MMFF94 with 7WH5 pocket', { ...reference, receptorPdb: pocket });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  const receptor = result.receptor;
  console.log(`pocket: ${receptor.atomsUsed} excluded-volume atoms, ${receptor.restraints} restraints, clashes ${receptor.clashesBefore} -> ${receptor.clashesAfter}, min heavy distance ${receptor.minHeavyDistanceBefore} -> ${receptor.minHeavyDistanceAfter} A, restraint energy ${result.restraintEnergy}`);
  assert.equal(receptor.atomsRead, pocket.split('\n').filter((l) => /^(ATOM {2}|HETATM)/.test(l)).length);
  assert.ok(receptor.atomsUsed > 0 && receptor.atomsUsed <= receptor.heavyAtoms);
  assert.ok(receptor.restraints > 0);
  assert.deepEqual(receptor.hetGroups, []);
  assert.equal(receptor.watersRemoved, 0);
  assert.ok(Number.isInteger(receptor.clashesBefore) && Number.isInteger(receptor.clashesAfter));
  assert.ok(receptor.clashesAfter <= receptor.clashesBefore);
  assert.ok(receptor.minHeavyDistanceBefore > 1.2 && receptor.minHeavyDistanceAfter > 1.2);
  assert.match(receptor.clashDefinition, /0\.6/);
  assert.equal(typeof result.restraintEnergy, 'number');
  assert.ok(result.fixedAtoms.maxDeviation < 1e-4);
  assert.equal(result.stereo.preserved, true);
  assertFixedExactly(product, result.sdf, FRAGMENT_ATOMS);
  assert.ok(result.limitations.some((l) => /rigid excluded volume/.test(l)));
});

rdkitTest('excluded volume pushes an overlapping linker atom out of the receptor', async () => {
  const all = atoms(product), fixed = all.slice(0, FRAGMENT_ATOMS).filter((a) => a.element !== 'H');
  // A linker heavy atom well away from the fixed fragments, so it is free to move.
  const target = all.slice(FRAGMENT_ATOMS).filter((a) => a.element === 'C').map((a) => ({ ...a, room: Math.min(...fixed.map((f) => distance(f.xyz, a.xyz))) })).sort((a, b) => b.room - a.room)[0];
  const neighbors = all.filter((a) => a !== target && distance(a.xyz, target.xyz) < 1.7).map((a) => a.xyz);
  const away = [0, 1, 2].map((k) => target.xyz[k] - neighbors.reduce((s, n) => s + n[k], 0) / neighbors.length);
  const norm = Math.hypot(...away), probe = target.xyz.map((v, k) => v + (1.6 * away[k]) / norm);
  const receptorPdb = `${pdbAtom(1, 'CB', 'ALA', 'Z', 999, probe, 'C')}\nEND\n`;
  const pushed = await timed('MMFF94 with one overlapping probe atom', { ...reference, receptorPdb });
  const free = await refineProduct(reference);
  assert.equal(pushed.ok, true, JSON.stringify(pushed.errors));
  const after = (result) => distance(atoms(result.sdf)[target.number - 1].xyz, probe);
  console.log(`probe atom ${target.number}: start 1.600 A, unrestrained ${after(free).toFixed(3)} A, restrained ${after(pushed).toFixed(3)} A; clashes ${pushed.receptor.clashesBefore} -> ${pushed.receptor.clashesAfter}`);
  assert.ok(pushed.receptor.clashesBefore >= 1);
  assert.ok(pushed.receptor.clashes.before.some((c) => c.productAtom === target.number && !c.fixed));
  assert.ok(after(free) < 1.7 + 1.7 - 0.6, 'without the receptor the atom stays in the clashing region');
  assert.ok(after(pushed) > 1.7 + 1.7 - 0.6, 'the restraint moves the atom beyond the clash cutoff');
  assert.ok(after(pushed) - after(free) > 0.3);
  assert.equal(pushed.receptor.clashesAfter, 0);
  assert.ok(pushed.restraintEnergyInitial > pushed.restraintEnergy);
  assert.ok(pushed.fixedAtoms.maxDeviation < 1e-4);
});

rdkitTest('bound ligand left in the receptor is refused as an overlap', async () => {
  const result = await refineProduct({ ...reference, receptorPdb: pocket + ligand });
  assert.equal(result.ok, false);
  assert.equal(result.errors[0].code, 'RECEPTOR_OVERLAP');
  assert.ok(result.errors[0].details.minDistance < 0.01);
  assert.match(result.errors[0].details.examples[0].receptorAtom, /9DF/);
});

rdkitTest('a receptor outside the uploaded frame is refused', async () => {
  const result = await refineProduct({ ...reference, receptorPdb: translate(pocket, 60) });
  assert.equal(result.ok, false);
  assert.equal(result.errors[0].code, 'RECEPTOR_FRAME');
  assert.ok(result.errors[0].details.minHeavyDistance > 8);
});

rdkitTest('malformed products and receptors are refused with specific codes', async () => {
  const water = `${pdbAtom(1, 'O', 'HOH', 'W', 1, [0, 0, 0], 'O').replace(/^ATOM {2}/, 'HETATM')}\nEND\n`;
  for (const [input, code] of [
    [{ ...reference, sdf: 'not a molecule' }, 'INVALID_REFINEMENT_INPUT'],
    [{ ...reference, sdf: product.replace(/^( +\d+ +\d+ .*)V2000/m, '$1V3000') }, 'INVALID_REFINEMENT_INPUT'],
    [{ ...reference, fixedAtoms: [...reference.fixedAtoms, 40] }, 'INVALID_REFINEMENT_INPUT'],
    [{ ...reference, fragmentAtomCount: 500 }, 'INVALID_REFINEMENT_INPUT'],
    [{ ...reference, receptorPdb: 'hello\n' }, 'RECEPTOR_INVALID'],
    [{ ...reference, receptorPdb: water }, 'RECEPTOR_EMPTY'],
    [{ ...reference, receptorPdb: 'ATOM      1  CA  ALA A   1       x.xxx   0.000   0.000  1.00  0.00           C\n' }, 'RECEPTOR_INVALID'],
  ]) {
    const result = await refineProduct(input);
    assert.equal(result.ok, false, code);
    assert.equal(result.errors[0].code, code);
    assert.ok(!/Traceback|\.py/.test(result.errors[0].message));
  }
});

rdkitTest('timeouts kill the child and one refinement runs at a time', async () => {
  const slow = await refineProduct({ ...reference, timeoutMs: 1 });
  assert.equal(slow.errors[0].code, 'REFINEMENT_TIMEOUT');
  const [first, second] = await Promise.all([refineProduct(reference), refineProduct(reference)]);
  assert.equal(first.ok, true);
  assert.equal(second.errors[0].code, 'REFINEMENT_BUSY');
});
