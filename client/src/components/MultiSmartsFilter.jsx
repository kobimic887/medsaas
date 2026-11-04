import { useEffect, useId, useRef, useState } from 'react';
import { withAppBase } from '@/utils/appEnv';
import { MACROCYCLE_SMARTS_TEXT } from '@/data/macrocycleSmarts';
import { MAX_SMARTS_FILE_BYTES, MAX_SMARTS_ROWS, parseMultiSmarts, resultSmiles } from '@/utils/multiSmarts';

export function SmartsAnnotation({ result, index }) {
  const entry = result?.annotations[index];
  if (!entry) return null;
  const text = entry.state === 'unknown' ? 'SMARTS: unknown — structure could not be checked'
    : entry.state === 'no-match' ? 'SMARTS: no supplied pattern matched'
      : `SMARTS: ${entry.patternIndices.map((i) => result.patterns[i].label).join(', ')}`;
  return <div className="mt-1 whitespace-normal break-words text-xs text-violet-800 dark:text-violet-300">{text}</div>;
}

/** Filters one immutable snapshot of loaded rows; never launches a catalog scan. */
export function MultiSmartsFilter({ rows, active = true, onChange, onFilteringChange }) {
  const id = useId();
  const [text, setText] = useState(MACROCYCLE_SMARTS_TEXT);
  const [applied, setApplied] = useState(null);
  const [mode, setMode] = useState('annotate');
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [progress, setProgress] = useState(0);
  const fileRequest = useRef(0);

  useEffect(() => {
    onChange(result && result.rows === rows ? { ...result, mode } : null);
  }, [result, rows, mode, onChange]);

  useEffect(() => { onFilteringChange(Boolean(applied && mode !== 'annotate')); }, [applied, mode, onFilteringChange]);

  useEffect(() => {
    if (!active || !applied || !rows.length) return undefined;
    setResult(null);
    if (rows.length > MAX_SMARTS_ROWS) {
      setError('More than 2,000 results are loaded. Narrow the search before applying SMARTS; no subset was checked.');
      setStatus('');
      return undefined;
    }
    let worker;
    let cancelled = false;
    let deadline;
    const fail = (message) => {
      if (cancelled) return;
      clearTimeout(deadline);
      worker?.terminate();
      setError(message);
      setStatus('');
      setResult(null);
    };
    try {
      worker = new Worker(withAppBase('/workers/multi-smarts.js'));
      setStatus('Checking');
      setProgress(0);
      setError('');
      deadline = setTimeout(() => fail('SMARTS checking exceeded 30 seconds. Use fewer or more specific patterns. No partial filter was applied.'), 30_000);
      worker.onmessage = ({ data }) => {
        if (cancelled) return;
        if (data.type === 'progress') { setProgress(data.completed); return; }
        clearTimeout(deadline);
        worker.terminate();
        if (data.type === 'error') { fail(data.message); return; }
        if (data.type !== 'result' || !Array.isArray(data.annotations) || data.annotations.length !== rows.length) {
          fail('SMARTS checking returned an incomplete result; no filter was applied.');
          return;
        }
        setResult({ rows, patterns: applied, annotations: data.annotations });
        setStatus('Complete');
      };
      worker.onerror = () => fail('The local chemistry worker could not load. Please retry; no filter was applied.');
      worker.postMessage({ patterns: applied, rows: rows.map(resultSmiles) });
    } catch { fail('Your browser could not start local SMARTS matching; no filter was applied.'); }
    return () => { cancelled = true; clearTimeout(deadline); worker?.terminate(); };
  }, [rows, applied, active]);

  const apply = () => {
    try {
      const patterns = parseMultiSmarts(text);
      setApplied(patterns);
      setError('');
    } catch (reason) { setError(reason.message); }
  };
  const clear = () => {
    setApplied(null);
    setResult(null);
    setStatus('');
    setError('');
  };
  const importFile = async (event) => {
    const file = event.target.files?.[0];
    const request = ++fileRequest.current;
    event.target.value = '';
    if (!file) return;
    try {
      if (file.size > MAX_SMARTS_FILE_BYTES) throw new Error('Use a SMARTS text file no larger than 64 KB.');
      const imported = await file.text();
      const patterns = parseMultiSmarts(imported);
      if (request !== fileRequest.current) return;
      setText(imported);
      clear();
      setStatus(`Imported ${patterns.length} patterns. Select Apply to loaded results.`);
    } catch (reason) { if (request === fileRequest.current) setError(reason.message); }
  };
  const current = result?.rows === rows ? result : null;
  const unknown = current?.annotations.filter((entry) => entry.state === 'unknown').length || 0;
  return (
    <details className="mb-4 rounded-lg border border-violet-200 bg-white p-3 text-sm dark:border-slate-700 dark:bg-slate-900">
      <summary className="cursor-pointer font-semibold text-blue-gray-900 dark:text-slate-100">Macrocycle annotation · multi-SMARTS filter</summary>
      <p className="mt-2 text-xs text-blue-gray-600 dark:text-slate-300">
        Checks only the results already loaded below, not the full collection. The preset preserves all 58 supplied SMARTS (12–69-member labels).
        Labels describe the supplied queries; a match follows RDKit SMARTS ring semantics, not a universal definition of macrocycle.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button type="button" className="rounded border px-3 py-1" onClick={() => { setText(MACROCYCLE_SMARTS_TEXT); clear(); }}>Load macrocycle preset</button>
        <label htmlFor={`${id}-file`} className="text-xs font-semibold">Import SMARTS text file</label>
        <input id={`${id}-file`} type="file" accept=".txt,.smarts,.sma,text/plain" onChange={importFile} className="max-w-full text-xs" />
      </div>
      <label htmlFor={`${id}-patterns`} className="mt-3 block text-xs font-semibold">One SMARTS per line, optionally followed by a space and !!label (up to 100)</label>
      <textarea id={`${id}-patterns`} value={text} onChange={(event) => { setText(event.target.value); clear(); }} rows={4} spellCheck={false}
        className="mt-1 w-full rounded border border-blue-gray-200 bg-transparent p-2 font-mono text-xs dark:border-slate-600" />
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <button type="button" onClick={apply} disabled={!rows.length || status === 'Checking'} className="rounded bg-violet-700 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">Apply to loaded results</button>
        <label htmlFor={`${id}-mode`} className="text-xs font-semibold">Show</label>
        <select id={`${id}-mode`} value={mode} onChange={(event) => setMode(event.target.value)} className="rounded border bg-transparent p-1 text-xs">
          <option value="annotate">All rows with annotations</option>
          <option value="any">Matches to any pattern (OR)</option>
          <option value="all">Matches to every pattern (AND)</option>
        </select>
        <button type="button" onClick={clear} className="text-xs font-semibold underline">Clear annotation/filter</button>
      </div>
      {error && <p role="alert" className="mt-2 text-xs text-red-700 dark:text-red-300">{error}</p>}
      {status && <p role="status" className="mt-2 text-xs text-blue-gray-600 dark:text-slate-300">{status === 'Checking' ? `Checking ${progress}/${rows.length} loaded structures…` : status === 'Complete' && current ? `${applied.length} patterns checked against all ${rows.length} loaded results. ${unknown} unknown structures${mode === 'annotate' ? '.' : ' excluded by the filter.'} Newly loaded pages are checked again; old checks never apply to new rows.` : status}</p>}
      {applied && mode !== 'annotate' && <p className="mt-2 text-xs text-blue-gray-600 dark:text-slate-300">Select all affects visible rows only. Previously selected hidden rows remain selected for docking and ordering. Load more results manually to check another page.</p>}
    </details>
  );
}
