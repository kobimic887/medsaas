import { stockResultFromItem } from './stockResults.js';
import { macrocycleResultsFromPayload } from './macrocycleResults.js';
import { openResultFromItem } from './openResults.js';

export const OWNED_SEARCH_MODES = Object.freeze([
  { value: 'similarity', label: 'Similarity' },
  { value: 'id', label: 'Compound ID' },
  { value: 'exact', label: 'Exact structure' },
  { value: 'substructure', label: 'Substructure' },
]);

/** Owned collections in display order; any mix is searched as one ranked list. */
export const OWNED_COLLECTIONS = Object.freeze([
  { value: 'stock', group: 'Small molecules', label: 'Stock', fullLabel: 'Small molecules · Stock' },
  { value: 'smallvirtual', group: 'Small molecules', label: 'Virtual', fullLabel: 'Small molecules · Virtual' },
  { value: 'real', group: 'Macrocycles', label: 'Real (RPX)', fullLabel: 'Macrocycles · Real RPX' },
  { value: 'virtual', group: 'Macrocycles', label: 'Virtual (VPX)', fullLabel: 'Macrocycles · Virtual VPX' },
]);
const COLLECTION_KEYS = OWNED_COLLECTIONS.map(({ value }) => value);

export const isMultiSource = (source) => typeof source === 'string' && source.startsWith('multi:');

/** Collections a page source searches ("both" is RPX + VPX; open has none). */
export function collectionsForSource(source) {
  if (source === 'both') return ['real', 'virtual'];
  if (isMultiSource(source)) return COLLECTION_KEYS.filter((value) => source.slice(6).split(',').includes(value));
  return COLLECTION_KEYS.includes(source) ? [source] : [];
}

/**
 * Single legacy selections keep their dedicated paths (stock fingerprint options,
 * macrocycle count metrics); any other selection is `multi:<collections>`.
 */
export function sourceForCollections(collections) {
  const key = COLLECTION_KEYS.filter((value) => collections.includes(value)).join(',');
  if (!key) return null;
  if (['stock', 'real', 'virtual'].includes(key)) return key;
  return key === 'real,virtual' ? 'both' : `multi:${key}`;
}

/** The owned-search API names a page source as source (+ sources for a mix). */
export function ownedSearchSourceParams(source) {
  return isMultiSource(source) ? { source: 'multi', sources: collectionsForSource(source) } : { source };
}

export const collectionLabel = (value) => OWNED_COLLECTIONS.find((entry) => entry.value === value)?.fullLabel || value;

/** SMARTS bond primitives/operators; a structure never starts or ends with one. */
const BOND_SYMBOLS = new Set(['-', '=', '#', ':', '~', '@', '/', '\\', '!', '&', ';']);
const neighbour = (line, index, step) => { while (line[index] === ' ' || line[index] === '\t') index += step; return line[index]; };

/**
 * Commas in atom lists, CXSMILES metadata or SMARTS bond lists (`C-,=C`) belong
 * to the query, not the batch. A bond-list comma always touches a bond symbol,
 * which can never begin or end a whole structure.
 */
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
      const bondList = mode !== 'id' && character === ','
        && (BOND_SYMBOLS.has(neighbour(line, i - 1, -1)) || BOND_SYMBOLS.has(neighbour(line, i + 1, 1)));
      if (i === line.length || (character === ',' && bracketDepth === 0 && !cx && !bondList)) {
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
    const rowSource = source === 'multi' ? item?.source : source;
    const row = rowSource === 'stock' ? stockResultFromItem(item)
      : rowSource === 'open' ? openResultFromItem(item)
        : macrocycleResultsFromPayload({ results: [item] }, rowSource)[0];
    if (!row) return null;
    return { ...row, matchedQueryIndices: Array.isArray(item.matchedQueryIndices)
      ? item.matchedQueryIndices.filter(Number.isInteger) : [] };
  }).filter(Boolean);
}

export function appendUniqueOwnedRows(existing, incoming, source) {
  const identity = (row) => source === 'open' ? `open:${row.chemblId}`
    : row.isStockRow ? `stock:${row.stockRowId}` : `${row.macrocycleSource}:${row.macrocycleRowId}`;
  const seen = new Set(existing.map(identity));
  return incoming.filter((row) => {
    const key = identity(row);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
