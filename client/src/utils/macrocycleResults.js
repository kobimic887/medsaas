// Macrocycle hits use the same engine envelope as stock search, but are a
// separate source. Preserve the supplier identifier as text and never turn a
// real-stock or virtual structure into a priced internal-catalog row.
export function macrocycleResultsFromPayload(payload, source) {
  if (!Array.isArray(payload?.results)) return [];
  return payload.results.map((item) => {
    const rowSource = source === 'both' ? item?.source : source;
    if (rowSource !== 'real' && rowSource !== 'virtual') return null;
    const metadata = item?.metadata && typeof item.metadata === 'object' ? item.metadata : {};
    const code = String(metadata.MAIN_BAS || metadata.compound_id || metadata.ID || item?.molecule_id || '').trim();
    const smiles = String(item?.canonical_smiles || '').trim();
    if (!code || !smiles) return null;
    return {
      ASINEX_ID: code,
      macrocycleCode: code,
      macrocycleRowId: item.molecule_id,
      macrocycleSource: rowSource,
      shopOffer: item.shopOffer || null,
      SMILES_STRING: smiles,
      SIMILARITY: typeof item.similarity === 'number' && Number.isFinite(item.similarity) ? item.similarity : null,
      snapshotMg: String(metadata.web_mg || metadata.CURRENT_TOT_NETTO_MG || '').trim(),
      snapshotUm: String(metadata.web_uM || metadata.CURRENT_TOT_AMOUNT_UM || '').trim(),
      snapshotLeadTime: String(metadata.Lead_TIME ?? '').trim(),
      isMacrocycleRow: true,
    };
  }).filter(Boolean);
}

export function appendUniqueMacrocycleRows(existingRows, newRows) {
  const key = (row) => `${row.macrocycleSource}:${row.macrocycleRowId}`;
  const seen = new Set(existingRows.map(key));
  return newRows.filter((row) => {
    const id = key(row);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}
