// NVIDIA OpenFold3 1.3 request/response contract:
// https://docs.nvidia.com/nim/bionemo/openfold3/1.3.0/example-requests.html
export function isGlueComplex(entities) {
  return entities.filter((entity) => entity.type === 'protein').length >= 2 && entities.some((entity) => entity.type === 'ligand');
}

/** Form validation before the browser submits a hosted prediction. */
export function foldInputIssues(entities, { mode = 'complex', outputFormat = 'pdb' } = {}) {
  const issues = [];
  if (!Array.isArray(entities) || !entities.length) return ['Add at least one molecular entity.'];
  if (!['pdb', 'mmcif', 'cif'].includes(outputFormat)) issues.push('Choose PDB or mmCIF output.');
  const ids = new Set();
  for (const [index, entity] of entities.entries()) {
    const id = String(entity.id || '').trim().toUpperCase();
    if (!/^[A-Z0-9]{1,4}$/.test(id)) issues.push(`Chain ${index + 1} needs a 1–4 character alphanumeric ID.`);
    if (outputFormat === 'pdb' && id.length > 1) issues.push(`PDB output needs a single-character ID for chain ${id}.`);
    if (ids.has(id)) issues.push('Each entity needs a unique chain ID.');
    ids.add(id);
    if (!['protein', 'dna', 'rna', 'ligand'].includes(entity.type)) {
      issues.push(`Chain ${id}: unsupported molecule type.`);
      continue;
    }
    if (entity.type === 'ligand') {
      const value = String(entity.ligandMode === 'ccd' ? entity.ccdCode || '' : entity.smiles || '').trim();
      if (!value) issues.push(`Enter a ligand for chain ${id}.`);
      else if (entity.ligandMode === 'ccd' && !/^[A-Z0-9]{1,5}$/i.test(value)) issues.push(`Chain ${id}: CCD code must be 1–5 letters or digits.`);
      continue;
    }
    const sequence = String(entity.sequence || '').replace(/\s/g, '').toUpperCase();
    if (!sequence) issues.push(`Enter a sequence for chain ${id}.`);
    else if (sequence.length > 4096) issues.push(`Chain ${id}: maximum sequence length is 4096 residues.`);
    else {
      const alphabet = entity.type === 'protein' ? /^[ACDEFGHIKLMNPQRSTVWY]+$/ : entity.type === 'dna' ? /^[ACGT]+$/ : /^[ACGU]+$/;
      if (!alphabet.test(sequence)) issues.push(`Chain ${id}: use ${entity.type === 'protein' ? 'standard amino-acid letters, without a FASTA header' : entity.type === 'dna' ? 'A, C, G and T only' : 'A, C, G and U only'}.`);
    }
    if (entity.type === 'protein' && entity.msaEnabled && !String(entity.msaCsv || '').trim()) issues.push(`Enter the custom alignment for chain ${id}.`);
  }
  if (mode === 'single' && (entities.length !== 1 || entities[0].type !== 'protein')) issues.push('Single-protein mode requires exactly one protein chain. Switch to Complex prediction for other inputs.');
  if (mode === 'glue' && !isGlueComplex(entities)) issues.push('Protein complex + glue requires at least two protein chains and one candidate ligand.');
  return issues;
}

export function buildFoldRequest(entities, requestId, outputFormat = 'pdb', options = {}) {
  const issues = foldInputIssues(entities, { ...options, outputFormat });
  if (issues.length) throw new Error(issues.join(' '));
  if (typeof requestId !== 'string' || !requestId.trim() || requestId.length > 128) throw new Error('Request ID must be 1–128 characters.');
  const molecules = entities.map(entity => {
    const id = entity.id.trim().toUpperCase();
    const molecule = { type: entity.type, id };
    if (entity.type === 'ligand') {
      const value = String(entity.ligandMode === 'ccd' ? entity.ccdCode : entity.smiles).trim();
      if (!value) throw new Error(`Enter a ligand for chain ${id}.`);
      molecule[entity.ligandMode === 'ccd' ? 'ccd_codes' : 'smiles'] = entity.ligandMode === 'ccd' ? value.toUpperCase() : value;
    } else {
      molecule.sequence = entity.sequence.replace(/\s/g, '').toUpperCase();
      if (!molecule.sequence) throw new Error(`Enter a sequence for chain ${id}.`);
      if (entity.type === 'protein' || entity.type === 'rna') {
        const custom = entity.type === 'protein' && entity.msaEnabled;
        const format = custom ? 'csv' : 'a3m';
        const alignment = custom ? entity.msaCsv : `>query\n${molecule.sequence}`;
        molecule.msa = { main: { [format]: { alignment, format } } };
      }
    }
    return molecule;
  });
  // The UI/history call this mmcif; the NVIDIA API requires the token "cif".
  return { request_id: requestId, inputs: [{ input_id: requestId, molecules, output_format: outputFormat === 'mmcif' ? 'cif' : outputFormat }] };
}

export function foldStructures(response, requestedFormat, requestId) {
  const structures = [];
  for (const output of response?.outputs || []) {
    for (const scored of output.structures_with_scores || []) {
      if (typeof scored.structure !== 'string' || !scored.structure.trim()) continue;
      const text = scored.structure;
      // Infer from coordinates when possible; never use subsequently edited form state.
      const format = /^\s*data_/m.test(text) ? 'mmcif' : /^(ATOM  |HETATM)/m.test(text) ? 'pdb' : requestedFormat === 'cif' ? 'mmcif' : requestedFormat;
      structures.push({ text, format, name: `${requestId}-${structures.length + 1}`, scores: scored });
    }
  }
  return structures;
}

export const FOLD_SCORE_KEYS = ['confidence_score', 'complex_plddt_score', 'ptm_score', 'iptm_score'];
export function finiteFoldScores(scores) {
  return Object.fromEntries(FOLD_SCORE_KEYS.filter(key => Number.isFinite(scores?.[key])).map(key => [key, scores[key]]));
}
export function foldHistoryEntities(entities, maxMsaLength = 200_000) {
  return entities.map(entity => {
    const copy = { ...entity };
    if (copy.msaCsv?.length > maxMsaLength) { copy.msaCsv = ''; copy.msaOmitted = true; }
    return copy;
  });
}
