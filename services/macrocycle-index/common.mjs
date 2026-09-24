// Compact, read-only Morgan fingerprint index for the two 2026-09-23 exports.
//
// Two files, both in index order:
//   <source>.fpb   fixed-stride records: metadata CSV byte offset (uint64 LE),
//                  set-bit count (uint16 LE), then the 2048-bit RDKit Morgan
//                  fingerprint (256 bytes).
//   <source>.cnt   formatVersion 2 only: a packed count stream. One byte per
//                  SET BIT of the row's fingerprint, in ascending bit order,
//                  holding that bit's frequency (capped at 255). A row's slice
//                  length is therefore its uint16 set-bit count, so the stream
//                  needs no offset table — a sequential scan reads it in step
//                  with the fingerprint records.
//
// The count stream exists because neither engine can score a count metric: the
// RDKit WASM build exposes only binary Morgan, and tonomitosql maps every
// fingerprint to a binary cartridge type. Count support is identical to the
// stored binary bit set by construction (server/utils/countMorgan.js); the build
// aborts on any row where that stops holding.
export const FINGERPRINT_BYTES = 256;
export const RECORD_BYTES = 8 + 2 + FINGERPRINT_BYTES;
export const FINGERPRINT_DETAILS = JSON.stringify({
  radius: 2, nBits: 2048, useChirality: false,
  useBondTypes: true, useFeatures: false,
});

// 1 = binary index only (the deployed September 2026 staging artifact).
// 2 = binary index plus the packed count stream.
export const FORMAT_VERSION = 2;
export const COUNT_STREAM_VERSION = 2;
export const MAX_STORED_COUNT = 255;

export const FINGERPRINT_TYPES = Object.freeze(['morgan']);
export const DEFAULT_FINGERPRINT_TYPE = 'morgan';
export const BINARY_SIMILARITY_METRICS = Object.freeze(['tanimoto']);
export const COUNT_SIMILARITY_METRICS = Object.freeze(['count_tanimoto', 'count_dice']);
export const SIMILARITY_METRICS = Object.freeze([
  ...BINARY_SIMILARITY_METRICS,
  ...COUNT_SIMILARITY_METRICS,
]);
export const DEFAULT_SIMILARITY_METRIC = 'tanimoto';

// "(binary)" / "(frequency-weighted)" are deliberate: a count score must never
// read as binary and vice versa.
export const SIMILARITY_METRIC_LABELS = Object.freeze({
  tanimoto: 'Tanimoto (binary)',
  count_tanimoto: 'Count Tanimoto (frequency-weighted)',
  count_dice: 'Count Dice (frequency-weighted)',
});
export const FINGERPRINT_LABELS = Object.freeze({ morgan: 'Morgan (ECFP4)' });

export const COUNT_FINGERPRINT_DESCRIPTION =
  'Pyxis count Morgan, radius 2, 2048-bit, chirality off, bond types on; frequencies of the retained '
  + 'RDKit Morgan environments. A Pyxis method — not MOE ctanimoto and not comparable with MOE.';

export function countsFileName(source) {
  return `${source}.cnt`;
}

export function isCountMetric(metric) {
  return COUNT_SIMILARITY_METRICS.includes(metric);
}

/** Bit offsets set inside one fingerprint byte, ascending (shared lookup). */
export const BYTE_BIT_INDEXES = Array.from({ length: 256 }, (_, value) => {
  const indexes = [];
  for (let bit = 0; bit < 8; bit++) if (value & (1 << bit)) indexes.push(bit);
  return indexes;
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
