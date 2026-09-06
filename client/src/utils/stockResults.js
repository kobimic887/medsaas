// Stock-compound similarity results → Simulation table rows.
//
// Anna's stock export is searched by STRUCTURE only: the tonomitosql engine
// computes RDKit fingerprints from SMILES for BOTH the library and the query
// (default morgan/ECFP4 + Tanimoto), never Anna's MOE FP:* columns — MOE sparse
// key lists are not RDKit bit vectors, so a direct comparison is not
// scientifically valid (docs/DATA-STOCK-COMPOUNDS.md, the MOE PDF).
//
// One raw similarity result from the engine is:
//   { molecule_id, canonical_smiles, similarity, metadata }
// where metadata is the verbatim import row: { ID, MAIN_BAS, compound_id,
// CURRENT_TOT_AMOUNT_UM, CURRENT_TOT_NETTO_MG }. Strings keep their leading
// zeros ("ASN 04188606"); numbers are dated snapshot quantities from the
// September export, NOT live availability.
//
// The Simulation page needs: a recognizable stock code, the structure, and the
// similarity score for ranking and the docking/DiffDock handoff. Stock rows
// must NOT be dressed up as Asinex catalog rows: no IUPAC/InChI/formula/MW, no
// prices, no "available" amounts, and no cart affordance (there is no
// authoritative pricing for the stock list yet — purchasing stays Asinex-side).
// Database row id (molecule_id), stock code (MAIN_BAS/compound_id) and the
// pagination cursor (offset, kept in the page) are deliberately separate.

const NIL = {};

function codeFromMetadata(meta) {
  if (!meta || typeof meta !== 'object') return '';
  const code = meta.MAIN_BAS ?? meta.compound_id;
  if (typeof code === 'string' && code.trim()) return code.trim();
  // Last resort: the bare numeric stock ID. It exists on every imported row.
  if (meta.ID !== undefined && meta.ID !== null && String(meta.ID).trim()) {
    return String(meta.ID).trim();
  }
  return '';
}

function amountFrom(meta, key) {
  const value = meta?.[key];
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  if (text === '') return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : text;
}

/** Map one engine result to a Simulation row. Returns null for unusable items. */
export function stockResultFromItem(item) {
  if (!item || typeof item !== 'object') return null;
  const meta = item.metadata && typeof item.metadata === 'object' ? item.metadata : NIL;
  const smiles = typeof item.canonical_smiles === 'string' ? item.canonical_smiles.trim() : '';
  const stockCode = codeFromMetadata(meta);
  const rowId = item.molecule_id;
  if (!smiles && !stockCode && rowId === undefined) return null;

  return {
    // Shared table identity: a recognizable stock code ("BAS 30908960").
    // The page uses ASINEX_ID for row keys/selection, so a stock hit fills it
    // with its OWN stock code — never with an Asinex row identifier.
    ASINEX_ID: stockCode || 'N/A',
    // True stock provenance flags — used to render the honest stock columns
    // and to keep stock rows out of Asinex cart flows.
    isStockRow: true,
    stockRowId: rowId ?? null, // engine database row id (not a stock code)
    stockCode: stockCode || 'N/A',
    SMILES_STRING: smiles,
    SIMILARITY: typeof item.similarity === 'number' && Number.isFinite(item.similarity) ? item.similarity : null,
    // Dated snapshot quantities from the import (umol / mg). Shown as
    // "snapshot", never as availability, never priced.
    STOCK_UM: amountFrom(meta, 'CURRENT_TOT_AMOUNT_UM'),
    STOCK_MG: amountFrom(meta, 'CURRENT_TOT_NETTO_MG'),
  };
}

/** Map a full /api/stock-search/similarity payload ({results:[...]}) to rows. */
export function stockResultsFromPayload(payload) {
  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.results)) return [];
  return payload.results.map(stockResultFromItem).filter(Boolean);
}
