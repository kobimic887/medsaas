export const MAX_SMARTS_PATTERNS = 100;
export const MAX_SMARTS_ROWS = 2000;
export const MAX_SMARTS_FILE_BYTES = 65536;

/** One SMARTS per line. The owner file uses SMARTS <tabs> !!label.
 * Do not split on commas: `[C,N]` and bond alternatives are SMARTS syntax.
 */
export function parseMultiSmarts(text) {
  if (String(text).length > MAX_SMARTS_FILE_BYTES) throw new Error('Use a SMARTS file no larger than 64 KB.');
  const patterns = String(text).split(/\r?\n/).map((line, index) => {
    const value = line.trim();
    if (!value || value.startsWith('//')) return null;
    const match = value.match(/^(\S+)(?:\s+(?:!!)?(.+))?$/);
    if (!match || match[1].length > 4096) throw new Error(`Invalid SMARTS entry on line ${index + 1}.`);
    return { smarts: match[1], label: match[2]?.trim() || `Pattern ${index + 1}` };
  }).filter(Boolean);
  if (!patterns.length) throw new Error('Enter at least one SMARTS pattern.');
  if (patterns.length > MAX_SMARTS_PATTERNS) throw new Error(`Use at most ${MAX_SMARTS_PATTERNS} SMARTS patterns; none were applied.`);
  return patterns;
}

export const resultSmiles = (row) => row.SMILES_STRING || row.SMILES || row.smiles || '';

/** Keep indices from the original server result list. Filtering must never
 * renumber an index-based selection, change ranking, or mutate result rows.
 */
export function smartsVisibleIndices(rows, result) {
  if (!result || result.rows !== rows || result.mode === 'annotate') return rows.map((_, index) => index);
  return rows.flatMap((_, index) => {
    const entry = result.annotations[index];
    if (!entry || entry.state === 'unknown') return [];
    const matches = entry.patternIndices.length;
    return (result.mode === 'all' ? matches === result.patterns.length : matches > 0) ? [index] : [];
  });
}

export function selectVisibleSmartsRows(rows, indices, previous, identity, checked) {
  const next = new Set(previous);
  for (const index of indices) {
    const id = identity(rows[index], index);
    if (checked) next.add(id); else next.delete(id);
  }
  return next;
}
