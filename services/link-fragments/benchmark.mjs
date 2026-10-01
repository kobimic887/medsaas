// Reproducible reference comparisons. Exported MOE products alone do not
// establish matching search/refinement protocols or whole-library recall.
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import initRDKit from '../../server/node_modules/@rdkit/rdkit/dist/RDKit_minimal.js';
import { prepareQuery, linkerDescriptor, fitAndJoin } from './engine.mjs';
import { parseSdf } from './sdf.mjs';
import { inspectReceptor } from './receptor.mjs';

const digest = text => createHash('sha256').update(text).digest('hex');
export async function benchmarkManifest(manifestPath) {
  const fullPath = resolve(manifestPath), root = dirname(fullPath);
  const manifest = JSON.parse(await readFile(fullPath, 'utf8'));
  if (!Array.isArray(manifest.cases) || !manifest.cases.length) throw new Error('Supply one or more benchmark cases.');
  const rdkit = await initRDKit();
  const canonical = sdf => {
    const mol = rdkit.get_mol(sdf);
    if (!mol || !mol.is_valid()) { mol?.delete(); throw new Error('Reference product is not a valid molecule.'); }
    let heavy;
    try { heavy = rdkit.get_mol(mol.remove_hs()); return heavy.get_smiles(); }
    finally { heavy?.delete(); mol.delete(); }
  };
  const cases = [];
  for (const item of manifest.cases) {
    const row = { id: item.id, passed: false };
    try {
      const [query, linker, expected] = await Promise.all(['query', 'linker', 'expectedProduct'].map(key => readFile(resolve(root, item[key]), 'utf8')));
      row.sha256 = { query: digest(query), linker: digest(linker), expectedProduct: digest(expected) };
      row.attachments = item.attachments;
      const prepared = await prepareQuery(query, item.attachments);
      if (!prepared.ok) throw new Error(prepared.errors[0].message);
      if (item.receptor) {
        const receptor = await readFile(resolve(root, item.receptor), 'utf8');
        const checked = inspectReceptor(receptor, prepared.fragments);
        if (!checked.ok) throw new Error(checked.errors[0].message);
        prepared.receptor = checked.context;
        row.receptor = checked.report;
      }
      const result = await fitAndJoin(prepared, linkerDescriptor(linker), { maxRmsd: item.maxRmsd ?? 0.75 });
      if (!result.ok) throw new Error(result.errors[0].message);
      const expectedSmiles = canonical(expected);
      const product = parseSdf(result.sdf)[0];
      const originals = prepared.fragments.flatMap(fragment => fragment.atoms);
      let fixedMaxDeviation = 0;
      // Mapping includes removed explicit hydrogens; only surviving originals
      // are compared, preserving source numbering rather than matching by index.
      let fixedAtomsCompared = 0;
      for (const map of result.sourceAtomMappings) {
        if (map.productAtom == null) continue;
        const from = prepared.fragments[map.fragment - 1].atoms[map.atom - 1].xyz;
        const to = product.atoms[map.productAtom - 1].xyz;
        fixedMaxDeviation = Math.max(fixedMaxDeviation, Math.hypot(...from.map((v, k) => v - to[k])));
        fixedAtomsCompared++;
      }
      row.graphMatchesReference = result.smiles === expectedSmiles;
      row.expectedSmiles = expectedSmiles; row.actualSmiles = result.smiles;
      row.attachmentRmsdAngstrom = result.rmsd;
      row.fixedMaxDeviationAngstrom = fixedMaxDeviation;
      row.fixedAtomsCompared = fixedAtomsCompared;
      row.originalAtomCount = originals.length;
      row.receptorScore = result.receptor || null;
      row.passed = row.graphMatchesReference && fixedAtomsCompared === result.fragmentAtomCount && fixedAtomsCompared > 0 && fixedMaxDeviation <= 1e-4;
    } catch (error) { row.error = error.message; }
    cases.push(row);
  }
  return {
    formatVersion: 1, generatedAt: new Date().toISOString(), passed: cases.every(row => row.passed),
    moeProtocol: manifest.moeProtocol || null,
    moeParityEstablished: false,
    scope: 'Selected-linker product graph/stereochemistry and surviving query coordinates. This does not measure full-library recall or reproduce MOE search, pose selection or refinement.',
    cases,
  };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const value = flag => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };
  const report = await benchmarkManifest(value('--manifest') || fileURLToPath(new URL('benchmark-cases.json', import.meta.url)));
  const output = JSON.stringify(report, null, 2) + '\n';
  if (value('--out')) await writeFile(resolve(value('--out')), output);
  process.stdout.write(output);
  if (!report.passed) process.exitCode = 1;
}
