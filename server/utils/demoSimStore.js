// In-process simulation store for the staging demo router.
//
// Demo mode has no MongoDB, so docking runs and their coordinate blobs live in
// this store for the process lifetime and reset on restart — the same honest
// "temporary demo history" story as folding history (docs/STAGING.md). Rows are
// written with the SAME ownership shape as production simulation_logs
// (buildSimulationLogOwnership from utils/simulationLogs.js), and list/get
// enforce the same tenant filter production /api/simulation-logs and artifact
// routes use, so the Control Panel and Molstar artifact fetches behave exactly
// as they do against Mongo — just without persistence across restarts.
//
// The store is bounded: only the newest MAX_RUNS are kept (oldest dropped), so
// a session of owner testing cannot grow unboundedly in memory. Dropped runs
// behave like a deleted row: list no longer shows them and artifact fetches
// answer 404. Pagination here is not retention — nothing is deleted silently
// below the documented cap, and the cap is generous for interactive testing.

import { buildSimulationLogOwnership } from './simulationLogs.js';

const MAX_RUNS = 12;

/** True when `row` would match production buildTenantFilter(req.user). */
function matchesTenant(row, user) {
  const username = typeof user?.username === 'string' ? user.username : null;
  const companyId = user?.companyId || null;
  if (companyId && row.companyId === companyId) return true;
  if (username && row.username === username) return true;
  if (username && row.user?.username === username) return true;
  return false;
}

function runKey(pdbid, smiles) {
  return `${String(pdbid || '')}\u0000${String(smiles || '')}`;
}

export function createDemoSimStore({ maxRuns = MAX_RUNS } = {}) {
  const runs = []; // newest last; list() reverses

  function trim() {
    while (runs.length > maxRuns) runs.shift();
  }

  /** Persist a completed run. Returns the stored row. */
  function save(user, entry) {
    const row = {
      ...buildSimulationLogOwnership(user),
      pdbid: entry.pdbid,
      smiles: entry.smiles,
      result: entry.result,
      simulationKey: entry.simulationKey,
      method: entry.method || 'POST',
      timestamp: new Date(),
    };
    runs.push(row);
    trim();
    return row;
  }

  /** Production mirrors the GET/POST cache-hit: same tenant + pdbid + smiles. */
  function findExisting(user, pdbid, smiles) {
    const wanted = runKey(pdbid, smiles);
    for (const row of runs) {
      if (
        matchesTenant(row, user) &&
        row.simulationKey &&
        runKey(row.pdbid, row.smiles) === wanted
      ) {
        return row;
      }
    }
    return null;
  }

  function getByKey(user, simulationKey) {
    for (const row of runs) {
      if (row.simulationKey === simulationKey && matchesTenant(row, user)) return row;
    }
    return null;
  }

  /** Control-Panel list: newest first, result blobs excluded (like prod projection). */
  function list(user) {
    return runs
      .filter((row) => matchesTenant(row, user))
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      .map(({ result: _result, ...row }) => row);
  }

  function size() {
    return runs.length;
  }

  return { save, findExisting, getByKey, list, size };
}
