import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const viewer = readFileSync(
  path.join(root, 'client/src/pages/dashboard/moleculeviewer.jsx'),
  'utf8',
);

const signalCount = (viewer.match(/signal: controller\.signal/g) || []).length;
const checks = [
  ['3Dmol starts independently from RDKit', viewer.includes('initViewer();\n    initRDKit();')],
  ['viewer initialization no longer waits on an arbitrary timer', !viewer.includes('setTimeout(initializeViewer')],
  ['DiffDock handoff no longer waits on an arbitrary timer', !viewer.includes('setTimeout(checkDiffDockResult')],
  ['stale structure lookups are aborted', viewer.includes('visualizationControllerRef.current?.abort()')],
  ['all remote structure fetches carry the abort signal', signalCount === 4],
  ['remote structure lookup has a bounded timeout', viewer.includes("'Structure lookup timed out', 'TimeoutError'")],
  ['pre-readiness structures are queued with their formats', viewer.includes('pendingMolDataRef.current = { data: molData, formats }')],
  ['DiffDock rendering preserves format fallback', viewer.includes("renderStructure(structureData, ['sdf', 'pdb', 'mol'])")],
  ['example molecules are keyboard-accessible controls', /aria-label=\{`Visualize \$\{mol\.name\}`\}/.test(viewer)],
];

const failures = checks.filter(([, passed]) => !passed).map(([label]) => label);
if (failures.length) {
  console.error('Molecule viewer lifecycle regression check failed:');
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log(`✓ Molecule viewer lifecycle check passed (${checks.length} invariants)`);
