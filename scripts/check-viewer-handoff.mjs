import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const parent = readFileSync(path.join(root, 'client/src/pages/dashboard/molstar3d.jsx'), 'utf8');
const simulation = readFileSync(path.join(root, 'client/src/pages/dashboard/simulation.jsx'), 'utf8');
const storage = readFileSync(path.join(root, 'client/src/utils/viewerStorage.js'), 'utf8');
const frame = readFileSync(path.join(root, 'client/public/molstar/index.html'), 'utf8');

const checks = [
  ['parent requests explicit viewer readiness', parent.includes("type: 'requestViewerReady'")],
  ['iframe announces explicit viewer readiness', frame.includes("type: 'viewerReady'")],
  ['parent sends one ordered result command', parent.includes("type: 'loadDockingResult'")],
  ['iframe handles the ordered result command', frame.includes("type === 'loadDockingResult'")],
  ['receptor loads before poses',
    frame.indexOf("loadStructureText(proteinText, 'pdb'") < frame.indexOf("loadStructureText(sdfText, 'sdf'")],
  ['simulation handoff names the PDB',
    parent.includes("'molstar_pdb_name'")
      && frame.includes('proteinName')
      && simulation.includes('PDB ${String(simPdbId).trim().toUpperCase()} · Simulation result')
      && parent.includes('PDB ${pdbLabel} · Simulation result')
      && !parent.includes('Simulation result · ${simulationParam}')],
  ['DiffDock handoff names protein and ligand',
    parent.includes("ligandName: ligandLabel")
      && parent.includes("PDB ${diffdockPdbId.toUpperCase()}")
      && frame.includes('ligandName = ')
      && simulation.includes("molstar_pdb_name', `PDB ${pdbLabel} · DiffDock`")],
  ['SMILES and manual PDB loads set Molstar labels',
    frame.includes("{ label: moleculeLabel }")
      && frame.includes("{ label: pdbLabel }")
      && frame.includes('dockingLoadGeneration')
      && frame.includes('loadStructureFromData')
      && frame.includes('dataLabel: label')],
  ['simulation handoff stores the legacy reduced SDF URL',
    simulation.includes('const sdfUrl = API_CONFIG.buildApiUrl(`/sanitizedminimalsdf/')
      && simulation.includes("simResult.simulationKey}")
      && simulation.includes("localStorage.setItem('molstar_sdf_url', sdfUrl)")],
  ['result page loads SMILES rows through the authenticated parent',
    parent.includes('if (sdfUrl)')
      && parent.includes('loadSdfData(sdfUrl, resultRequestController.signal, resultRequestEpoch)')
      && parent.includes('const response = await authedFetch(url, { signal })')],
  ['clicked SMILES fetches its specific pose with authentication',
    parent.includes('const sdfSpecUrl = API_CONFIG.buildApiUrl(`/sanitizedspecificsdf/')
      && parent.includes('encodeURIComponent(smiles)}`);')
      && parent.includes('const response = await authedFetch(sdfSpecUrl)')],
  ['automatic viewer load remains receptor-only until a SMILES is selected',
    parent.includes("proteinName: localStorage.getItem('molstar_pdb_name')")
      && !parent.includes('sdfText: resultText')],
  ['legacy unimplemented clear command is absent', !parent.includes('clearSdfStructure')],
  ['parent no longer reaches into iframe with eval', !parent.includes('.contentWindow.eval(')],
  ['Molstar CDN release is pinned', frame.includes('molstar@5.11.0') && !frame.includes('molstar@latest')],
  ['Molstar assets carry integrity metadata', (frame.match(/integrity="sha384-/g) || []).length === 2],
  ['desktop Safari disables broken impostor shaders without changing touch devices',
    frame.includes('installDesktopSafariMeshFallback();')
      && frame.includes('tryUseImpostor: false')
      && frame.includes("userAgent.includes('Macintosh')")
      && frame.includes('navigator.maxTouchPoints === 0')],
  ['mobile result cards remain available', parent.includes('space-y-3 md:hidden')],
  ['desktop result table remains available', parent.includes('hidden overflow-x-auto md:block')],
  ['wish list displays current and legacy catalog IDs', parent.includes("item.catalogId || item.moleculeId || item.id || 'N/A'")],
  ['result page emits no production debug logs', !parent.includes('console.log(')],
  ['crafted checkout query cannot clear the local cart', !parent.includes('checkoutStatus') && !parent.includes("localStorage.removeItem('moleculeCart')")],
  ['obsolete checkout query identifiers are scrubbed without mutating state', parent.includes("urlParams.delete('checkout')") && parent.includes("urlParams.delete('session_id')")],
  ['transient messages share one lifecycle-safe timer',
    (parent.match(/window\.setTimeout\(/g) || []).length === 1
      && parent.includes('window.clearTimeout(messageTimerRef.current)')],
  ['bare Simulation Results visits do not auto-load from localStorage alone',
    storage.includes('peekViewerLoadIntent')
      && storage.includes("params.get('diffdock')")
      && storage.includes('VIEWER_HANDOFF_FLAG')
      && parent.includes('peekViewerLoadIntent()')
      && parent.includes('if (!shouldAutoLoadRef.current)')
      && !parent.includes('hasRequestedSimulation')],
  ['simulation handoff marks intent and navigates with query',
    simulation.includes('markViewerHandoff()')
      && simulation.includes('simulation: simResult.simulationKey')
      && simulation.includes("navigate(`/dashboard/molstar3d?${handoffParams.toString()}`)")
      && simulation.includes("navigate('/dashboard/molstar3d?diffdock=1')")],
];

const failures = checks.filter(([, passed]) => !passed).map(([label]) => label);
if (failures.length) {
  console.error('Viewer handoff regression check failed:');
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log(`✓ Viewer handoff check passed (${checks.length} invariants)`);
