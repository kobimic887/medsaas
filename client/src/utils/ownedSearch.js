import { stockResultFromItem } from './stockResults.js';
import { macrocycleResultsFromPayload } from './macrocycleResults.js';
import { openResultFromItem } from './openResults.js';

export const OWNED_SEARCH_MODES = Object.freeze([
  { value: 'similarity', label: 'Similarity' },
  { value: 'id', label: 'Compound ID' },
  { value: 'exact', label: 'Exact structure' },
  { value: 'substructure', label: 'Substructure' },
]);

/** Commas in atom lists or CXSMILES metadata belong to the query, not the batch. */
export function parseSearchQueries(input, mode = 'similarity', maxQueries = 20) {
  const queries = [];
  for (const line of String(input || '').split(/\r?\n/)) {
    if (!line.trim()) continue;
    let bracketDepth = 0;
    let cx = false;
    let start = 0;
    for (let i = 0; i <= line.length; i += 1) {
      const character = line[i];
      if (mode !== 'id') {
        if (character === '[' && !cx) bracketDepth += 1;
        if (character === ']' && !cx) bracketDepth = Math.max(0, bracketDepth - 1);
        if (character === '|' && bracketDepth === 0) cx = !cx;
      }
      if (i === line.length || (character === ',' && bracketDepth === 0 && !cx)) {
        const query = line.slice(start, i).trim();
        if (!query) throw new Error('A comma-separated entry is empty. Remove the extra comma.');
        queries.push(query);
        start = i + 1;
      }
    }
  }
  if (!queries.length) throw new Error(mode === 'id' ? 'Enter a compound ID.' : 'Enter a query structure.');
  if (queries.length > maxQueries) throw new Error(`Use at most ${maxQueries} queries per search; ${queries.length} were supplied.`);
  return queries;
}

/** Accept only advertised capabilities; never infer exact chemistry from a similarity score. */
export function searchModesFromStatus(status, source) {
  const entry = status?.sources?.[source] || status;
  if (entry?.available !== true) return [];
  const modes = entry.modes || entry.capabilities?.modes || [];
  return modes.map((mode) => typeof mode === 'string' ? mode : mode?.value)
    .filter((mode) => OWNED_SEARCH_MODES.some((option) => option.value === mode));
}

export function ownedRowsFromPayload(payload, source) {
  if (!Array.isArray(payload?.results)) throw new Error('The search response did not contain results.');
  return payload.results.map((item) => {
    const row = source === 'stock' ? stockResultFromItem(item)
      : source === 'open' ? openResultFromItem(item)
        : macrocycleResultsFromPayload({ results: [item] }, source)[0];
    if (!row) return null;
    return { ...row, matchedQueryIndices: Array.isArray(item.matchedQueryIndices)
      ? item.matchedQueryIndices.filter(Number.isInteger) : [] };
  }).filter(Boolean);
}

export function appendUniqueOwnedRows(existing, incoming, source) {
  const identity = (row) => source === 'stock' ? `stock:${row.stockRowId}`
    : source === 'open' ? `open:${row.chemblId}` : `${row.macrocycleSource}:${row.macrocycleRowId}`;
  const seen = new Set(existing.map(identity));
  return incoming.filter((row) => {
    const key = identity(row);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
