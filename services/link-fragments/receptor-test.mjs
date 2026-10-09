import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { inspectReceptor, parseReceptor, scoreReceptor, compareReceptorScores, receptorPlacementWorse, RECEPTOR_LIMITS } from './receptor.mjs';
import { parseSdf, writeSdf } from './sdf.mjs';
import { prepareQuery, linkerDescriptor, fitAndJoin, fitAndJoinReference, resetTopologyCache } from './engine.mjs';
import { TopProducts, comparePlacements, createRetention, writeRetention, readRetention } from './jobs.mjs';
const fixture = (name) => readFile(new URL(`fixtures/${name}.sdf`, import.meta.url), 'utf8');
const pdb = (xyz, {element = 'C', residue = 'ALA', record = 'ATOM', serial = 1} = {}) => `${record.padEnd(6)}${String(serial).padStart(5)}  CA  ${residue.padStart(3)} A   1    ${xyz.map(v => v.toFixed(3).padStart(8)).join('')}  1.00 20.00          ${element.padStart(2)}  `;
test('receptor inspection catches incompatible frame, bound-ligand overlap, and bad inputs before a job', async () => {
  const query = parseSdf(await fixture('query'));
  const atom = query[0].atoms[0];
  assert.equal(inspectReceptor(pdb(atom.xyz), query).errors[0].code, 'RECEPTOR_FRAGMENT_OVERLAP');
  assert.equal(inspectReceptor(pdb([1000, 1000, 1000]), query).errors[0].code, 'RECEPTOR_FRAME');
  assert.equal(inspectReceptor('ATOM      1', query).errors[0].code, 'RECEPTOR_INVALID');
  assert.equal(inspectReceptor(pdb(atom.xyz, {element:'Xe'}), query).errors[0].code, 'RECEPTOR_UNSUPPORTED_ELEMENT');
  assert.equal(inspectReceptor('X'.repeat(RECEPTOR_LIMITS.bytes + 1), query).errors[0].code, 'RECEPTOR_TOO_LARGE');
  const huge = pdb([0,0,0]);
  assert.equal(inspectReceptor(huge.slice(0,30)+'  1e+300'+huge.slice(38),query).errors[0].code,'RECEPTOR_INVALID');
  const hugeQuery=structuredClone(query); hugeQuery[0].atoms[0].xyz[0]=1e300;
  assert.equal(inspectReceptor(pdb([0,0,0]),hugeQuery).errors[0].code,'RECEPTOR_INVALID_QUERY');
  const pocket = await readFile(new URL('fixtures/receptor-7WH5-pocket.pdb', import.meta.url), 'utf8');
  const valid = inspectReceptor(pocket, query);
  assert.equal(valid.ok, true, JSON.stringify(valid.errors));
  assert.equal(valid.report.screeningDuringSearch, true);
  assert.ok(valid.report.minFragmentDistance >= 1.2 && valid.report.minFragmentDistance <= 8);
  assert.deepEqual(scoreReceptor(structuredClone(valid.context), query.flatMap(m=>m.atoms)), valid.context.fixedScore);
});
test('PDB water/H removal, first model, HET reporting and coordinate validation are explicit', () => {
  const data = ['MODEL        1', pdb([0,0,0]), pdb([1,1,1], {residue:'HOH',record:'HETATM',serial:2}), pdb([2,2,2],{element:'H',serial:3}), pdb([3,3,3],{residue:'ZN',element:'Zn',record:'HETATM',serial:4}), 'ENDMDL', 'MODEL        2', pdb([99,99,99]), 'ENDMDL'].join('\n');
  const parsed = parseReceptor(data);
  assert.equal(parsed.atoms.length, 2);
  assert.equal(parsed.report.watersRemoved, 1);
  assert.equal(parsed.report.hydrogensRemoved, 1);
  assert.equal(parsed.report.hetGroups[0].residue, 'ZN');
  const blank = pdb([0,0,0]);
  assert.throws(()=>parseReceptor(blank.slice(0,30)+'        '+blank.slice(38)), /unreadable coordinates/);
});
test('spatial search clash scoring matches brute-force pairs, including hash boundaries', () => {
  const context = parseReceptor([[4.99,0,0],[5.01,0,0],[-5.01,0,0],[0,8,0]].map((v,i)=>pdb(v,{serial:i+1})).join('\n'));
  const atoms=[{element:'C',xyz:[5,0,0]},{element:'O',xyz:[-4,0,0]},{element:'H',xyz:[4.99,0,0]}];
  const scored=scoreReceptor(context,atoms);
  let clashes=0,severeClashes=0,overlapSquared=0,maxOverlap=0;
  for(const a of atoms.filter(a=>a.element!=='H'))for(const b of context.atoms){const overlap=(a.element==='C'?1.7:1.52)+b.radius-Math.hypot(...a.xyz.map((v,i)=>v-b.xyz[i]));maxOverlap=Math.max(maxOverlap,overlap);if(overlap>=.6){clashes++;overlapSquared+=overlap**2;}if(overlap>=1.2)severeClashes++;}
  assert.equal(scored.clashes,clashes);assert.equal(scored.severeClashes,severeClashes);assert.equal(scored.overlapSquared,overlapSquared);assert.equal(scored.maxOverlap,maxOverlap);
});
test('receptor-aware fit examines torsions rather than accepting the geometry-only best', async()=>{
  const prepared=await prepareQuery(await fixture('query'),[1,1]), linker=linkerDescriptor(await fixture('linker'));
  const original=await fitAndJoin(prepared,linker,{maxRmsd:.75});assert.equal(original.ok,true);
  const originalAtoms=parseSdf(original.sdf)[0].atoms, obstruction=originalAtoms[original.fragmentAtomCount].xyz;
  const inspected=inspectReceptor(pdb(obstruction),prepared.fragments);assert.equal(inspected.ok,true,JSON.stringify(inspected.errors));
  prepared.receptor=inspected.context;
  // An artificially tight RMSD retention threshold must not defer a receptor result.
  const fit=await fitAndJoin(prepared,linker,{maxRmsd:.75,deferAbove:0});
  const reference=await fitAndJoinReference(prepared,linker,{maxRmsd:.75});
  assert.equal(fit.ok,true);assert.equal(fit.deferred,undefined);assert.equal(reference.ok,true);
  assert.notEqual(fit.torsionDegrees,original.torsionDegrees);
  assert.ok(compareReceptorScores(fit.receptor,scoreReceptor(inspected.context,originalAtoms))<0);
  assert.equal(fit.receptor.severeClashes,0);
  assert.equal(fit.torsionDegrees,reference.torsionDegrees);
  assert.ok(Math.abs(fit.receptor.overlapSquared-reference.receptor.overlapSquared)<1e-8);
  assert.match(fit.sdf,/PYXIS_SEARCH_RECEPTOR_SHA256/);
});
test('retention can replace the top geometric hit with a later worse-RMSD receptor-compatible hit',()=>{
  const top=new TopProducts(1), entry=(id,rmsd,receptor)=>({smiles:`product${id}`,conformerId:id,pair:[1,2],rmsd,ratio:1,receptor,detail:{sdf:'example'}});
  top.offer(entry(1,.01,{severeClashes:1,overlapSquared:4,clashes:2}));
  // Represents a candidate arriving after geometry-only top-K was already filled.
  assert.equal(top.offer(entry(251,.6,{severeClashes:0,overlapSquared:0,clashes:0})),true);
  assert.equal(top.entries[0].conformerId,251);
});
// Receptor-score-aware deferral. The oracle is fitAndJoinReference (product built
// and receptor-scored for every candidate torsion). Without a retained key the
// fast fit must equal it exactly; with one, it must defer exactly when the
// reference winner is strictly behind the key, and otherwise equal it.
const prng = (seed) => () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 2 ** 32;
};
const keyOf = (fit) => ({ ...fit.receptor, rmsd: fit.rmsd });
// Rejections: the fast path stops at its first failing gate, so only the
// decision (and an RDKit refusal itself) must match, as in test.mjs's fuzz.
function same(fast, reference) {
  if (reference.ok) return assert.deepEqual(fast, reference);
  assert.equal(fast.ok, false);
  if (reference.errors.some((e) => e.code === 'INVALID_CHEMISTRY')) assert.deepEqual(fast.errors, reference.errors);
}
function retainedKeys(reference, random) {
  const keys = [{ severeClashes: 0, overlapSquared: 0, clashes: 0, rmsd: 0 }, { severeClashes: Infinity, overlapSquared: 0, clashes: 0, rmsd: 0 }];
  if (!reference.ok) return keys;
  const own = keyOf(reference);
  keys.push(own, { ...own }, { ...own, rmsd: own.rmsd + 1e-12 }, { ...own, rmsd: own.rmsd - 1e-12 });
  for (const field of ['severeClashes', 'overlapSquared', 'clashes']) {
    const step = field === 'overlapSquared' ? 1e-9 : 1;
    keys.push({ ...own, [field]: own[field] + step, rmsd: 0 }, { ...own, [field]: own[field] - step, rmsd: 2 });
  }
  keys.push({ ...own, overlapSquared: own.overlapSquared * random(), rmsd: random() });
  return keys;
}
test('receptor deferral equals the exhaustive reference: ties, zero clashes, receptor positions, invalid chemistry', { timeout: 600_000 }, async () => {
  const random = prng(7);
  const prepared = await prepareQuery(await fixture('query'), [1, 1]);
  const text = await fixture('linker'), multi = await fixture('multi-port');
  const jitter = (source, amount) => {
    const m = parseSdf(source)[0];
    for (const a of m.atoms) a.xyz = a.xyz.map((v) => Number((v + (random() - 0.5) * amount).toFixed(4)));
    return writeSdf(m);
  };
  const broken = parseSdf(text)[0]; broken.atoms[8].charge = 0;
  const linkers = [text, multi, writeSdf(broken), ...Array.from({ length: 4 }, () => jitter(text, 0.12)), ...Array.from({ length: 2 }, () => jitter(multi, 0.12))].map(linkerDescriptor).filter((d) => d.ok);
  const original = await fitAndJoinReference(prepared, linkerDescriptor(text), { maxRmsd: .75 });
  const placed = parseSdf(original.sdf)[0].atoms;
  // Receptor positions: the real 7WH5 pocket, single atoms on several linker
  // atoms of the geometry-only pose (clashes vary by torsion), and one distant
  // atom inside the frame window (every pose scores zero: rmsd decides).
  const fragmentHeavy = prepared.fragments.flatMap((m) => m.atoms).filter((a) => a.element !== 'H');
  const far = fragmentHeavy[0].xyz.map((v, k) => v + (k === 0 ? 7.5 : 0));
  const positions = [
    await readFile(new URL('fixtures/receptor-7WH5-pocket.pdb', import.meta.url), 'utf8'),
    ...[0, 2, 5, 9].map((k) => pdb(placed[original.fragmentAtomCount + k].xyz)),
    [placed[original.fragmentAtomCount + 1].xyz, placed[original.fragmentAtomCount + 6].xyz].map((xyz, i) => pdb(xyz, { serial: i + 1 })).join('\n'),
    pdb(far),
  ];
  const tally = { cases: 0, materialized: 0, deferred: 0, ties: 0, zeroClash: 0, severe: 0, invalid: 0, receptors: 0 };
  resetTopologyCache();
  for (const receptorPdb of positions) {
    const inspected = inspectReceptor(receptorPdb, prepared.fragments);
    if (!inspected.ok) continue;
    tally.receptors++;
    const withReceptor = { ...prepared, receptor: inspected.context };
    for (const descriptor of linkers) for (const pair of descriptor.pairs) {
      const options = { maxRmsd: .75, pair: [pair.a, pair.b] };
      const reference = await fitAndJoinReference(withReceptor, descriptor, options);
      tally.cases++;
      // No key and a geometry-only deferAbove are both ignored in receptor mode.
      same(await fitAndJoin(withReceptor, descriptor, options), reference);
      same(await fitAndJoin(withReceptor, descriptor, { ...options, deferAbove: 0 }), reference);
      if (!reference.ok) { if (reference.errors.some((e) => e.code === 'INVALID_CHEMISTRY')) tally.invalid++; }
      else if (reference.receptor.clashes === 0) tally.zeroClash++;
      else if (reference.receptor.severeClashes) tally.severe++;
      for (const retained of retainedKeys(reference, random)) {
        // Cache miss, then hit: identical outcomes.
        resetTopologyCache();
        const miss = await fitAndJoin(withReceptor, descriptor, { ...options, retained });
        const hit = await fitAndJoin(withReceptor, descriptor, { ...options, retained });
        assert.deepEqual(hit, miss);
        if (!reference.ok) { same(miss, reference); continue; }
        const own = keyOf(reference);
        const worse = compareReceptorScores(reference.receptor, retained) > 0 ||
          (compareReceptorScores(reference.receptor, retained) === 0 && reference.rmsd > retained.rmsd);
        if (worse) {
          tally.deferred++;
          assert.deepEqual(miss, { ok: true, deferred: true, rmsd: reference.rmsd, anchorRmsd: reference.rmsd, selectedLabels: reference.selectedLabels, receptor: reference.receptor });
        } else {
          tally.materialized++;
          if (['severeClashes', 'overlapSquared', 'clashes', 'rmsd'].every((k) => retained[k] === own[k])) tally.ties++;
          assert.deepEqual(miss, reference);
        }
      }
    }
  }
  const bad = await fitAndJoin({ ...prepared, receptor: inspectReceptor(positions[0], prepared.fragments).context }, linkers[0], { retained: { severeClashes: 0, overlapSquared: NaN, clashes: 0, rmsd: 0 } });
  assert.equal(bad.errors[0].code, 'INVALID_SETTINGS');
  assert.ok(tally.receptors === positions.length && tally.deferred >= 40 && tally.materialized >= 40 && tally.ties >= 10 &&
    tally.zeroClash >= 2 && tally.severe >= 1 && tally.invalid >= 1, JSON.stringify(tally));
  console.log('receptor deferral equivalence', JSON.stringify(tally));
});
test('receptor retention: stale shared keys never defer a placement that ends in the final top-K', () => {
  const random = prng(2610);
  const pick = (list) => list[Math.floor(random() * list.length)];
  for (let scan = 0; scan < 80; scan++) {
    const limit = 1 + Math.floor(random() * 8);
    // Small grids force ties at every ranking field, including all-zero scores.
    const placements = Array.from({ length: 400 }, (_, i) => ({
      smiles: `P${Math.floor(random() * (scan % 3 ? 30 : 5))}`,
      receptor: random() < 0.4 ? { severeClashes: 0, overlapSquared: 0, clashes: 0 } : { severeClashes: pick([0, 0, 1, 2]), overlapSquared: pick([0.36, 0.5, 0.5, random()]), clashes: pick([1, 1, 2, 3]) },
      rmsd: random() < 0.5 ? pick([0.1, 0.2, 0.2000000001, 0.3]) : random() * 0.75,
      ratio: random() < 0.1 ? null : pick([0.6, 0.7, random()]),
      conformerId: 1 + i, pair: [1 + Math.floor(random() * 3), 5], conformers: 1, detail: {},
    }));
    const baseline = new TopProducts(limit);
    for (const p of placements) baseline.offer(p);
    const top = new TopProducts(limit), buffer = createRetention(), published = [readRetention(buffer)], pending = [], deferred = [];
    assert.equal(published[0], null);
    const publish = () => { writeRetention(buffer, top.size >= limit ? top.worst() : null); published.push(readRetention(buffer)); };
    for (const p of placements) {
      // A worker may read a key up to five publications old; merges arrive late and out of order.
      const retained = published[Math.max(0, published.length - 1 - Math.floor(random() * 6))];
      if (receptorPlacementWorse(p.receptor, p.rmsd, retained)) deferred.push(p); else pending.push(p);
      while (pending.length && random() < 0.4) { top.offer(pending.splice(Math.floor(random() * pending.length), 1)[0]); publish(); }
    }
    for (const p of pending) top.offer(p);
    const offline = [...new Map([...placements].sort(comparePlacements).reverse().map((p) => [p.smiles, p])).values()]
      .sort(comparePlacements).slice(0, limit).map((p) => p.conformerId);
    const ids = (t) => t.entries.map((e) => e.conformerId);
    assert.deepEqual(ids(top), ids(baseline));
    assert.deepEqual(ids(top), offline);
    const kept = new Set(ids(top));
    assert.ok(deferred.every((p) => !kept.has(p.conformerId)));
    if (scan === 0) assert.ok(deferred.length > 0, 'the simulation must exercise deferral');
  }
});
test('retention sequence lock never returns a torn key while another thread writes', { timeout: 60_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pyxis-retention-'));
  try {
    const writer = join(directory, 'writer.mjs');
    await writeFile(writer, `import { workerData } from 'node:worker_threads';
import { writeRetention } from ${JSON.stringify(new URL('./jobs.mjs', import.meta.url).href)};
const done = new Int32Array(workerData.done);
for (let i = 1; i <= 300000; i++) writeRetention(workerData.buffer, { receptor: { severeClashes: i, overlapSquared: i, clashes: i }, rmsd: i });
Atomics.store(done, 0, 1);`);
    const buffer = createRetention(), done = new Int32Array(new SharedArrayBuffer(4));
    const worker = new Worker(writer, { workerData: { buffer, done: done.buffer } });
    let last = 0, changes = 0;
    while (!Atomics.load(done, 0)) {
      const key = readRetention(buffer);
      if (!key) continue;
      assert.ok(key.overlapSquared === key.severeClashes && key.clashes === key.severeClashes && key.rmsd === key.severeClashes, JSON.stringify(key));
      assert.ok(key.severeClashes >= last);
      if (key.severeClashes !== last) changes++;
      last = key.severeClashes;
    }
    await worker.terminate();
    assert.equal(readRetention(buffer).rmsd, 300000);
    assert.ok(changes > 10, `reader observed only ${changes} concurrent updates`);
    writeRetention(buffer, null);
    assert.equal(readRetention(buffer), null);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
