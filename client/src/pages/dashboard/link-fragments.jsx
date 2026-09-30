import { useEffect, useRef, useState } from 'react';
import { Fragment3DViewer } from '@/components/Fragment3DViewer';
import { API_CONFIG, getAuthToken } from '@/utils/constants';
import { linkFragmentsRequest } from '@/utils/linkFragmentsRequest';

const MAX_SDF_BYTES = 800000;
function request(endpoint, controller, body, timeout) {
  return linkFragmentsRequest(API_CONFIG.buildApiUrl(`/link-fragments/${endpoint}`), { controller, token: getAuthToken(), body, timeout });
}
function saveSdf(result) {
  const url = URL.createObjectURL(new Blob([result.sdf], { type: 'chemical/x-mdl-sdfile' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `pyxis-linker-${String(result.linkerId).replace(/[^a-zA-Z0-9_-]/g, '_')}-${String(result.conformerId).replace(/[^a-zA-Z0-9_-]/g, '_')}.sdf`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function LinkFragments() {
  const [status, setStatus] = useState(null);
  const [statusError, setStatusError] = useState('');
  const [fileName, setFileName] = useState('');
  const [sdf, setSdf] = useState('');
  const [fragments, setFragments] = useState([]);
  const [attachmentAtoms, setAttachmentAtoms] = useState([null, null]);
  const [maxRmsd, setMaxRmsd] = useState('0.75');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [search, setSearch] = useState(null);
  const [selectedResult, setSelectedResult] = useState(0);
  const activeRequest = useRef(null);
  const statusRequest = useRef(null);
  const revision = useRef(0);
  useEffect(() => {
    refreshStatus();
    return () => { revision.current++; activeRequest.current?.abort(); statusRequest.current?.abort(); };
  }, []);

  async function refreshStatus() {
    statusRequest.current?.abort();
    const controller = new AbortController();
    statusRequest.current = controller;
    setStatusError('');
    try { const data = await request('status', controller); if (statusRequest.current === controller && !controller.signal.aborted) setStatus(data); }
    catch (error) { if (statusRequest.current === controller && error.name !== 'AbortError') { setStatus(null); setStatusError(error.message); } }
  }
  function clearSearch() {
    activeRequest.current?.abort();
    activeRequest.current = null;
    setSearch(null);
    setError('');
    setSelectedResult(0);
    setBusy('');
  }
  function chooseAtom(fragmentIndex, number) {
    if (number && !fragments[fragmentIndex]?.atoms.some(atom => atom.number === number && atom.element !== 'H' && atom.element !== 'He')) return;
    clearSearch();
    setAttachmentAtoms(previous => previous.map((value, index) => index === fragmentIndex ? number || null : value));
  }
  async function upload(file) {
    const currentRevision = ++revision.current;
    clearSearch();
    setSdf('');
    setFragments([]);
    setAttachmentAtoms([null, null]);
    setFileName(file?.name || '');
    if (!file) return;
    if (file.size > MAX_SDF_BYTES) { setError('Upload an SDF file of at most 800 KB.'); return; }
    const controller = new AbortController();
    activeRequest.current = controller;
    setBusy('inspect');
    try {
      const text = await file.text();
      if (revision.current !== currentRevision || controller.signal.aborted) return;
      const data = await request('inspect', controller, { sdf: text });
      if (revision.current !== currentRevision || controller.signal.aborted) return;
      if (!Array.isArray(data?.fragments) || data.fragments.length !== 2 || data.fragments.some(fragment => !Array.isArray(fragment.atoms))) throw new Error('The query must contain exactly two molecular fragments.');
      setSdf(text);
      setFragments(data.fragments);
    } catch (error) { if (revision.current === currentRevision && error.name !== 'AbortError') setError(error.message); }
    finally { if (activeRequest.current === controller) { activeRequest.current = null; setBusy(''); } }
  }
  async function findLinkers() {
    clearSearch();
    const controller = new AbortController();
    activeRequest.current = controller;
    setBusy('search');
    try {
      const data = await request('search', controller, { sdf, attachmentAtoms, limit: 10, maxRmsd: Number(maxRmsd) }, 50000);
      if (activeRequest.current !== controller || controller.signal.aborted) return;
      if (!Array.isArray(data?.results)) throw new Error('The search returned an invalid result.');
      setSearch(data);
    } catch (error) { if (activeRequest.current === controller && error.name !== 'AbortError') setError(error.message); }
    finally { if (activeRequest.current === controller) { activeRequest.current = null; setBusy(''); } }
  }
  const validRmsd = Number.isFinite(Number(maxRmsd)) && Number(maxRmsd) >= 0.1 && Number(maxRmsd) <= 1;
  const result = search?.results[selectedResult];
  const limitations = search?.limitations || status?.limitations;
  return (
    <div className="mx-auto max-w-7xl space-y-6 pb-12">
      <div><h1 className="text-2xl font-bold text-slate-900 dark:text-white">Link Fragments</h1><p className="mt-2 text-sm text-slate-600 dark:text-slate-300">Find macrocyclic skeletons that connect two fragments in their uploaded 3D arrangement. Choose one attachment atom on each fragment.</p></div>
      <div className="rounded-xl border border-brand-200 bg-brand-50 p-4 text-sm text-blue-gray-700 dark:border-slate-700 dark:text-slate-100">
        <div className="flex flex-wrap items-center justify-between gap-3"><span>{statusError || (status ? status.available ? `Linker collection ready · ${Number(status.records || 0).toLocaleString()} conformers · ${Number(status.pairs || 0).toLocaleString()} attachment pairs` : 'Linker search is not available yet. You can inspect your fragments and choose attachment atoms.' : 'Checking linker collection…')}</span><button type="button" className="font-semibold underline" onClick={refreshStatus}>Check again</button></div>
        {status?.method && <p className="mt-2">Method: {status.method}</p>}
      </div>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900" aria-labelledby="fragment-query-heading">
          <h2 id="fragment-query-heading" className="text-lg font-semibold dark:text-white">1. Query fragments</h2>
          <label className="block text-sm font-medium dark:text-slate-200">Upload 3D SDF (two records, maximum 800 KB)<input type="file" accept=".sdf,chemical/x-mdl-sdfile" className="mt-2 block w-full rounded border border-slate-300 p-2 text-sm dark:border-slate-600" onChange={event => upload(event.target.files?.[0])} /></label>
          <p className="text-xs text-slate-500 dark:text-slate-300">V2000 SDF with two molecules in the same coordinate frame. Coordinates are preserved. {fileName && `File: ${fileName}`}</p>
          {busy === 'inspect' && <p role="status" className="text-sm dark:text-slate-200">Inspecting fragments…</p>}
          {sdf && <>
            <Fragment3DViewer querySdf={sdf} attachmentAtoms={attachmentAtoms} onAtomSelect={chooseAtom} />
            <p className="text-xs text-slate-500 dark:text-slate-300">Drag to rotate, scroll to zoom. Click a heavy atom or use the selectors below. Selected attachment atoms appear as orange and cyan spheres.</p>
            <div className="grid gap-3 sm:grid-cols-2">{fragments.map((fragment, index) => <label key={index} className="block text-sm font-medium dark:text-slate-200">Fragment {index + 1}{fragment.name ? ` · ${fragment.name}` : ''}<select aria-label={`Fragment ${index + 1} attachment atom`} className="mt-2 w-full rounded border border-slate-300 bg-white p-2 dark:border-slate-600 dark:bg-slate-800" value={attachmentAtoms[index] || ''} onChange={event => chooseAtom(index, Number(event.target.value))}><option value="">Choose attachment atom</option>{fragment.atoms.filter(atom => atom.element !== 'H' && atom.element !== 'He').map(atom => <option key={atom.number} value={atom.number}>Atom {atom.number} · {atom.element}</option>)}</select></label>)}</div>
          </>}
          <label className="block text-sm font-medium dark:text-slate-200">Maximum attachment fit RMSD (Å)<input type="number" min="0.1" max="1" step="0.05" value={maxRmsd} className="ml-3 w-24 rounded border border-slate-300 bg-white p-2 dark:border-slate-600 dark:bg-slate-800" onChange={event => { clearSearch(); setMaxRmsd(event.target.value); }} /></label>
          <p className="text-xs text-slate-500 dark:text-slate-300">A smaller RMSD requires a closer geometric fit. Choose carbon or nitrogen with an implicit hydrogen available. The search validates attachment chemistry; picking an atom does not guarantee it can accept a bond.</p>
          <button type="button" onClick={findLinkers} disabled={!status?.available || !sdf || attachmentAtoms.some(atom => !atom) || !validRmsd || !!busy} className="w-full rounded-lg bg-brand-500 px-4 py-3 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">{busy === 'search' ? 'Finding linkers…' : 'Find matching linkers'}</button>
          {busy && <button type="button" onClick={() => { revision.current++; clearSearch(); }} className="text-sm font-semibold underline dark:text-slate-200">Cancel request</button>}
          {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">{error}</p>}
        </section>
        <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900" aria-labelledby="fragment-results-heading">
          <h2 id="fragment-results-heading" className="text-lg font-semibold dark:text-white">2. Matching products</h2>
          {!search && <p className="text-sm text-slate-500 dark:text-slate-300">Upload fragments, select two attachment sites and search to see assembled candidate products.</p>}
          {search && <p className="text-sm text-slate-600 dark:text-slate-300">{search.results.length} results · {Number(search.candidatesScanned || 0).toLocaleString()} candidates scanned{search.candidatesAvailable != null ? ` of ${Number(search.candidatesAvailable).toLocaleString()} available` : ''}{search.truncated ? ' · scan limit reached; this is a partial search' : ''}</p>}
          {search?.results.length === 0 && <p role="status" className="text-sm dark:text-slate-200">No valid linker products matched these attachment sites and fit limit.</p>}
          {result && <>
            <label className="block text-sm font-medium dark:text-slate-200">Candidate<select className="mt-2 w-full rounded border border-slate-300 bg-white p-2 dark:border-slate-600 dark:bg-slate-800" value={selectedResult} onChange={event => setSelectedResult(Number(event.target.value))}>{search.results.map((item, index) => <option key={`${item.linkerId}-${item.conformerId}-${index}`} value={index}>{index + 1}. {item.linkerId} · conformer {item.conformerId} · RMSD {Number(item.rmsd).toFixed(3)} Å</option>)}</select></label>
            <Fragment3DViewer querySdf={sdf} productSdf={result.sdf} attachmentAtoms={attachmentAtoms} />
            <p className="text-xs text-slate-500 dark:text-slate-300">Green: assembled product. Gray: uploaded fragments in the same 3D frame. Fit RMSD: {Number(result.rmsd).toFixed(3)} Å. Linker attachment atoms: {result.linkerAtoms?.join(', ') || '—'}.</p>
            <button type="button" onClick={() => saveSdf(result)} className="rounded-lg bg-brand-500 px-4 py-2 font-semibold text-white">Download product SDF</button>
            {result.smiles && <p className="break-all font-mono text-xs text-slate-600 dark:text-slate-300">{result.smiles}</p>}
          </>}
        </section>
      </div>
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"><p className="font-semibold">About these results</p><p className="mt-1">Candidates are geometric and chemical starting points for review. They do not establish binding activity, synthesis feasibility or compound availability.</p>{limitations && <p className="mt-2">{Array.isArray(limitations) ? limitations.join(' ') : String(limitations)}</p>}</div>
    </div>
  );
}
export default LinkFragments;
