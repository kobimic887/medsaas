// Compact, read-only Morgan fingerprint index for the two 2026-09-23 exports.
// Each record is: metadata CSV byte offset (uint64 LE), bit count (uint16 LE),
// then the 2048-bit RDKit Morgan fingerprint (256 bytes).
export const FINGERPRINT_BYTES = 256;
export const RECORD_BYTES = 8 + 2 + FINGERPRINT_BYTES;
export const FINGERPRINT_DETAILS = JSON.stringify({
  radius: 2, nBits: 2048, useChirality: false,
  useBondTypes: true, useFeatures: false,
});

export const DATASETS = Object.freeze({
  real: { id: 1, name: 'Macrocycles real stock — 2026-09-23', expectedRows: 18190 },
  virtual: { id: 2, name: 'Macrocycles virtual — 2026-09-23', expectedRows: 2350440 },
});

export const NORMALIZED_HEADER = [
  'smiles', 'ID', 'MAIN_BAS', 'compound_id', 'source', 'source_file',
  'web_mg', 'web_uM', 'CURRENT_TOT_NETTO_MG', 'CURRENT_TOT_AMOUNT_UM', 'Lead_TIME',
];

export const POPCOUNT = Uint8Array.from({ length: 256 }, (_, value) => {
  let count = 0;
  for (let bit = value; bit; bit &= bit - 1) count++;
  return count;
});

export function parseCsvLine(line) {
  const fields = [];
  let value = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (quoted && line[i + 1] === '"') { value += '"'; i++; }
      else quoted = !quoted;
    } else if (char === ',' && !quoted) {
      fields.push(value); value = '';
    } else value += char;
  }
  if (quoted) throw new Error('Unclosed CSV quote');
  fields.push(value);
  return fields;
}
