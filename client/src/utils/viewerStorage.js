export const VIEWER_STORAGE_KEYS = [
  'molstar_pdb_url',
  'molstar_pdb_name',
  'molstar_sdf_url',
  'molstar_simulation_key',
  'molstar_pdb_code',
  'molstar_display_pdb_id',
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
  'molstar_result_saved_at',
];

/** Legacy 4-character PDB IDs (1CX7, 44HP). Docking still requires this shape. */
const RCSB_PDB_ID_RE = /^[0-9][A-Z0-9]{3}$/;

export function normalizePdbId(value) {
  const id = String(value || '').trim().toUpperCase();
  return RCSB_PDB_ID_RE.test(id) ? id : '';
}

/** Public RCSB coordinate file used by "Load from PDB Database". */
export function rcsbPdbDownloadUrl(pdbId) {
  const id = normalizePdbId(pdbId);
  return id ? `https://files.rcsb.org/download/${id}.pdb` : '';
}

/** Prefer the current URL pdb= value, then the id stored for this result. */
export function readDisplayPdbId(search = typeof window !== 'undefined' ? window.location.search : '') {
  const params = new URLSearchParams(search);
  let stored = '';
  try {
    stored = localStorage.getItem('molstar_display_pdb_id') || '';
  } catch {
    stored = '';
  }
  return normalizePdbId(params.get('pdb') || stored);
}

/** One-shot flag: simulation.jsx sets this immediately before navigating to molstar3d. */
export const VIEWER_HANDOFF_FLAG = 'molstar_pending_handoff';

/** Fresh docking results stay restorable across in-app nav / reopen for this long. */
export const VIEWER_RESULT_TTL_MS = 5 * 60 * 1000;

export const VIEWER_RESULT_SAVED_AT_KEY = 'molstar_result_saved_at';

export const clearViewerStorage = () => {
  VIEWER_STORAGE_KEYS.forEach((key) => {
    localStorage.removeItem(key);
  });
};

/** Record that a docking / DiffDock result bundle was just written. */
export const stampViewerResultSaved = (now = Date.now()) => {
  try {
    localStorage.setItem(VIEWER_RESULT_SAVED_AT_KEY, String(now));
  } catch {
    // localStorage can throw in private mode; URL query handoff remains primary.
  }
};

export const markViewerHandoff = () => {
  stampViewerResultSaved();
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

const hasRestorableViewerBundle = () => {
  try {
    const simulationKey = localStorage.getItem('molstar_simulation_key');
    const pdbUrl = localStorage.getItem('molstar_pdb_url');
    if (simulationKey && pdbUrl) return true;

    const diffdockPdbId = String(localStorage.getItem('diffdock_pdb_id') || '').trim();
    if (
      diffdockPdbId
      && (localStorage.getItem('diffdock_protein') || localStorage.getItem('diffdock_ligand_position'))
    ) {
      return true;
    }
  } catch {
    return false;
  }
  return false;
};

/**
 * Drop expired docking result keys. Missing stamp with leftover keys counts as
 * expired (pre-TTL leftovers). Returns true when nothing fresh remains.
 */
export const purgeExpiredViewerStorage = (now = Date.now()) => {
  let savedAt = 0;
  try {
    savedAt = Number(localStorage.getItem(VIEWER_RESULT_SAVED_AT_KEY) || 0);
  } catch {
    clearViewerStorage();
    return true;
  }

  const fresh = Number.isFinite(savedAt)
    && savedAt > 0
    && now - savedAt <= VIEWER_RESULT_TTL_MS;

  if (fresh) return false;

  if (savedAt || hasRestorableViewerBundle()) {
    clearViewerStorage();
  }
  return true;
};

/**
 * True when this visit should load a docking result into the viewer.
 * Explicit handoff (?simulation= / ?pdb= / ?diffdock= or one-shot flag) always
 * loads. Bare /dashboard/molstar3d also restores a complete localStorage bundle
 * while it is within VIEWER_RESULT_TTL_MS; after that, idle empty workspace.
 * Does not consume the one-shot flag — call clearViewerHandoffFlag after
 * deciding to load (or on bare visit).
 */
export const peekViewerLoadIntent = (
  search = typeof window !== 'undefined' ? window.location.search : '',
  now = Date.now(),
) => {
  const params = new URLSearchParams(search);
  const fromUrl = Boolean(
    params.get('simulation')
      || params.get('pdb')
      || params.get('diffdock'),
  );
  if (fromUrl || readHandoffFlag()) return true;

  if (purgeExpiredViewerStorage(now)) return false;
  return hasRestorableViewerBundle();
};
