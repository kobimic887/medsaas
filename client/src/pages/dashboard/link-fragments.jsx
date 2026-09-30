import { useEffect, useMemo, useRef, useState } from 'react';
import { Fragment3DViewer } from '@/components/Fragment3DViewer';
import { API_CONFIG, getAuthToken } from '@/utils/constants';
import {
  attachmentMappingLines, createJobPoller, defaultHydrogenChoice, formatCount, formatQuerySelection, hydrogenClickHint, hydrogenOptions, isActiveJob,
  isHydrogenElement, isTerminalJob, jobStatusLabel, markJobUnfollowable, pickRecentJob, pickResumableJob, pollFailureMessage, progressOf, receptorPocket,
  refinementRows, resultFileName, sdfCoordinates, selectionForAtom, selectionLabel, selectionPayload, selectionReady, unavailableReasons,
} from '@/utils/linkFragmentsJobs';
import { linkFragmentsRequest, REFINE_REQUEST_TIMEOUT_MS } from '@/utils/linkFragmentsRequest';

const MAX_SDF_BYTES = 800000;
const MAX_RECEPTOR_BYTES = 5 * 1024 * 1024;
const POLL_INTERVAL_MS = 1750;
const EMPTY_SELECTIONS = [null, null];
const input = 'rounded border border-slate-300 bg-white p-2 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100';
const muted = 'text-xs text-slate-500 dark:text-slate-300';
const TONES = {
  success: 'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-100',
  info: 'border-brand-200 bg-brand-50 text-blue-gray-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100',
  warning: 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100',
  error: 'border-red-200 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-100',
  idle: 'border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100',
};
function request(endpoint, controller, body, timeout, method) {
  return linkFragmentsRequest(API_CONFIG.buildApiUrl(`/link-fragments/${endpoint}`), { controller, token: getAuthToken(), body, timeout, method });
}
function saveSdf(text, fileName) {
  const url = URL.createObjectURL(new Blob([text], { type: 'chemical/x-mdl-sdfile' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const errorText = error => [error.message, ...(error.details || []).map(item => item?.message).filter(message => message && message !== error.message)].join(' ');
const atomTag = atom => `${atom.isotope ? atom.isotope : ''}${atom.element}${atom.charge ? (atom.charge > 0 ? `+${atom.charge > 1 ? atom.charge : ''}` : `−${atom.charge < -1 ? -atom.charge : ''}`) : ''}`;

export function LinkFragments() {
  const [status, setStatus] = useState(null);
  const [statusError, setStatusError] = useState('');
  const [fileName, setFileName] = useState('');
  const [sdf, setSdf] = useState('');
  const [fragments, setFragments] = useState([]);
  const [eligibility, setEligibility] = useState({ state: '', error: '' });
  const [selections, setSelections] = useState(EMPTY_SELECTIONS);
  const [atomHint, setAtomHint] = useState('');
  const [maxRmsd, setMaxRmsd] = useState('0.75');
  const [limit, setLimit] = useState('20');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [job, setJob] = useState(null);
  // The SDF this page submitted for `job`; empty for a resumed or reopened job,
  // whose query text the service does not return (never overlay another upload).
  const [jobQuerySdf, setJobQuerySdf] = useState('');
  const [jobNotice, setJobNotice] = useState(null);
  // '' | 'running' (resumed) | 'finished' (reopened) | 'busy' (owner already had a scan).
  const [resumed, setResumed] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [detail, setDetail] = useState(null);
  const [detailState, setDetailState] = useState({ busy: false, error: '' });
  const [forceField, setForceField] = useState('auto');
  const [receptor, setReceptor] = useState(null);
  const [receptorError, setReceptorError] = useState('');
  const [receptorInputKey, setReceptorInputKey] = useState(0);
  const [showReceptor, setShowReceptor] = useState(true);
  const [refining, setRefining] = useState(false);
  const [refineError, setRefineError] = useState('');
  const [view, setView] = useState('original');
  const activeRequest = useRef(null);
  const statusRequest = useRef(null);
  const detailRequest = useRef(null);
  const refineRequest = useRef(null);
  const cancelRequest = useRef(null);
  const detailCache = useRef(new Map());
  const lastProductView = useRef(null);
  const revision = useRef(0);
  const jobRef = useRef(null);
  jobRef.current = job;
  const poller = useRef(null);
  if (!poller.current) poller.current = createJobPoller({
    interval: POLL_INTERVAL_MS,
    fetchJob: (id, controller) => request(`jobs/${encodeURIComponent(id)}`, controller, undefined, 20000).then(data => data?.job),
    onUpdate: next => { setJob(next); setJobNotice(null); },
    onError: (failure, { fatal }) => {
      if (!fatal) { setJobNotice({ fatal: false, text: `Could not check progress (${failure.message}). Retrying…` }); return; }
      // A job that cannot be followed becomes terminal locally so the form unlocks.
      const wasTerminal = isTerminalJob(jobRef.current);
      setJob(previous => markJobUnfollowable(previous, pollFailureMessage(failure)));
      setJobNotice({ fatal: true, retry: failure.status !== 404, text: wasTerminal ? `Products for this search could not be loaded: ${failure.status === 404 ? 'it is no longer available on the scientific service.' : failure.message}` : '' });
    },
  });
  useEffect(() => {
    refreshStatus();
    resumeLatestJob();
    return () => {
      revision.current++;
      poller.current.stop();
      for (const ref of [activeRequest, statusRequest, detailRequest, refineRequest, cancelRequest]) ref.current?.abort();
    };
  }, []);

  const jobActive = isActiveJob(job);
  const locked = jobActive || busy === 'start';
  async function refreshStatus() {
    statusRequest.current?.abort();
    const controller = new AbortController();
    statusRequest.current = controller;
    setStatusError('');
    try { const data = await request('status', controller); if (statusRequest.current === controller && !controller.signal.aborted) setStatus(data); }
    catch (failure) { if (statusRequest.current === controller && failure.name !== 'AbortError') { setStatus(null); setStatusError(failure.message); } }
  }
  // Background jobs survive navigation: pick up this user's newest running scan,
  // else reopen the newest finished one (one poll loads its retained products).
  // preferredId names the scan the service reported as already running.
  async function resumeLatestJob(preferredId) {
    const currentRevision = revision.current;
    const controller = new AbortController();
    activeRequest.current = controller;
    try {
      const data = await request('jobs', controller);
      if (revision.current !== currentRevision || activeRequest.current !== controller || poller.current.jobId) return;
      const jobs = Array.isArray(data?.jobs) ? data.jobs : [];
      const target = (preferredId && jobs.find(item => item?.id === preferredId)) || pickResumableJob(jobs) || (preferredId === undefined ? pickRecentJob(jobs) : null);
      if (!target) return;
      setJob(target); setJobQuerySdf(''); setResumed(preferredId !== undefined ? 'busy' : isActiveJob(target) ? 'running' : 'finished');
      poller.current.start(target.id);
    } catch { /* Resuming is a convenience; status and search errors are reported elsewhere. */ }
    finally { if (activeRequest.current === controller) activeRequest.current = null; }
  }
  // Any query change stops following the old job and clears its products so a
  // stale result is never shown against a different query.
  function resetResults() {
    revision.current++;
    poller.current.stop();
    for (const ref of [activeRequest, detailRequest, refineRequest, cancelRequest]) { ref.current?.abort(); ref.current = null; }
    detailCache.current.clear();
    lastProductView.current = null;
    setJob(null); setJobQuerySdf(''); setJobNotice(null); setResumed(''); setSelectedId(''); setDetail(null); setDetailState({ busy: false, error: '' });
    setRefining(false); setRefineError(''); setView('original'); setError(''); setBusy('');
  }
  function updateSelection(fragmentIndex, selection) {
    if (locked) return;
    resetResults();
    setSelections(previous => previous.map((value, index) => index === fragmentIndex ? selection : value));
  }
  function chooseAtom(fragmentIndex, number) {
    const atom = fragments[fragmentIndex]?.atoms.find(item => item.number === number && !isHydrogenElement(item.element));
    setAtomHint('');
    updateSelection(fragmentIndex, atom && atom.eligible !== false ? { atom: number, hydrogen: defaultHydrogenChoice(atom) } : null);
  }
  function chooseHydrogen(fragmentIndex, value) {
    const current = selections[fragmentIndex];
    if (!current || value === '') return;
    updateSelection(fragmentIndex, { atom: current.atom, hydrogen: value === 'implicit' || value === 'auto' ? value : Number(value) });
  }
  function chooseFromViewer(fragmentIndex, number) {
    if (locked) return;
    const fragment = fragments[fragmentIndex];
    const atom = fragment?.atoms.find(item => item.number === number);
    if (!atom) return;
    const selection = selectionForAtom(fragment, number);
    if (!selection) {
      setAtomHint(isHydrogenElement(atom.element) ? hydrogenClickHint(fragment, number, fragmentIndex) : `Fragment ${fragmentIndex + 1} atom ${number} (${atomTag(atom)}) cannot be used: ${atom.reason || 'not a supported attachment site.'}`);
      return;
    }
    setAtomHint(`Fragment ${fragmentIndex + 1}: ${selectionLabel(fragment, selection)}.`);
    updateSelection(fragmentIndex, selection);
  }
  async function upload(file) {
    if (locked) return;
    resetResults();
    clearReceptor(); // a receptor belongs to the previous query's frame
    const currentRevision = revision.current;
    setSdf(''); setFragments([]); setSelections(EMPTY_SELECTIONS); setEligibility({ state: '', error: '' }); setAtomHint('');
    setFileName(file?.name || '');
    if (!file) return;
    if (file.size > MAX_SDF_BYTES) { setError('Upload an SDF file of at most 800 KB.'); return; }
    const controller = new AbortController();
    activeRequest.current = controller;
    setBusy('inspect');
    try {
      const text = await file.text();
      if (revision.current !== currentRevision || controller.signal.aborted) return;
      const data = await request('inspect', controller, { sdf: text }, 25000);
      if (revision.current !== currentRevision || controller.signal.aborted) return;
      if (!Array.isArray(data?.fragments) || data.fragments.length !== 2 || data.fragments.some(fragment => !Array.isArray(fragment.atoms))) throw new Error('The query must contain exactly two molecular fragments.');
      setSdf(text);
      setFragments(data.fragments);
      setEligibility({ state: data.eligibility === 'checked' ? 'checked' : 'unavailable', error: data.eligibilityError || '' });
    } catch (failure) { if (revision.current === currentRevision && failure.name !== 'AbortError') setError(errorText(failure)); }
    finally { if (activeRequest.current === controller) { activeRequest.current = null; setBusy(''); } }
  }
  async function startSearch() {
    if (locked) return;
    resetResults();
    const controller = new AbortController();
    activeRequest.current = controller;
    setBusy('start');
    let ownerBusy = null;
    try {
      const data = await request('jobs', controller, { sdf, attachments: selections.map(selectionPayload), maxRmsd: Number(maxRmsd), limit: Number(limit) }, 25000);
      if (activeRequest.current !== controller || controller.signal.aborted) return;
      if (!data?.job?.id) throw new Error('The linker service did not return a search job.');
      setJob(data.job); setJobQuerySdf(sdf);
      poller.current.start(data.job.id);
    } catch (failure) {
      if (activeRequest.current !== controller || failure.name === 'AbortError') return;
      if (failure.status === 429 && failure.code === 'LINK_FRAGMENTS_OWNER_BUSY') {
        // This user already has a scan: show it (progress and Cancel) instead of a dead end.
        ownerBusy = { jobId: failure.jobId || null };
        setError(`${failure.message} It is shown under Matching products.`);
      } else setError(failure.code === 'LINK_FRAGMENTS_QUEUE_FULL' ? `${failure.message} Try again when a running search finishes.` : errorText(failure));
    } finally { if (activeRequest.current === controller) { activeRequest.current = null; setBusy(''); } }
    if (ownerBusy) resumeLatestJob(ownerBusy.jobId);
  }
  async function cancelSearch() {
    const id = job?.id;
    if (!id) return;
    cancelRequest.current?.abort();
    const controller = new AbortController();
    cancelRequest.current = controller;
    setBusy('cancel');
    try {
      const data = await request(`jobs/${encodeURIComponent(id)}/cancel`, controller, {}, 20000);
      if (cancelRequest.current !== controller) return;
      if (data?.job?.id === id) setJob(previous => previous?.id === id ? { ...data.job, results: data.job.results ?? previous.results } : previous);
      // One more poll collects the final partial results and terminal state.
      poller.current.start(id);
    } catch (failure) {
      if (cancelRequest.current !== controller || failure.name === 'AbortError') return;
      if (failure.status === 404) {
        // Already gone on the service: stop following it and unlock the form.
        poller.current.stop();
        setJob(previous => previous?.id === id ? markJobUnfollowable(previous) : previous); setJobNotice({ fatal: true, retry: false, text: '' });
      } else setError(`Could not cancel the search: ${failure.message}`);
    }
    finally { if (cancelRequest.current === controller) { cancelRequest.current = null; setBusy(''); } }
  }
  function selectResult(jobId, resultId) {
    detailRequest.current?.abort(); refineRequest.current?.abort(); refineRequest.current = null;
    setRefining(false); setRefineError(''); setSelectedId(resultId);
    const key = `${jobId}/${resultId}`;
    const cached = detailCache.current.get(key);
    if (cached) { setDetail(cached); setView(cached.refinement?.ok ? 'refined' : 'original'); setDetailState({ busy: false, error: '' }); return; }
    // The product viewer stays mounted on the previous product under a loading overlay.
    setDetail(null); setView('original');
    const controller = new AbortController();
    detailRequest.current = controller;
    setDetailState({ busy: true, error: '' });
    request(`jobs/${encodeURIComponent(jobId)}/results/${encodeURIComponent(resultId)}`, controller, undefined, 20000).then(data => {
      if (detailRequest.current !== controller) return;
      if (!data?.result?.sdf) throw new Error('The linker service returned an incomplete result.');
      detailCache.current.set(key, data.result);
      setDetail(data.result); setView(data.result.refinement?.ok ? 'refined' : 'original'); setDetailState({ busy: false, error: '' });
    }).catch(failure => {
      if (detailRequest.current === controller && failure.name !== 'AbortError') setDetailState({ busy: false, error: failure.status === 404 ? 'This product is no longer retained by the search. Choose another result.' : failure.message });
    }).finally(() => { if (detailRequest.current === controller) detailRequest.current = null; });
  }
  function clearReceptor() {
    refineRequest.current?.abort();
    setReceptor(null); setReceptorError('');
    setReceptorInputKey(key => key + 1); // resets the file input so the same file can be chosen again
  }
  async function loadReceptor(file) {
    setReceptorError('');
    refineRequest.current?.abort();
    if (!file) { setReceptor(null); return; }
    if (file.size > MAX_RECEPTOR_BYTES) { setReceptor(null); setReceptorError('The receptor PDB must be at most 5 MB.'); return; }
    const text = await file.text();
    if (!/^(ATOM {2}|HETATM)/m.test(text)) { setReceptor(null); setReceptorError('No ATOM or HETATM records were found in this PDB file.'); return; }
    setReceptor({ name: file.name, text });
  }
  async function refine() {
    const target = detail, jobId = job?.id;
    if (!target || !jobId) return;
    refineRequest.current?.abort();
    const controller = new AbortController();
    refineRequest.current = controller;
    setRefining(true); setRefineError('');
    try {
      const data = await request(`jobs/${encodeURIComponent(jobId)}/results/${encodeURIComponent(target.id)}/refine`, controller, { forceField, ...(receptor ? { receptorPdb: receptor.text } : {}) }, REFINE_REQUEST_TIMEOUT_MS);
      if (refineRequest.current !== controller) return;
      const refinement = data?.refinement;
      if (!refinement?.ok || !refinement.sdf) throw new Error(refinement?.errors?.map(item => item.message).join(' ') || 'Refinement did not return a structure.');
      const updated = { ...target, refined: true, refinement, refinementReceptor: receptor?.name || null };
      detailCache.current.set(`${jobId}/${target.id}`, updated);
      setDetail(updated); setView('refined');
    } catch (failure) {
      if (refineRequest.current === controller && failure.name !== 'AbortError') setRefineError(failure.code === 'REFINEMENT_BUSY' ? 'Another refinement is running. Try again in a moment.' : failure.code === 'REFINEMENT_TIMEOUT' ? `${failure.message || 'Refinement took too long and was stopped.'} Try UFF or refine without a receptor.` : errorText(failure));
    } finally { if (refineRequest.current === controller) { refineRequest.current = null; setRefining(false); } }
  }

  const results = job?.results || [];
  const firstResultId = results[0]?.id;
  useEffect(() => { if (job?.id && firstResultId && !selectedId) selectResult(job.id, firstResultId); }, [job?.id, firstResultId, selectedId]);
  const validRmsd = Number.isFinite(Number(maxRmsd)) && Number(maxRmsd) >= 0.1 && Number(maxRmsd) <= 1;
  const validLimit = Number.isInteger(Number(limit)) && Number(limit) >= 1 && Number(limit) <= 50;
  const canSearch = status?.available && sdf && selections.every(selectionReady) && validRmsd && validLimit && !locked && !busy;
  const label = jobStatusLabel(job);
  const progress = progressOf(job);
  const refinement = detail?.refinement?.ok ? detail.refinement : null;
  const shownSdf = view === 'refined' && refinement ? refinement.sdf : detail?.sdf;
  const pocket = useMemo(() => receptor && showReceptor && shownSdf ? receptorPocket(receptor.text, sdfCoordinates(shownSdf), 8) : null, [receptor, showReceptor, shownSdf]);
  const productAttachments = [1, 2].map(fragment => detail?.attachments?.find(item => item.fragment === fragment));
  const productView = detail ? {
    productSdf: shownSdf, receptorPdb: pocket?.pdb || '',
    attachmentAtoms: productAttachments.map(item => item?.atom || null), hydrogenAtoms: productAttachments.map(item => item?.removedHydrogenAtom || null),
    label: `${view === 'refined' && refinement ? 'Refined' : 'Original'} product and query fragments in their original 3D frame`,
  } : detailState.busy ? lastProductView.current : null;
  if (detail) lastProductView.current = productView;
  const resultsKnown = Array.isArray(job?.results);
  const eligibleAtoms = eligibility.state === 'checked' ? fragments.map(fragment => fragment.atoms.filter(atom => atom.eligible).map(atom => atom.number)) : null;
  const summary = results.find(item => item.id === selectedId) || detail;
  const refineStatus = status?.refinement;
  const limitations = status?.limitations;
  return (
    <div className="mx-auto max-w-7xl space-y-6 pb-12">
      <div><h1 className="text-2xl font-bold text-slate-900 dark:text-white">Link Fragments</h1><p className="mt-2 text-sm text-slate-600 dark:text-slate-300">Find macrocyclic skeletons that connect two fragments in their uploaded 3D arrangement. Choose one attachment atom on each fragment; every distance-compatible linker pair is examined in the background.</p></div>
      <div className="rounded-xl border border-brand-200 bg-brand-50 p-4 text-sm text-blue-gray-700 dark:border-slate-700 dark:text-slate-100">
        <div className="flex flex-wrap items-center justify-between gap-3"><span>{statusError || (status ? status.available ? `Linker collection ready · ${formatCount(status.records)} conformers · ${formatCount(status.pairs)} attachment pairs${status.jobs ? ` · ${formatCount(status.jobs.running)} running, ${formatCount(status.jobs.queued)} queued searches` : ''}` : 'Linker search is not available yet. You can inspect your fragments and choose attachment atoms.' : 'Checking linker collection…')}</span><button type="button" className="font-semibold underline" onClick={refreshStatus}>Check again</button></div>
        {status?.method && <p className="mt-2">Method: {status.method}</p>}
        {refineStatus && <p className="mt-1">Refinement: {refineStatus.available ? `available (RDKit ${refineStatus.rdkitVersion || ''}; ${(refineStatus.forceFields || []).join(', ')})` : `unavailable${refineStatus.reason ? ` — ${refineStatus.reason}` : ''}`}</p>}
      </div>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900" aria-labelledby="fragment-query-heading">
          <h2 id="fragment-query-heading" className="text-lg font-semibold dark:text-white">1. Query fragments</h2>
          <label className="block text-sm font-medium dark:text-slate-200">Upload 3D SDF (two records, maximum 800 KB)<input type="file" accept=".sdf,chemical/x-mdl-sdfile" disabled={locked} className="mt-2 block w-full rounded border border-slate-300 p-2 text-sm disabled:opacity-50 dark:border-slate-600" onChange={event => upload(event.target.files?.[0])} /></label>
          <p className={muted}>V2000 SDF with two molecules in the same coordinate frame. Coordinates, charges, isotopes and atom numbers are preserved. {fileName && `File: ${fileName}`}</p>
          <div className="space-y-1">
            <label className="block text-sm font-medium dark:text-slate-200">Receptor PDB (optional: pocket display and refinement; ligand-free, same frame as the SDF, ≤ 5 MB)<input key={receptorInputKey} type="file" accept=".pdb,chemical/x-pdb" className="mt-2 block w-full rounded border border-slate-300 p-2 text-sm dark:border-slate-600" onChange={event => loadReceptor(event.target.files?.[0])} /></label>
            {receptor && <p className="flex flex-wrap items-center gap-2 text-sm dark:text-slate-200">Receptor: {receptor.name}<button type="button" onClick={clearReceptor} className="font-semibold underline">Remove receptor</button></p>}
            {receptorError && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{receptorError}</p>}
            <p className={muted}>Uploading a new SDF clears the receptor.</p>
          </div>
          {locked && <p className={muted}>Cancel the running search to change the query.</p>}
          {busy === 'inspect' && <p role="status" className="text-sm dark:text-slate-200">Inspecting fragments and attachment sites…</p>}
          {sdf && <>
            <Fragment3DViewer querySdf={sdf} attachmentAtoms={selections.map(selection => selection?.atom || null)} hydrogenAtoms={selections.map(selection => Number.isInteger(selection?.hydrogen) ? selection.hydrogen : null)} eligibleAtoms={eligibleAtoms} onAtomSelect={chooseFromViewer} />
            <p className={muted}>Drag to rotate, scroll to zoom. Small green spheres mark eligible attachment atoms. Click a heavy atom to select it, or click an explicit hydrogen to replace that hydrogen. Selected atoms appear as orange and cyan spheres; the hydrogen to be replaced is magenta.</p>
            {atomHint && <p role="status" className="text-sm text-slate-700 dark:text-slate-200">{atomHint}</p>}
            {eligibility.state === 'unavailable' && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100">{eligibility.error || 'Attachment eligibility could not be checked.'} All heavy atoms are listed; the search validates your choice.</p>}
            <div className="grid gap-4 sm:grid-cols-2">{fragments.map((fragment, index) => {
              const selection = selections[index];
              const atom = fragment.atoms.find(item => item.number === selection?.atom);
              const options = hydrogenOptions(atom);
              const reasons = unavailableReasons(fragment);
              return (
                <fieldset key={index} className="space-y-2 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                  <legend className="px-1 text-sm font-semibold dark:text-slate-100">Fragment {index + 1}{fragment.name ? ` · ${fragment.name}` : ''}</legend>
                  <label className="block text-sm font-medium dark:text-slate-200">Attachment atom<select aria-label={`Fragment ${index + 1} attachment atom`} disabled={locked} className={`mt-1 w-full ${input}`} value={selection?.atom || ''} onChange={event => chooseAtom(index, Number(event.target.value))}>
                    <option value="">Choose attachment atom</option>
                    {fragment.atoms.filter(item => !isHydrogenElement(item.element)).map(item => <option key={item.number} value={item.number} disabled={item.eligible === false}>Atom {item.number} · {atomTag(item)}{item.eligible === false ? ` — unavailable: ${item.reason || 'not supported'}` : item.explicitHydrogens?.length ? ` · explicit H ${item.explicitHydrogens.join(', ')}` : ''}</option>)}
                  </select></label>
                  {atom && (options.length > 1 || selection.hydrogen == null) && <label className="block text-sm font-medium dark:text-slate-200">Hydrogen to replace<select aria-label={`Fragment ${index + 1} hydrogen to replace`} disabled={locked} className={`mt-1 w-full ${input}`} value={selection.hydrogen == null ? '' : String(selection.hydrogen)} onChange={event => chooseHydrogen(index, event.target.value)}>{selection.hydrogen == null && <option value="">Choose hydrogen to replace</option>}{options.map(option => <option key={option.value} value={String(option.value)}>{option.label}</option>)}</select></label>}
                  <p className={muted}>{selectionLabel(fragment, selection)}</p>
                  {reasons.length > 0 && <details className="text-xs text-slate-600 dark:text-slate-300"><summary className="cursor-pointer font-medium">Why atoms are unavailable ({reasons.reduce((total, group) => total + group.atoms.length, 0)})</summary><ul className="mt-1 list-disc space-y-1 pl-5">{reasons.map(group => <li key={group.reason}>Atom{group.atoms.length > 1 ? 's' : ''} {group.atoms.join(', ')}: {group.reason}</li>)}</ul></details>}
                </fieldset>
              );
            })}</div>
            <p className={muted}>A search covers replacement of the selected hydrogen only. To try a different hydrogen on the same atom, run another search.</p>
          </>}
          <div className="flex flex-wrap gap-4">
            <label className="block text-sm font-medium dark:text-slate-200">Maximum attachment fit RMSD (Å)<input type="number" min="0.1" max="1" step="0.05" value={maxRmsd} disabled={locked} className={`ml-3 w-24 ${input}`} onChange={event => { resetResults(); setMaxRmsd(event.target.value); }} /></label>
            <label className="block text-sm font-medium dark:text-slate-200">Products to keep<input type="number" min="1" max="50" step="1" value={limit} disabled={locked} className={`ml-3 w-20 ${input}`} onChange={event => { resetResults(); setLimit(event.target.value); }} /></label>
          </div>
          <p className={muted}>A smaller RMSD requires a closer geometric fit. The search keeps the best distinct products (1–50) and validates attachment chemistry again before fitting.</p>
          <button type="button" onClick={startSearch} disabled={!canSearch} className="w-full rounded-lg bg-brand-500 px-4 py-3 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">{busy === 'start' ? 'Starting search…' : jobActive ? 'Search running…' : 'Start linker search'}</button>
          {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">{error}</p>}
        </section>
        <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900" aria-labelledby="fragment-results-heading">
          <h2 id="fragment-results-heading" className="text-lg font-semibold dark:text-white">2. Matching products</h2>
          {!job && <p className="text-sm text-slate-500 dark:text-slate-300">Upload fragments, select two attachment sites and start a search. Products appear here while the search runs.</p>}
          {job && <div className={`space-y-3 rounded-lg border p-3 text-sm ${TONES[label.tone] || TONES.idle}`}>
            <div className="flex flex-wrap items-center justify-between gap-2"><p className="font-semibold" aria-live="polite">{label.title}</p>{jobActive && <button type="button" onClick={cancelSearch} disabled={busy === 'cancel'} className="rounded border border-current px-3 py-1 text-sm font-semibold disabled:opacity-50">{busy === 'cancel' ? 'Canceling…' : 'Cancel search'}</button>}</div>
            <p>{label.detail}</p>
            <div role="progressbar" aria-label="Search progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress.percent} aria-valuetext={`${formatCount(progress.examined)} of ${formatCount(progress.total)} pairs examined`} className="h-2 w-full overflow-hidden rounded bg-white/70 dark:bg-slate-700"><div className="h-2 bg-brand-500 transition-[width]" style={{ width: `${progress.percent}%` }} /></div>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
              <div><dt className="opacity-75">Pairs examined</dt><dd className="font-semibold">{formatCount(progress.examined)} / {formatCount(progress.total)}</dd></div>
              <div><dt className="opacity-75">Progress</dt><dd className="font-semibold">{progress.percent.toFixed(1)} %</dd></div>
              <div><dt className="opacity-75">Conformers examined</dt><dd className="font-semibold">{formatCount(progress.conformers)}</dd></div>
              <div><dt className="opacity-75">Valid placements</dt><dd className="font-semibold">{formatCount(progress.placements)}</dd></div>
            </dl>
            <p className="text-xs opacity-80">{(job.query?.attachments || []).map(formatQuerySelection).join(' · ')}{job.query?.maxRmsd ? ` · RMSD ≤ ${job.query.maxRmsd} Å` : ''}{job.query?.limit ? ` · keep ${job.query.limit}` : ''}{progress.window ? ` · anchor distance window ${Number(progress.window.lo).toFixed(2)}–${Number(progress.window.hi).toFixed(2)} Å` : ''}</p>
            {resumed && <p className="text-xs">{resumed === 'busy' ? 'You already have a search queued or running; it is shown here. Cancel it or wait for it to finish before starting another.' : resumed === 'finished' ? 'Reopened your most recent finished search; the label above states whether it examined every pair.' : 'Resumed your most recent running search.'} Its query fragments are not shown in the product view. Uploading an SDF starts a new query and removes this search from the page, so download any products you need first.</p>}
            {jobNotice && (jobNotice.text || jobNotice.retry) && <div role={jobNotice.fatal ? 'alert' : 'status'} className="text-xs">{jobNotice.text}{jobNotice.retry && job?.id && <button type="button" className={`${jobNotice.text ? 'ml-2 ' : ''}font-semibold underline`} onClick={() => { setJobNotice(null); poller.current.start(job.id); }}>Check again</button>}</div>}
          </div>}
          {job && results.length === 0 && (jobActive || resultsKnown) && <p role="status" className="text-sm dark:text-slate-200">{jobActive ? 'No valid products yet.' : 'No valid linker products matched these attachment sites and fit limit in the pairs examined.'}</p>}
          {job && !jobActive && !resultsKnown && !jobNotice?.fatal && <p role="status" className="text-sm dark:text-slate-200">Loading products…</p>}
          {results.length > 0 && <ol className="max-h-72 space-y-1 overflow-y-auto" aria-label="Products ranked by fit RMSD">{results.map(item => <li key={item.id}><button type="button" aria-pressed={item.id === selectedId} onClick={() => selectResult(job.id, item.id)} className={`w-full rounded-lg border px-3 py-2 text-left text-sm ${item.id === selectedId ? 'border-brand-500 bg-brand-50 dark:bg-slate-800' : 'border-slate-200 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800'} dark:text-slate-100`}>
            <span className="font-semibold">{item.rank}. Linker {item.linkerId} · conformer {item.conformerId}</span> · RMSD {Number(item.rmsd).toFixed(3)} Å · {item.heavyAtoms} heavy atoms{item.conformerMatches > 1 ? ` · ${item.conformerMatches} matching placements` : ''}{item.refined ? ' · refined' : ''}
            <span className="block truncate font-mono text-xs text-slate-500 dark:text-slate-300">{item.smiles}</span>
          </button></li>)}</ol>}
          {selectedId && results.length > 0 && !results.some(item => item.id === selectedId) && <p className={muted}>The selected product is no longer among the best retained results.</p>}
          {detailState.busy && !productView && <p role="status" className="text-sm dark:text-slate-200">Loading product…</p>}
          {detailState.error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">{detailState.error}</p>}
          {detail && refinement && <fieldset className="inline-flex overflow-hidden rounded-lg border border-slate-300 text-sm dark:border-slate-600"><legend className="sr-only">Structure shown</legend>{['original', 'refined'].map(option => <button key={option} type="button" aria-pressed={view === option} onClick={() => setView(option)} className={`px-3 py-1 ${view === option ? 'bg-brand-500 text-white' : 'dark:text-slate-200'}`}>{option === 'original' ? 'Original placement' : `Refined (${refinement.forceField})`}</button>)}</fieldset>}
          {/* Mounted at a stable position so selecting another product reuses the WebGL viewer. */}
          {productView && <Fragment3DViewer querySdf={jobQuerySdf} {...productView} loading={detailState.busy ? 'Loading product…' : ''} />}
          {detail && <>
            <p className={muted}>Green: {view === 'refined' && refinement ? 'refined' : 'assembled'} product{jobQuerySdf ? '. Gray: uploaded fragments in the same 3D frame' : ''}{pocket?.atoms ? `. Gray lines: ${formatCount(pocket.residues)} receptor residues within 8 Å` : ''}. Fit RMSD: {Number(detail.rmsd).toFixed(3)} Å{Number.isFinite(detail.minimumNonbondedRadiusRatio) ? ` · closest nonbonded contact ${Number(detail.minimumNonbondedRadiusRatio).toFixed(2)} × radius sum` : ''}. Linker attachment atoms: {detail.linkerAtoms?.join(', ') || '—'}.</p>
            {receptor && <label className="flex items-center gap-2 text-sm dark:text-slate-200"><input type="checkbox" checked={showReceptor} onChange={event => setShowReceptor(event.target.checked)} />Show receptor pocket ({receptor.name})</label>}
            <div className="text-sm dark:text-slate-200"><p className="font-semibold">Attachment mapping (original atom numbers)</p><ul className="mt-1 list-disc space-y-0.5 pl-5">{attachmentMappingLines(detail).map(line => <li key={line}>{line}</li>)}</ul>{Number.isInteger(detail.fragmentAtomCount) && <p className={`mt-1 ${muted}`}>Surviving uploaded atoms (heavy atoms and uploaded explicit hydrogens) are product atoms 1–{detail.fragmentAtomCount} in original order and keep their uploaded coordinates.</p>}</div>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => saveSdf(detail.sdf, resultFileName(summary || detail))} className="rounded-lg bg-brand-500 px-4 py-2 font-semibold text-white">Download product SDF</button>
              {refinement && <button type="button" onClick={() => saveSdf(refinement.sdf, resultFileName(summary || detail, refinement))} className="rounded-lg border border-brand-500 px-4 py-2 font-semibold text-brand-700 dark:text-slate-100">Download refined SDF</button>}
            </div>
            {detail.smiles && <p className="break-all font-mono text-xs text-slate-600 dark:text-slate-300">{detail.smiles}</p>}
            <section className="space-y-3 rounded-lg border border-slate-200 p-3 dark:border-slate-700" aria-labelledby="refinement-heading">
              <h3 id="refinement-heading" className="font-semibold dark:text-white">3. Refine geometry (optional)</h3>
              <p className={muted}>Force-field geometry cleanup only: RDKit minimization with all uploaded fragment atoms (heavy atoms and uploaded explicit hydrogens) held fixed and the linker free to move. It is not equivalent to MOE refinement and does not estimate binding affinity or synthesis feasibility.</p>
              <div className="flex flex-wrap items-end gap-3">
                <label className="block text-sm font-medium dark:text-slate-200">Force field<select className={`mt-1 block ${input}`} value={forceField} onChange={event => setForceField(event.target.value)}><option value="auto">Auto: MMFF94, then UFF</option><option value="MMFF94">MMFF94</option><option value="UFF">UFF</option></select></label>
                <p className={muted}>{receptor ? `Receptor ${receptor.name} will be used as excluded volume.` : 'No receptor loaded; add one under Query fragments to include it.'}</p>
              </div>
              <button type="button" onClick={refine} disabled={refining || refineStatus?.available === false} className="rounded-lg bg-brand-500 px-4 py-2 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">{refining ? 'Refining…' : refinement ? 'Refine again' : 'Refine product'}</button>
              {refineStatus?.available === false && <p className={muted}>Refinement is unavailable{refineStatus.reason ? `: ${refineStatus.reason}` : '.'}</p>}
              {refineError && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">{refineError}</p>}
              {refinement && <div className="space-y-2 text-sm dark:text-slate-200">
                {!refinement.converged && <p className="rounded bg-amber-50 p-2 text-amber-900 dark:bg-amber-950 dark:text-amber-100">The minimization did not converge; treat this geometry as unfinished.</p>}
                <dl className="grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2">{refinementRows(refinement).map(([name, value]) => <div key={name}><dt className="text-xs text-slate-500 dark:text-slate-400">{name}</dt><dd>{value}</dd></div>)}</dl>
                {detail.refinementReceptor !== undefined && <p className={muted}>{detail.refinementReceptor ? `Receptor used: ${detail.refinementReceptor}.` : 'No receptor was used for this refinement.'}</p>}
                {[...(refinement.receptor?.warnings || []), ...(refinement.limitations || [])].map(text => <p key={text} className={muted}>{text}</p>)}
                {refinement.method && <p className={muted}>Method: {refinement.method}</p>}
              </div>}
            </section>
          </>}
        </section>
      </div>
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"><p className="font-semibold">About these results</p><p className="mt-1">Candidates are geometric and chemical starting points for review. They do not establish binding activity, synthesis feasibility or compound availability. Only a search labelled complete has examined every distance-compatible linker pair.</p>{limitations && <p className="mt-2">{Array.isArray(limitations) ? limitations.join(' ') : String(limitations)}</p>}</div>
    </div>
  );
}
export default LinkFragments;
