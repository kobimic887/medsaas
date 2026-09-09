// Open-compounds similarity results → Simulation table rows.
//
// Source: ChEMBL via /api/open-compounds/similarity. Scores are local RDKit
// Morgan (radius 2, 2048 bits, useChirality=false) Tanimoto — never a model
// number and never an Asinex/stock identifier. Rows must not gain purchase
// controls or stock snapshot quantities.

const NIL = {};

/** Map one open-compounds result to a Simulation row. Returns null if unusable. */
export function openResultFromItem(item) {
  if (!item || typeof item !== 'object') return null;
  const chemblId = typeof item.chemblId === 'string' ? item.chemblId.trim() : '';
  const smiles = typeof item.smiles === 'string' ? item.smiles.trim() : '';
  if (!chemblId && !smiles) return null;

  const sourceUrl = typeof item.sourceUrl === 'string' && item.sourceUrl.trim()
    ? item.sourceUrl.trim()
    : (chemblId ? `https://www.ebi.ac.uk/chembl/compound_report_card/${encodeURIComponent(chemblId)}/` : '');

  return {
    // Reuse ASINEX_ID as the table/selection key with the public ChEMBL id —
    // never invent an Asinex catalog code.
    ASINEX_ID: chemblId || 'N/A',
    isOpenRow: true,
    isStockRow: false,
    chemblId: chemblId || 'N/A',
    sourceUrl,
    sourceLabel: item.sourceLabel || 'ChEMBL',
    inchiKey: typeof item.inchiKey === 'string' ? item.inchiKey : null,
    SMILES_STRING: smiles,
    SIMILARITY: typeof item.similarity === 'number' && Number.isFinite(item.similarity)
      ? item.similarity
      : null,
    rank: Number.isInteger(item.rank) ? item.rank : null,
    openMeta: NIL,
  };
}

/** Map a full /api/open-compounds/similarity payload to rows. */
export function openResultsFromPayload(payload) {
  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.results)) return [];
  return payload.results.map(openResultFromItem).filter(Boolean);
}
