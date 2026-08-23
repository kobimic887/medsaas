import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const parent = readFileSync(path.join(root, 'client/src/pages/dashboard/molstar3d.jsx'), 'utf8');
const simulation = readFileSync(path.join(root, 'client/src/pages/dashboard/simulation.jsx'), 'utf8');
const storage = readFileSync(path.join(root, 'client/src/utils/viewerStorage.js'), 'utf8');
const frame = readFileSync(path.join(root, 'client/public/molstar/index.html'), 'utf8');
const server = readFileSync(path.join(root, 'server/index.js'), 'utf8');

const memory = new Map();
globalThis.localStorage = {
  getItem: (key) => (memory.has(key) ? memory.get(key) : null),
  setItem: (key, value) => { memory.set(key, String(value)); },
  removeItem: (key) => { memory.delete(key); },
  clear: () => { memory.clear(); },
};
globalThis.sessionStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
};

const {
  VIEWER_RESULT_TTL_MS,
  markViewerHandoff,
  clearViewerStorage,
  clearViewerHandoffFlag,
  peekViewerLoadIntent,
  stampViewerResultSaved,
  purgeExpiredViewerStorage,
} = await import(pathToFileURL(path.join(root, 'client/src/utils/viewerStorage.js')).href);

const now = 1_700_000_000_000;
memory.clear();
localStorage.setItem('molstar_simulation_key', 'sim-abc');
localStorage.setItem('molstar_pdb_url', 'https://example.test/pdb');
stampViewerResultSaved(now);
clearViewerHandoffFlag();
const restoresWithinTtl = peekViewerLoadIntent('', now + VIEWER_RESULT_TTL_MS - 1_000) === true;
const expiresAfterTtl = peekViewerLoadIntent('', now + VIEWER_RESULT_TTL_MS + 1) === false
  && localStorage.getItem('molstar_simulation_key') === null;

memory.clear();
localStorage.setItem('molstar_simulation_key', 'legacy');
localStorage.setItem('molstar_pdb_url', 'https://example.test/pdb');
const legacyWithoutStampClears = purgeExpiredViewerStorage(now) === true
  && localStorage.getItem('molstar_simulation_key') === null;

memory.clear();
markViewerHandoff();
const handoffStamps = Boolean(localStorage.getItem('molstar_result_saved_at'));

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
  ['simulation result downloads send Authorization instead of a bare href',
    simulation.includes('downloadAuthedSimulationFile')
      && simulation.includes('Authorization: `Bearer ${token}`')
      && simulation.includes("API_CONFIG.buildApiUrl(endpoint)")
      && !simulation.includes('href={API_CONFIG.buildApiUrl(`/sanitizedpdb/')
      && !simulation.includes('href={API_CONFIG.buildApiUrl(`/sanitizedminimalsdf/')],
  ['result page loads SMILES rows through the authenticated parent',
    parent.includes('if (sdfUrl)')
      && parent.includes('loadSdfData(sdfUrl, resultRequestController.signal, resultRequestEpoch)')
      && parent.includes('const response = await authedFetch(url, { signal })')],
  ['clicked SMILES fetches its specific pose with authentication',
    parent.includes('const sdfSpecUrl = API_CONFIG.buildApiUrl(`/sanitizedspecificsdf/')
      && parent.includes('encodeURIComponent(smiles)}`);')
      && parent.includes('const response = await authedFetch(sdfSpecUrl)')],
  ['SDF downloads set private Cache-Control',
    ['/api/sanitizedsdf/:simulationKey', '/api/sanitizedminimalsdf/:simulationKey', '/api/sanitizedspecificsdf/:simulationKey/:smiles']
      .every((route) => {
        const start = server.indexOf(`app.get('${route}'`);
        if (start < 0) return false;
        const nextRoute = server.indexOf('\napp.get(', start + 1);
        const handler = server.slice(start, nextRoute > 0 ? nextRoute : undefined);
        return handler.includes("res.setHeader('Cache-Control', 'private, max-age=300')")
          && handler.includes('authenticateToken')
          && handler.includes('requireActiveUser');
      })],
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
  ['viewer result TTL is five minutes',
    storage.includes('VIEWER_RESULT_TTL_MS = 5 * 60 * 1000')
      && storage.includes("VIEWER_RESULT_SAVED_AT_KEY = 'molstar_result_saved_at'")
      && storage.includes('purgeExpiredViewerStorage')
      && storage.includes('hasRestorableViewerBundle')],
  ['bare Simulation Results restores within TTL only',
    storage.includes('peekViewerLoadIntent')
      && storage.includes("params.get('diffdock')")
      && storage.includes('VIEWER_HANDOFF_FLAG')
      && parent.includes('peekViewerLoadIntent()')
      && parent.includes('if (!shouldAutoLoadRef.current)')
      && !parent.includes('hasRequestedSimulation')
      && restoresWithinTtl
      && expiresAfterTtl
      && legacyWithoutStampClears
      && handoffStamps],
  ['markViewerHandoff stamps result freshness',
    storage.includes('stampViewerResultSaved()')
      && simulation.includes('markViewerHandoff()')],
  ['deep-link simulation writes refresh the TTL stamp',
    parent.includes('stampViewerResultSaved()')],
  ['intentional clears still wipe viewer storage',
    parent.includes('clearViewerStorage()')
      && simulation.includes('clearViewerStorage()')
      && (() => {
        memory.clear();
        stampViewerResultSaved(now);
        localStorage.setItem('molstar_simulation_key', 'x');
        clearViewerStorage();
        return localStorage.getItem('molstar_simulation_key') === null
          && localStorage.getItem('molstar_result_saved_at') === null;
      })()],
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
