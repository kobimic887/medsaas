// Home result rows → a CSV of identifiers and locally calculated attributes.
//
// Descriptors (TPSA, MW, formula, cLogP, HBD/HBA, rotatable bonds, heavy atoms)
// come from browser RDKit on the exact result SMILES; a row whose structure
// RDKit cannot parse keeps empty descriptor cells rather than invented values.
// Snapshot amount and lead time are the dated supplier export fields, not live
// availability, and the header names them that way.

export const RESULTS_CSV_COLUMNS = Object.freeze([
  'rank', 'id', 'collection', 'smiles', 'score', 'tpsa_A2', 'mw', 'formula',
  'clogp_crippen', 'hbd', 'hba', 'rotatable_bonds', 'heavy_atoms',
  'snapshot_amount', 'snapshot_lead_time',
]);

const COLLECTION_NAMES = Object.freeze({
  stock: 'Stock', smallvirtual: 'Small-molecule virtual', real: 'Real RPX', virtual: 'Virtual VPX', open: 'ChEMBL',
});

/** Identity of one rendered result row, independent of which table drew it. */
export function resultRowIdentity(mol) {
  if (!mol || typeof mol !== 'object') return { id: '', collection: '' };
  if (mol.isStockRow) return { id: mol.stockCode || mol.ASINEX_ID || '', collection: 'stock' };
  if (mol.macrocycleCode) return { id: mol.macrocycleCode, collection: mol.macrocycleSource || '' };
  if (mol.chemblId) return { id: mol.chemblId, collection: 'open' };
  return { id: String(mol.ASINEX_ID || mol.id || ''), collection: '' };
}

function snapshotAmount(mol) {
  if (mol.isStockRow) return mol.STOCK_MG === null || mol.STOCK_MG === undefined ? '' : `${mol.STOCK_MG} mg`;
  return [mol.snapshotMg && `${mol.snapshotMg} mg`, mol.snapshotUm && `${mol.snapshotUm} µmol`].filter(Boolean).join(' / ');
}

const round = (value, digits) => (Number.isFinite(value) ? Number(value.toFixed(digits)) : '');

// Text cells that a spreadsheet would evaluate as a formula get a leading quote.
// Numbers are written as numbers, so a negative cLogP is never altered.
export function csvCell(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  let text = String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * @param {object[]} rows rendered result rows (already filtered to what is shown)
 * @param {(object|null)[]} descriptors per-row RDKit descriptors, or null when unavailable
 * @param {{ similarity: boolean, ranks?: number[] }} options
 */
export function buildResultsCsv(rows, descriptors, { similarity, ranks } = {}) {
  const lines = [RESULTS_CSV_COLUMNS.join(',')];
  rows.forEach((mol, index) => {
    const { id, collection } = resultRowIdentity(mol);
    const values = descriptors[index] || {};
    const score = similarity
      ? (Number.isFinite(Number(mol.SIMILARITY)) && mol.SIMILARITY !== null ? round(Number(mol.SIMILARITY), 4) : '')
      : 'match';
    lines.push([
      ranks?.[index] ?? index + 1,
      id,
      COLLECTION_NAMES[collection] || collection,
      mol.SMILES_STRING || '',
      score,
      round(values.tpsa, 2),
      round(values.mw, 3),
      values.formula || '',
      round(values.clogp, 3),
      values.hbd ?? '',
      values.hba ?? '',
      values.rotatableBonds ?? '',
      values.heavyAtoms ?? '',
      snapshotAmount(mol),
      mol.snapshotLeadTime || '',
    ].map(csvCell).join(','));
  });
  // Excel needs the BOM to read µ and Å as UTF-8.
  return `﻿${lines.join('\r\n')}\r\n`;
}
