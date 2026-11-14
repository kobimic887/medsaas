export function resolveDiffDockUrl(companyUrl, configuredUrl) {
  // Signup persisted the old platform default into company records. Let an
  // explicit operator cutover replace that exact default without editing Atlas.
  // Independent company providers still pass through the existing SSRF guard.
  const legacy = 'https://services.asinex.com:58000/molecular-docking/diffdock/generate';
  return configuredUrl && companyUrl?.replace(/\/$/, '') === legacy ? configuredUrl : companyUrl;
}

export function resolveDockingUrl(companyUrl, configuredUrl) {
  const legacy = 'https://services.asinex.com:8000/docking';
  return configuredUrl && companyUrl?.replace(/\/$/, '') === legacy ? configuredUrl : companyUrl;
}

export function persistedLigandServiceConfig(config, defaults) {
  // Omitted endpoints inherit operator defaults at request time. Persisting a
  // loopback default would turn it into a forbidden company override on rollback.
  return Object.fromEntries(Object.entries(config).filter(([key, value]) => value !== defaults[key]));
}

export function completedDockingResult(data) {
  if (typeof data?.pdb !== 'string' || !data.pdb.trim()
    || typeof data?.sdf !== 'string' || !data.sdf.trim()) {
    throw new Error('Docking returned no receptor or pose structures');
  }
  return data;
}

// Keep the legacy workload unless an operator explicitly configures a qualified
// smaller run. Never rely on a compute service silently capping 100 requested poses.
export function configuredDiffDockPoseCount(raw) {
  if (raw === undefined || raw === '') return 100;
  if (!/^[1-9]\d*$/.test(String(raw)) || Number(raw) > 100) {
    throw new Error('DIFFDOCK_NUM_POSES must be an integer from 1 to 100');
  }
  return Number(raw);
}

export function completedDiffDockResult(data, requested) {
  if (data?.status !== 'success' || !Array.isArray(data.ligand_positions)
    || !Array.isArray(data.position_confidence)
    || data.ligand_positions.length !== requested
    || data.position_confidence.length !== requested
    || !data.ligand_positions.every((pose, index) => typeof pose === 'string'
      && pose.trim() && Number.isFinite(data.position_confidence[index]))) {
    throw new Error('DiffDock returned an incomplete or failed pose set');
  }
  return { ...data, requested_poses: requested, generated_poses: requested };
}
