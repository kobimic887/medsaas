import { useEffect, useRef, useState } from "react";
import { API_CONFIG, getAuthToken } from "@/utils/constants";

const PAGE_SIZE = 6;

function formatDate(iso) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return String(iso);
  }
}

function authHeaders(extra = {}) {
  const token = getAuthToken();
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...extra,
  };
}

/**
 * Saved private prediction history. Reopening never calls a provider — the run
 * (metadata + coordinates) is fetched from history storage. “Reuse inputs”
 * starts a fresh editable request from the stored inputs without touching the
 * saved run.
 */
export default function FoldHistoryPanel({ onOpen, onReuse }) {
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [editingName, setEditingName] = useState("");
  const [deleteArmedId, setDeleteArmedId] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const requestSeq = useRef(0);
  const searchTimer = useRef(null);

  const load = async ({ nextPage = page, nextSearch = search, quiet = false } = {}) => {
    const seq = requestSeq.current + 1;
    requestSeq.current = seq;
    if (!quiet) setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({
        page: String(nextPage),
        pageSize: String(PAGE_SIZE),
        ...(nextSearch ? { search: nextSearch } : {}),
      });
      const response = await fetch(
        API_CONFIG.buildApiUrl(`/folding-history?${params.toString()}`),
        { headers: authHeaders() }
      );
      if (response.status === 404 || response.status === 503) {
        // History is not configured for this environment (e.g. the live product
        // before this feature is promoted). Hide the panel instead of erroring.
        if (seq === requestSeq.current) {
          setItems([]);
          setTotal(0);
          setLoading(false);
        }
        return;
      }
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error || `HTTP error ${response.status}`);
      }
      const data = await response.json();
      if (seq !== requestSeq.current) return;
      setItems(data.items || []);
      setTotal(data.total || 0);
      setPage(data.page || 1);
    } catch (err) {
      if (seq !== requestSeq.current) return;
      setError(err.message);
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  };

  useEffect(() => {
    load({ quiet: true });
    return () => {
      requestSeq.current += 1;
      window.clearTimeout(searchTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const beginSearch = (value) => {
    setSearch(value);
    window.clearTimeout(searchTimer.current);
    searchTimer.current = window.setTimeout(() => {
      load({ nextPage: 1, nextSearch: value, quiet: true });
    }, 250);
  };

  const showBusy = async (runId, fn) => {
    setBusyId(runId);
    setNotice("");
    try {
      const message = await fn();
      if (message) setNotice(message);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  const handleRename = (run) => {
    const trimmed = editingName.trim();
    if (!trimmed) return;
    showBusy(run.runId, async () => {
      const response = await fetch(API_CONFIG.buildApiUrl(`/folding-history/${run.runId}`), {
        method: "PATCH",
        headers: authHeaders(),
        body: JSON.stringify({ name: trimmed }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error || `Rename failed (${response.status})`);
      }
      setEditingId(null);
      await load({ quiet: true });
      return "Renamed.";
    });
  };

  const handleDelete = (run) => {
    if (deleteArmedId !== run.runId) {
      setDeleteArmedId(run.runId);
      window.setTimeout(() => {
        setDeleteArmedId((current) => (current === run.runId ? null : current));
      }, 3500);
      return;
    }
    setDeleteArmedId(null);
    showBusy(run.runId, async () => {
      const response = await fetch(API_CONFIG.buildApiUrl(`/folding-history/${run.runId}`), {
        method: "DELETE",
        headers: authHeaders(),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error || `Delete failed (${response.status})`);
      }
      await load({ quiet: true });
      return "Deleted.";
    });
  };

  const startRename = (run) => {
    setEditingId(run.runId);
    setEditingName(run.name);
    setDeleteArmedId(null);
  };

  // A hard failure (network/auth) still leaves the form fully usable; the
  // panel reports the problem inline below the controls.
  return (
    <section aria-labelledby="fold-history-title" className="mt-6 rounded-xl border border-gray-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="fold-history-title" className="text-base font-semibold text-gray-800 dark:text-slate-100">
          Saved predictions
        </h3>
        <span className="text-xs text-gray-500 dark:text-slate-400" aria-live="polite">
          {notice || (loading ? "Loading history…" : `${total} saved run${total === 1 ? "" : "s"}`)}
        </span>
      </div>

      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
        <label className="sr-only" htmlFor="fold-history-search">
          Search saved predictions by name
        </label>
        <input
          id="fold-history-search"
          type="search"
          value={search}
          onChange={(e) => beginSearch(e.target.value)}
          placeholder="Search by run name or chains…"
          className="w-full rounded border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
        />
        <button
          type="button"
          onClick={() => load({ nextPage: 1, quiet: true })}
          className="shrink-0 rounded border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          Refresh
        </button>
      </div>

      {error && (
        <p role="alert" className="mt-2 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
          History problem: {error}
        </p>
      )}

      {!loading && items.length === 0 && (
        <p className="mt-4 rounded-lg border-2 border-dashed border-gray-200 px-4 py-6 text-center text-sm text-gray-400 dark:border-slate-700 dark:text-slate-500">
          {search
            ? `No saved runs match “${search}”.`
            : "No saved predictions yet. Successful predictions are saved here automatically."}
        </p>
      )}

      <ul className="mt-3 divide-y divide-gray-100 dark:divide-slate-800">
        {items.map((run) => {
          const editing = editingId === run.runId;
          const busy = busyId === run.runId;
          const demo = run.demo ? "Demo" : "Live";
          const providerLabel =
            run.source === "sample-structure"
              ? "Sample structure"
              : run.source === "demo-predict"
                ? "Demo fixture"
                : "OpenFold3";
          return (
            <li key={run.runId} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                {editing ? (
                  <div className="flex items-center gap-2">
                    <label className="sr-only" htmlFor={`rename-${run.runId}`}>
                      Run name
                    </label>
                    <input
                      id={`rename-${run.runId}`}
                      value={editingName}
                      maxLength={120}
                      onChange={(e) => setEditingName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleRename(run);
                        if (e.key === "Escape") setEditingId(null);
                      }}
                      className="w-full max-w-xs rounded border border-blue-400 px-2 py-1 text-sm dark:bg-slate-800 dark:text-slate-100"
                    />
                    <button
                      type="button"
                      onClick={() => handleRename(run)}
                      disabled={busy}
                      className="rounded bg-blue-600 px-2 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingId(null)}
                      className="rounded border border-gray-300 px-2 py-1 text-xs dark:border-slate-600 dark:text-slate-200"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <p className="truncate font-medium text-gray-800 dark:text-slate-100">{run.name}</p>
                )}
                <p className="mt-0.5 text-xs text-gray-500 dark:text-slate-400">
                  {formatDate(run.createdAt)} · {run.entitySummary || `prediction`} · {run.outputFormat.toUpperCase()} ·{" "}
                  <span className={demo === "Demo" ? "text-amber-600 dark:text-amber-400" : ""}>{providerLabel}</span>
                  {run.providerVersion ? ` · v${run.providerVersion}` : ""}
                </p>
              </div>

              <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => onOpen(run)}
                  disabled={busy}
                  className="rounded bg-blue-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  Open
                </button>
                <button
                  type="button"
                  onClick={() => onReuse(run)}
                  disabled={busy}
                  className="rounded border border-gray-300 px-2.5 py-1 text-xs text-gray-700 hover:bg-gray-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
                  title="Copy these inputs into a new editable request (the saved run is not changed)"
                >
                  Reuse inputs
                </button>
                <button
                  type="button"
                  onClick={() => startRename(run)}
                  disabled={busy}
                  className="rounded border border-gray-300 px-2.5 py-1 text-xs text-gray-700 hover:bg-gray-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  Rename
                </button>
                <button
                  type="button"
                  onClick={() => handleDelete(run)}
                  disabled={busy}
                  className={`rounded px-2.5 py-1 text-xs font-medium ${
                    deleteArmedId === run.runId
                      ? "bg-red-600 text-white hover:bg-red-700"
                      : "border border-red-200 text-red-600 hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950/40"
                  }`}
                >
                  {deleteArmedId === run.runId ? "Confirm delete" : "Delete"}
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      {totalPages > 1 && (
        <nav aria-label="Saved predictions pages" className="mt-3 flex items-center justify-between gap-2 border-t border-gray-100 pt-3 dark:border-slate-800">
          <button
            type="button"
            disabled={page <= 1 || loading}
            onClick={() => load({ nextPage: page - 1, quiet: true })}
            className="rounded border border-gray-300 px-3 py-1 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-40 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            ← Previous
          </button>
          <span className="text-xs text-gray-500 dark:text-slate-400">
            Page {page} of {totalPages}
          </span>
          <button
            type="button"
            disabled={page >= totalPages || loading}
            onClick={() => load({ nextPage: page + 1, quiet: true })}
            className="rounded border border-gray-300 px-3 py-1 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-40 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            Next →
          </button>
        </nav>
      )}

      <p className="mt-3 text-xs text-gray-400 dark:text-slate-500">
        Predictions are private to your account. Reopening a saved run does not call a provider or use a prediction credit.
      </p>
    </section>
  );
}
