// NVIDIA OpenFold3 1.3 request/response contract:
// https://docs.nvidia.com/nim/bionemo/openfold3/1.3.0/example-requests.html
export function buildFoldRequest(entities, requestId, outputFormat) {
  const ids = new Set();
  const molecules = entities.map(entity => {
    const id = entity.id.trim();
    if (!id || ids.has(id)) throw new Error('Each entity needs a unique chain ID.');
    ids.add(id);
    const molecule = { type: entity.type, id };
    if (entity.type === 'ligand') {
      const value = (entity.ligandMode === 'ccd' ? entity.ccdCode : entity.smiles).trim();
      if (!value) throw new Error(`Enter a ligand for chain ${id}.`);
      molecule[entity.ligandMode === 'ccd' ? 'ccd_codes' : 'smiles'] = value;
    } else {
      molecule.sequence = entity.sequence.replace(/\s/g, '').toUpperCase();
      if (!molecule.sequence) throw new Error(`Enter a sequence for chain ${id}.`);
      if (entity.type === 'protein') {
        if (entity.msaEnabled && !entity.msaCsv.trim()) throw new Error(`Enter the custom alignment for chain ${id}.`);
        const format = entity.msaEnabled ? 'csv' : 'a3m';
        const alignment = entity.msaEnabled ? entity.msaCsv : `>query\n${molecule.sequence}`;
        molecule.msa = { main: { [format]: { alignment, format } } };
      }
    }
    return molecule;
  });
  return { request_id: requestId, inputs: [{ input_id: requestId, molecules, output_format: outputFormat }] };
}

export function foldStructures(response, requestedFormat, requestId) {
  const structures = [];
  for (const output of response?.outputs || []) {
    for (const scored of output.structures_with_scores || []) {
      if (typeof scored.structure !== 'string' || !scored.structure.trim()) continue;
      const text = scored.structure;
      // Infer from coordinates when possible; never use subsequently edited form state.
      const format = /^\s*data_/m.test(text) ? 'mmcif' : /^(ATOM  |HETATM)/m.test(text) ? 'pdb' : requestedFormat;
      structures.push({ text, format, name: `${requestId}-${structures.length + 1}`, scores: scored });
    }
  }
  return structures;
}
