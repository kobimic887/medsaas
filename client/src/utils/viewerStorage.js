export const VIEWER_STORAGE_KEYS = [
  'molstar_pdb_url',
  'molstar_pdb_name',
  'molstar_sdf_url',
  'molstar_simulation_key',
  'molstar_pdb_code',
  'molstar_simulation_pairs',
  'diffdock_result',
  'diffdock_pdb_id',
  'diffdock_ligand_id',
  'diffdock_timestamp',
  'diffdock_protein',
  'diffdock_ligand',
  'diffdock_ligand_input',
  'diffdock_ligand_position',
  'diffdock_confidence_score',
];

/** One-shot flag: simulation.jsx sets this immediately before navigating to molstar3d. */
export const VIEWER_HANDOFF_FLAG = 'molstar_pending_handoff';

export const clearViewerStorage = () => {
  VIEWER_STORAGE_KEYS.forEach((key) => {
    localStorage.removeItem(key);
  });
};

export const markViewerHandoff = () => {
  try {
    sessionStorage.setItem(VIEWER_HANDOFF_FLAG, '1');
  } catch {
    // sessionStorage can throw in private mode; URL query handoff remains primary.
  }
};

const readHandoffFlag = () => {
  try {
    return sessionStorage.getItem(VIEWER_HANDOFF_FLAG) === '1';
  } catch {
    return false;
  }
};

export const clearViewerHandoffFlag = () => {
  try {
    sessionStorage.removeItem(VIEWER_HANDOFF_FLAG);
  } catch {
    // ignore
  }
};

/**
 * True when this visit should load a docking result into the viewer.
 * Bare /dashboard/molstar3d (nav click) must stay idle even if localStorage still
 * holds the previous run. Does not consume the one-shot flag — call
 * clearViewerHandoffFlag after deciding to load (or on bare visit).
 */
export const peekViewerLoadIntent = (search = typeof window !== 'undefined' ? window.location.search : '') => {
  const params = new URLSearchParams(search);
  const fromUrl = Boolean(
    params.get('simulation')
      || params.get('pdb')
      || params.get('diffdock'),
  );
  return fromUrl || readHandoffFlag();
};
