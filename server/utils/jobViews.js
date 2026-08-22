function toIso(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function safeText(value, fallback = null) {
  return typeof value === 'string' && value.trim() ? value : fallback;
}

const SIMULATION_STATUS = new Set(['queued', 'running', 'completed', 'failed', 'cancelled', 'expired']);

export function normalizeSimulationJob(log) {
  const simulationKey = safeText(log.simulationKey || log.id, 'unknown');
  const hasStoredStatus = typeof log.status === 'string' && log.status.trim();
  const status = hasStoredStatus
    ? (SIMULATION_STATUS.has(log.status) ? log.status : 'unknown')
    : 'completed';

  return {
    id: `simulation:${simulationKey}`,
    kind: 'docking',
    status,
    progress: status === 'completed' ? 100 : status === 'failed' || status === 'cancelled' ? 0 : null,
    stage: status,
    createdAt: toIso(log.timestamp || log.createdAt),
    startedAt: toIso(log.startedAt),
    completedAt: toIso(log.completedAt || log.finishedAt),
    simulationKey,
    inputSummary: {
      pdbid: safeText(log.pdbid || log.pdbId),
      smiles: safeText(log.smiles || log.SMILES),
    },
    error: safeText(log.error),
    // Artifact existence is intentionally not inferred from a lightweight log
    // projection. The existing authenticated download routes remain the source
    // of truth until a shared artifact manifest is introduced.
    artifactManifest: [],
  };
}

export function normalizeAdmetJob(job) {
  const statusMap = {
    queued: 'queued',
    running: 'running',
    done: 'completed',
    error: 'failed',
  };
  const status = statusMap[job.status] || 'queued';
  const createdAt = toIso(job.createdAt || job.updatedAt);

  return {
    id: `admet:${job._id?.toString?.() || job.id || job.simulationKey}`,
    kind: 'admet',
    status,
    progress: status === 'completed' ? 100 : status === 'running' ? null : 0,
    stage: status,
    createdAt,
    startedAt: toIso(job.startedAt),
    completedAt: toIso(job.finishedAt),
    simulationKey: safeText(job.simulationKey),
    inputSummary: {
      pdbid: safeText(job.pdbid),
      moleculeCount: Array.isArray(job.smiles) ? job.smiles.length : null,
      priority: safeText(job.priority, 'normal'),
    },
    error: safeText(job.error),
    artifactManifest: [],
  };
}

export function sortJobs(jobs) {
  return [...jobs].sort((left, right) => {
    const leftTime = left.createdAt ? Date.parse(left.createdAt) : 0;
    const rightTime = right.createdAt ? Date.parse(right.createdAt) : 0;
    return rightTime - leftTime;
  });
}
