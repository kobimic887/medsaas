/* Local-only structure matching. This classic worker keeps expensive SMARTS
 * matches off the UI thread and can be terminated at the caller's deadline.
 * No structures or patterns are sent to the CDN: only the RDKit runtime loads.
 */
let rdkitPending;
function loadSmartsRdkit() {
  if (!rdkitPending) rdkitPending = (async () => {
    let lastError;
    for (const base of [
      'https://unpkg.com/@rdkit/rdkit@2026.9.1/dist/',
      'https://cdn.jsdelivr.net/npm/@rdkit/rdkit@2026.9.1/dist/',
    ]) {
      try {
        importScripts(`${base}RDKit_minimal.js`);
        return await self.initRDKitModule({ locateFile: (filename) => base + filename });
      } catch (error) { lastError = error; }
    }
    throw lastError || new Error('RDKit could not load.');
  })();
  return rdkitPending;
}

// Exposed as a function so the real WASM matcher can be tested independently
// of network/worker startup. Every query and molecule is freed on every path.
async function matchSmartsRows(rdkit, patterns, rows, progress = () => {}) {
  if (!Array.isArray(patterns) || !patterns.length || patterns.length > 100) throw new Error('Use 1–100 SMARTS patterns.');
  if (!Array.isArray(rows) || rows.length > 2000) throw new Error('Annotate at most 2,000 loaded results at a time.');
  const queries = [];
  try {
    for (let index = 0; index < patterns.length; index += 1) {
      const pattern = patterns[index];
      if (!pattern || typeof pattern.smarts !== 'string' || pattern.smarts.length > 4096) throw new Error(`Invalid SMARTS entry ${index + 1}.`);
      const query = rdkit.get_qmol(pattern.smarts);
      if (!query) throw new Error(`Invalid SMARTS: ${pattern.label || `pattern ${index + 1}`}. No filter was applied.`);
      queries.push(query);
    }
    const annotations = [];
    for (let index = 0; index < rows.length; index += 1) {
      let molecule;
      try {
        if (typeof rows[index] !== 'string' || !rows[index].trim()) throw new Error('Structure is missing.');
        molecule = rdkit.get_mol(rows[index]);
        if (!molecule || !molecule.is_valid()) throw new Error('Structure could not be parsed.');
        const patternIndices = [];
        for (let patternIndex = 0; patternIndex < queries.length; patternIndex += 1) {
          const match = JSON.parse(molecule.get_substruct_match(queries[patternIndex], JSON.stringify({ useChirality: true })));
          if (Array.isArray(match.atoms) && match.atoms.length) patternIndices.push(patternIndex);
        }
        annotations.push({ state: patternIndices.length ? 'matched' : 'no-match', patternIndices });
      } catch {
        // Missing/invalid structures and matcher errors are unknown, never a
        // negative chemistry result. Keep them visible in annotation mode.
        annotations.push({ state: 'unknown', patternIndices: [] });
      } finally { molecule?.delete(); }
      if ((index + 1) % 25 === 0) progress(index + 1);
    }
    return annotations;
  } finally { queries.forEach((query) => query.delete()); }
}

self.onmessage = async ({ data }) => {
  try {
    const rdkit = await loadSmartsRdkit();
    const annotations = await matchSmartsRows(rdkit, data.patterns, data.rows,
      (completed) => self.postMessage({ type: 'progress', completed }));
    self.postMessage({ type: 'result', annotations });
  } catch (error) { self.postMessage({ type: 'error', message: error.message || 'SMARTS annotation failed.' }); }
};
