export const VIEWER_STORAGE_KEYS = [
  'molstar_pdb_url',
  'molstar_sdf_url',
  'molstar_simulation_key',
  'molstar_pdb_code',
  'diffdock_result',
  'diffdock_pdb_id',
  'diffdock_ligand_id',
  'diffdock_timestamp',
  'diffdock_protein',
  'diffdock_ligand',
  'diffdock_ligand_position',
  'diffdock_confidence_score',
];

export const clearViewerStorage = () => {
  VIEWER_STORAGE_KEYS.forEach((key) => {
    localStorage.removeItem(key);
  });
};
