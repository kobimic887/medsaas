import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { XMarkIcon } from '@heroicons/react/24/outline';
import { API_CONFIG, getAuthToken } from '@/utils/constants';
import { OWNED_SEARCH_MODES, collectionsForSource } from '@/utils/ownedSearch';

// Home search history. The server keeps one entry per owner and distinct
// collection + search type + queries (server/utils/compoundSearchStore.js);
// re-running a search moves it to the top instead of duplicating it.
const RECORDED_EVENT = 'pyxis:compound-search-recorded';

function authHeaders(extra = {}) {
  const token = getAuthToken();
  return { accept: 'application/json', ...extra, ...(token ? { Authorization: `Bearer ${token}` } : {}) };
}

/** Fire-and-forget: a failed save never blocks or fails the search itself. */
export function recordCompoundSearch(entry) {
  fetch(API_CONFIG.buildApiUrl('/compound-searches'), {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(entry),
  }).then(async (response) => {
    if (!response.ok) return;
    const payload = await response.json().catch(() => null);
    if (payload?.search) window.dispatchEvent(new CustomEvent(RECORDED_EVENT, { detail: payload.search }));
  }).catch((error) => console.warn('Search history was not updated:', error.message));
}

// History hands a saved search to Home, which may not be mounted yet (first
// visit) or may be mounted but hidden. Home takes it once when it becomes active.
let queuedRestore = null;
export function queueSavedSearchRestore(entry) { queuedRestore = entry; }
export function takeQueuedSavedSearch() {
  const entry = queuedRestore;
  queuedRestore = null;
  return entry;
}

const SOURCE_LABELS = Object.freeze({ both: 'RPX + VPX', open: 'ChEMBL' });
const COLLECTION_SHORT = Object.freeze({ stock: 'Stock', smallvirtual: 'Virtual', real: 'RPX', virtual: 'VPX' });
export function searchSourceLabel(source) {
  if (SOURCE_LABELS[source]) return SOURCE_LABELS[source];
  const collections = collectionsForSource(source);
  return collections.length ? collections.map((value) => COLLECTION_SHORT[value] || value).join(' + ') : source;
}

function relativeTime(iso) {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return '';
  const minutes = Math.round((Date.now() - then) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} d ago`;
  return new Date(then).toLocaleDateString();
}

// variant "card": compact list beside the Home query form (hidden while empty).
// variant "page": the History tab section, always shown so the store is findable.
export function SearchHistory({ active = true, onRestore, variant = 'card' }) {
  const isPage = variant === 'page';
  const [state, setState] = useState({ status: 'loading', items: [], total: 0 });
  const [limit, setLimit] = useState(isPage ? 20 : 8);
  const [filter, setFilter] = useState('');
  const [deleting, setDeleting] = useState('');

  const load = useCallback(async (signal) => {
    try {
      const params = new URLSearchParams({ limit: String(limit), ...(filter.trim() ? { search: filter.trim() } : {}) });
      const response = await fetch(`${API_CONFIG.buildApiUrl('/compound-searches')}?${params}`, { headers: authHeaders(), signal });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !Array.isArray(payload?.items)) {
        setState((previous) => ({ ...previous, status: 'unavailable' }));
        return;
      }
      setState({ status: 'ready', items: payload.items, total: payload.total ?? payload.items.length });
    } catch (error) {
      if (error.name !== 'AbortError') setState((previous) => ({ ...previous, status: 'unavailable' }));
    }
  }, [limit, filter]);

  useEffect(() => {
    if (!active) return undefined;
    const controller = new AbortController();
    const timer = window.setTimeout(() => load(controller.signal), filter ? 250 : 0);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [active, load, filter]);

  useEffect(() => {
    const refresh = () => load();
    window.addEventListener(RECORDED_EVENT, refresh);
    return () => window.removeEventListener(RECORDED_EVENT, refresh);
  }, [load]);

  const remove = async (searchId) => {
    setDeleting(searchId);
    try {
      const response = await fetch(API_CONFIG.buildApiUrl(`/compound-searches/${encodeURIComponent(searchId)}`), { method: 'DELETE', headers: authHeaders() });
      if (response.ok || response.status === 404) {
        setState((previous) => ({ ...previous, items: previous.items.filter((item) => item.searchId !== searchId), total: Math.max(0, previous.total - 1) }));
      }
    } finally {
      setDeleting('');
    }
  };

  const empty = state.status === 'ready' && state.total === 0 && !filter;
  if (!isPage && (state.status === 'unavailable' || empty)) return null;

  const headingId = isPage ? 'compound-search-history-heading' : 'search-history-heading';
  return (
    <section
      id={isPage ? 'compound-search-history' : undefined}
      aria-labelledby={headingId}
      className={isPage
        ? 'mb-8 scroll-mt-24 rounded-xl border border-blue-gray-100 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900'
        : 'rounded-2xl border border-slate-200 bg-white p-[1rem] shadow-sm dark:border-slate-700 sm:p-[1.25rem]'}
    >
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        {isPage
          ? <h2 id={headingId} className="text-lg font-semibold text-blue-gray-900 dark:text-white">Compound searches</h2>
          : <h2 id={headingId} className="text-sm font-semibold text-slate-900 dark:text-slate-50">Search history</h2>}
        <div className="flex items-baseline gap-4">
          {state.status === 'ready' && <span className="text-xs text-slate-500 dark:text-slate-400">{state.total} saved</span>}
          {isPage && <Link to="/dashboard/simulation" className="text-sm font-semibold text-brand-600 underline dark:text-brand-200">New search</Link>}
        </div>
      </div>
      {isPage && <p className="-mt-1 mb-3 text-xs text-slate-500 dark:text-slate-300">Every Home search is saved automatically: your 100 most recent distinct searches. Choose one to load it into Home.</p>}
      {isPage && state.status === 'unavailable' && <p role="alert" className="text-sm text-red-700 dark:text-red-300">Saved searches could not be loaded. Try again later.</p>}
      {isPage && empty && <p className="text-sm text-slate-600 dark:text-slate-300">No saved searches yet. Searches you run on Home appear here.</p>}
      {(state.total > 5 || filter) && (
        <input
          type="search"
          value={filter}
          onChange={(event) => setFilter(event.target.value.slice(0, 200))}
          placeholder="Filter by structure or ID…"
          aria-label="Filter search history"
          className="mb-2 h-8 w-full rounded-lg border border-slate-300 bg-white px-2 text-xs dark:border-slate-600"
        />
      )}
      {state.status === 'loading' && state.items.length === 0 && <p className="text-xs text-slate-500 dark:text-slate-400">Loading…</p>}
      {state.status === 'ready' && state.items.length === 0 && filter && <p className="text-xs text-slate-500 dark:text-slate-400">No saved search matches this filter.</p>}
      <ul className="-mx-2 flex flex-col">
        {state.items.map((item) => {
          const modeLabel = OWNED_SEARCH_MODES.find((option) => option.value === item.mode)?.label || item.mode;
          const extra = item.queries.length > 1 ? ` +${item.queries.length - 1}` : '';
          return (
            <li key={item.searchId} className="group flex items-start gap-1 rounded-lg px-2 py-1.5 hover:bg-slate-100 dark:hover:bg-slate-800/60">
              <button type="button" onClick={() => onRestore(item)} className="min-w-0 flex-1 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-500" title={`Load this search:\n${item.queries.join('\n')}`}>
                <span className="block truncate font-mono text-xs text-slate-900 dark:text-slate-50">{item.queries[0]}{extra && <span className="font-sans text-slate-500">{extra}</span>}</span>
                <span className="block truncate text-[11px] text-slate-500 dark:text-slate-400">
                  {searchSourceLabel(item.source)} · {modeLabel}{Number.isFinite(item.settings?.threshold) && item.mode === 'similarity' ? ` ≥ ${item.settings.threshold.toFixed(1)}` : ''} · {relativeTime(item.lastRunAt)}{item.runCount > 1 ? ` · ${item.runCount} runs` : ''}
                </span>
              </button>
              <button type="button" aria-label={`Delete saved search ${item.queries[0]}`} disabled={deleting === item.searchId} onClick={() => remove(item.searchId)}
                className={`shrink-0 rounded p-1 text-slate-400 transition-opacity hover:text-slate-900 disabled:opacity-40 dark:hover:text-slate-50 ${isPage ? '' : 'opacity-0 focus:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100'}`}>
                <XMarkIcon className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </li>
          );
        })}
      </ul>
      {state.status === 'ready' && state.total > state.items.length && limit < 100 && (
        <button type="button" onClick={() => setLimit((value) => Math.min(100, value + 20))} className="mt-1 text-xs font-medium text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-50">
          Show more
        </button>
      )}
    </section>
  );
}
