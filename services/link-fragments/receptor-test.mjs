import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { inspectReceptor, parseReceptor, scoreReceptor, compareReceptorScores, RECEPTOR_LIMITS } from './receptor.mjs';
import { parseSdf } from './sdf.mjs';
import { prepareQuery, linkerDescriptor, fitAndJoin, fitAndJoinReference } from './engine.mjs';
import { TopProducts } from './jobs.mjs';
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
