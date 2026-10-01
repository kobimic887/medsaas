import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Fragment3DViewer } from '@/components/Fragment3DViewer';
import { API_CONFIG, getAuthToken } from '@/utils/constants';
import {
  attachmentMappingLines, canUseResult, createJobPoller, defaultHydrogenChoice, formatCount, formatQuerySelection, hydrogenClickHint, hydrogenOptions, isActiveJob,
  isHydrogenElement, isTerminalJob, jobStatusLabel, markJobUnfollowable, pickResumableJob, pollFailureMessage, progressOf, receptorForView, receptorPocket, receptorValidationReady,
  refinementRows, restoreJobInput, resultFileName, resultReport, sdfCoordinates, selectionForAtom, selectionLabel, selectionPayload, selectionReady, unavailableReasons,
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
function saveSdf(text, fileName, type = 'chemical/x-mdl-sdfile') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const errorText = error => [error.message, ...(error.details || []).map(item => item?.message).filter(message => message && message !== error.message)].join(' ');
const atomTag = atom => `${atom.isotope ? atom.isotope : ''}${atom.element}${atom.charge ? (atom.charge > 0 ? `+${atom.charge > 1 ? atom.charge : ''}` : `−${atom.charge < -1 ? -atom.charge : ''}`) : ''}`;

export function LinkFragments() {
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedJobId = searchParams.get('job');
  const [status, setStatus] = useState(null);
  const [statusError, setStatusError] = useState('');
  const [fileName, setFileName] = useState('');
  const [queryInputKey, setQueryInputKey] = useState(0);
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
  // Restore the exact saved input when reopening a job; never overlay another upload.
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
  const [receptorValidation, setReceptorValidation] = useState({ state: 'idle' });
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
  const receptorRequest = useRef(null);
  const receptorReadRevision = useRef(0);
  const detailCache = useRef(new Map());
  const lastProductView = useRef(null);
  const revision = useRef(0);
  const jobRef = useRef(null);
  jobRef.current = job;
  const poller = useRef(null);
  if (!poller.current) poller.current = createJobPoller({
    interval: POLL_INTERVAL_MS,
    fetchJob: (id, controller) => request(`jobs/${encodeURIComponent(id)}?input=0`, controller, undefined, 20000).then(data => data?.job),
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
    clearQuery();
    refreshStatus();
    if (requestedJobId) openSavedJob({ id: requestedJobId });
    else resumeLatestJob();
    return () => {
      revision.current++;
      poller.current.stop();
      for (const ref of [activeRequest, statusRequest, detailRequest, refineRequest, cancelRequest, receptorRequest]) ref.current?.abort();
    };
  }, [requestedJobId]);

  // Changing either file aborts its preflight. The identity check also discards
  // late responses from servers that completed after the request was aborted.
  useEffect(() => {
    receptorRequest.current?.abort();
    setReceptorValidation({ state: receptor ? (sdf ? 'checking' : 'waiting') : 'idle' });
    if (!receptor || !sdf) return;
    const controller = new AbortController();
    receptorRequest.current = controller;
    request('receptor/inspect', controller, { sdf, receptorPdb: receptor.text }, 25000).then(data => {
      if (receptorRequest.current !== controller || controller.signal.aborted) return;
      if (data?.ok !== true) throw new Error('The receptor could not be validated.');
      setReceptorValidation({ state: 'valid', report: data.report, sdf, receptorPdb: receptor.text });
    }).catch(failure => {
      if (receptorRequest.current === controller && failure.name !== 'AbortError') setReceptorValidation({ state: 'invalid', error: errorText(failure) });
    });
    return () => controller.abort();
  }, [sdf, receptor]);

  const jobActive = isActiveJob(job);
  const locked = jobActive || refining || ['start', 'restore', 'receptor', 'inspect'].includes(busy);
  async function refreshStatus() {
    statusRequest.current?.abort();
    const controller = new AbortController();
    statusRequest.current = controller;
    setStatusError('');
    try { const data = await request('status', controller); if (statusRequest.current === controller && !controller.signal.aborted) setStatus(data); }
    catch (failure) { if (statusRequest.current === controller && failure.name !== 'AbortError') { setStatus(null); setStatusError(failure.message); } }
  }
  // Fresh visits resume only active work. Finished searches open from Home.
  // preferredId names the scan the service reported as already running.
  async function resumeLatestJob(preferredId) {
    const currentRevision = revision.current;
    const controller = new AbortController();
    activeRequest.current = controller;
    try {
      const data = await request('jobs', controller);
      if (revision.current !== currentRevision || activeRequest.current !== controller || poller.current.jobId) return;
      const jobs = Array.isArray(data?.jobs) ? data.jobs : [];
      const target = (preferredId && jobs.find(item => item?.id === preferredId)) || pickResumableJob(jobs);
      if (!target) return;
      activeRequest.current = null;
      await openSavedJob(target, preferredId !== undefined ? 'busy' : isActiveJob(target) ? 'running' : 'finished');
    } catch { /* Resuming is a convenience; status and search errors are reported elsewhere. */ }
    finally { if (activeRequest.current === controller) activeRequest.current = null; }
  }
  async function openSavedJob(target, reason = 'finished') {
    if (!target?.id) return;
    resetResults();
    const currentRevision = revision.current;
    const controller = new AbortController();
    activeRequest.current = controller;
    setBusy('restore');
    try {
      const data = await request(`jobs/${encodeURIComponent(target.id)}`, controller, undefined, 20000);
      const restored = restoreJobInput(data?.job);
      if (!restored) throw new Error('This saved search does not include its original input.');
      const inspection = await request('inspect', controller, { sdf: restored.sdf }, 25000);
      if (revision.current !== currentRevision || controller.signal.aborted) return;
      if (!Array.isArray(inspection?.fragments) || inspection.fragments.length !== 2) throw new Error('The saved query could not be inspected.');
      setSdf(restored.sdf); setJobQuerySdf(restored.sdf); setFileName('Saved search fragments');
      setFragments(inspection.fragments); setSelections(restored.selections);
      setEligibility({ state: inspection.eligibility === 'checked' ? 'checked' : 'unavailable', error: inspection.eligibilityError || '' });
      setMaxRmsd(String(restored.maxRmsd)); setLimit(String(restored.limit));
      receptorReadRevision.current++; setReceptor(restored.receptor); setReceptorError('');
      setReceptorInputKey(key => key + 1);
      setJob(data.job); setResumed(isActiveJob(data.job) ? reason === 'busy' ? 'busy' : 'running' : 'finished'); poller.current.start(target.id);
    } catch (failure) { if (revision.current === currentRevision && failure.name !== 'AbortError') setError(errorText(failure)); }
    finally { if (activeRequest.current === controller) { activeRequest.current = null; setBusy(''); } }
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
  function clearQuery() {
    resetResults(); clearReceptor();
    setSdf(''); setFragments([]); setSelections(EMPTY_SELECTIONS);
    setEligibility({ state: '', error: '' }); setAtomHint(''); setFileName('');
    setQueryInputKey(key => key + 1);
  }
  function newQuery() {
    if (locked || busy) return;
    clearQuery();
    setSearchParams(previous => { const next = new URLSearchParams(previous); next.delete('job'); return next; });
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
    if (locked || receptorError || !receptorValidationReady(receptor, sdf, receptorValidation)) return;
    resetResults();
    const controller = new AbortController();
    activeRequest.current = controller;
    setBusy('start');
    let ownerBusy = null;
    try {
      const data = await request('jobs', controller, { sdf, attachments: selections.map(selectionPayload), maxRmsd: Number(maxRmsd), limit: Number(limit), ...(receptor ? { receptorPdb: receptor.text } : {}) }, 25000);
      if (activeRequest.current !== controller || controller.signal.aborted) return;
      if (!data?.job?.id) throw new Error('The linker service did not return a search job.');
      setJob(data.job); setJobQuerySdf(sdf);
      poller.current.start(data.job.id);
    } catch (failure) {
      if (activeRequest.current !== controller || failure.name === 'AbortError') return;
      if (failure.status === 429 && failure.code === 'LINK_FRAGMENTS_OWNER_BUSY') {
        // This user already has a scan: show it (progress and Cancel) instead of a dead end.
        ownerBusy = { jobId: failure.jobId || null };
        setError(`${failure.message} It is shown under Linker candidates.`);
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
    receptorReadRevision.current++;
    receptorRequest.current?.abort(); refineRequest.current?.abort();
    setReceptor(null); setReceptorError(''); setReceptorValidation({ state: 'idle' });
    setReceptorInputKey(key => key + 1); // resets the file input so the same file can be chosen again
  }
  async function loadReceptor(file) {
    if (locked) return;
    resetResults(); clearReceptor();
    const readRevision = receptorReadRevision.current;
    if (!file) return;
    if (file.size > MAX_RECEPTOR_BYTES) { setReceptorError('The receptor PDB must be at most 5 MB.'); return; }
    setReceptorValidation({ state: 'reading' }); setBusy('receptor');
    try {
      const text = await file.text();
      if (readRevision !== receptorReadRevision.current) return;
      if (!/^(ATOM {2}|HETATM)/m.test(text)) throw new Error('No ATOM or HETATM records were found in this PDB file.');
      setReceptor({ name: file.name, text });
    } catch (failure) { if (readRevision === receptorReadRevision.current) { setReceptorError(failure.message); setReceptorValidation({ state: 'invalid' }); } }
    finally { if (readRevision === receptorReadRevision.current) setBusy(''); }
  }
  async function refine() {
    const target = detail, jobId = job?.id;
    if (!target || !jobId || refining || detailState.busy || !canUseResult(job, target.id, jobNotice) || !receptorValidationReady(receptor, sdf, receptorValidation)) return;
    refineRequest.current?.abort();
    const controller = new AbortController();
    refineRequest.current = controller;
    setRefining(true); setRefineError('');
    try {
      const data = await request(`jobs/${encodeURIComponent(jobId)}/results/${encodeURIComponent(target.id)}/refine`, controller, { forceField, ...(receptor ? { receptorPdb: receptor.text } : {}) }, REFINE_REQUEST_TIMEOUT_MS);
      if (refineRequest.current !== controller) return;
      const refinement = data?.refinement;
      if (!refinement?.ok || !refinement.sdf) throw new Error(refinement?.errors?.map(item => item.message).join(' ') || 'Refinement did not return a structure.');
      const updated = { ...target, refined: true, refinement, refinementReceptor: receptor?.name || null, refinementInput: { forceField, receptorPdb: receptor?.text || null } };
      detailCache.current.set(`${jobId}/${target.id}`, updated);
      setDetail(updated); setView('refined');
      setJob(previous => previous?.id === jobId ? { ...previous, results: previous.results?.map(item => item.id === target.id ? { ...item, refined: true } : item) } : previous);
    } catch (failure) {
      if (refineRequest.current === controller && failure.name !== 'AbortError') setRefineError(failure.code === 'REFINEMENT_BUSY' ? 'Another refinement is running. Try again in a moment.' : failure.code === 'REFINEMENT_TIMEOUT' ? `${failure.message || 'Refinement took too long and was stopped.'} Try UFF or refine without a receptor.` : errorText(failure));
    } finally { if (refineRequest.current === controller) { refineRequest.current = null; setRefining(false); } }
  }

  const results = job?.results || [];
  const firstResultId = results[0]?.id;
  const selectedRetained = results.some(item => item.id === selectedId);
  useEffect(() => {
    if (job?.id && firstResultId && !selectedRetained && !refining) selectResult(job.id, firstResultId);
  }, [job?.id, firstResultId, selectedRetained, refining]);
  const resultActionsReady = canUseResult(job, detail?.id, jobNotice) && !detailState.busy && !refining;
  const validRmsd = Number.isFinite(Number(maxRmsd)) && Number(maxRmsd) >= 0.1 && Number(maxRmsd) <= 1;
  const validLimit = Number.isInteger(Number(limit)) && Number(limit) >= 1 && Number(limit) <= 50;
  const canSearch = status?.available && sdf && selections.every(selectionReady) && validRmsd && validLimit && !locked && !busy && !receptorError && !['reading', 'checking'].includes(receptorValidation.state) && receptorValidationReady(receptor, sdf, receptorValidation);
  const label = jobStatusLabel(job);
  const progress = progressOf(job);
  const refinement = detail?.refinement?.ok ? detail.refinement : null;
  const shownSdf = view === 'refined' && refinement ? refinement.sdf : detail?.sdf;
  const displayedReceptorPdb = receptorForView(view, detail, receptor);
  const pocket = useMemo(() => displayedReceptorPdb && showReceptor && shownSdf ? receptorPocket(displayedReceptorPdb, sdfCoordinates(shownSdf), 8) : null, [displayedReceptorPdb, showReceptor, shownSdf]);
  const productAttachments = [1, 2].map(fragment => detail?.attachments?.find(item => item.fragment === fragment));
  const productView = detail ? {
    productSdf: shownSdf, receptorPdb: pocket?.pdb || '',
    attachmentAtoms: productAttachments.map(item => item?.atom || null), hydrogenAtoms: productAttachments.map(item => item?.removedHydrogenAtom || null),
    label: `${view === 'refined' && refinement ? 'Refined' : 'Original'} product and query fragments in their original 3D frame`,
  } : detailState.busy ? lastProductView.current : null;
  if (detail) lastProductView.current = productView;
  const resultsKnown = Array.isArray(job?.results);
  const eligibleAtoms = eligibility.state === 'checked' ? fragments.map(fragment => fragment.atoms.filter(atom => atom.eligible).map(atom => atom.number)) : null;
  const summary = results.find(item => item.id === selectedId);
  function downloadResult(kind) {
    // A locally disconnected scan may still be running on the server.
    if (!resultActionsReady || !detail || !summary) return;
    if (kind === 'report') saveSdf(JSON.stringify(resultReport(job, detail), null, 2), resultFileName(summary).replace(/\.sdf$/, '-report.json'), 'application/json');
    else if (kind === 'refined' && refinement) saveSdf(refinement.sdf, resultFileName(summary, refinement));
    else if (kind === 'original') saveSdf(detail.sdf, resultFileName(summary));
  }
  const refineStatus = status?.refinement;
  const limitations = status?.limitations;
  return (
    <div className="mx-auto max-w-7xl space-y-6 pb-12">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div><h1 className="text-2xl font-bold text-slate-900 dark:text-white">Link Fragments</h1><p className="mt-1 text-sm text-slate-600 dark:text-slate-300">Connect two 3D fragments with a macrocyclic linker.</p></div>
        <div className="flex items-center gap-4"><button type="button" onClick={newQuery} disabled={locked || !!busy} className="text-sm font-semibold text-brand-700 underline disabled:cursor-not-allowed disabled:opacity-50 dark:text-brand-200">New query</button><Link to="/dashboard/controlpanel#linker-history" className="text-sm font-semibold text-brand-700 underline dark:text-brand-200">Saved searches</Link></div>
      </header>
      {(statusError || status?.available === false) && <div role="alert" className={`flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-sm ${TONES.warning}`}><span>{statusError || 'Linker search is unavailable. You can still inspect your fragments.'}</span><button type="button" className="font-semibold underline" onClick={refreshStatus}>Check again</button></div>}
      <details className="rounded-lg border border-slate-200 px-4 py-3 text-sm dark:border-slate-700 dark:text-slate-200">
        <summary className="cursor-pointer font-medium">Collection and method</summary>
        <div className="mt-3 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2"><p>{status ? `${formatCount(status.records)} conformers · ${formatCount(status.pairs)} attachment pairs` : 'Checking linker collection…'}</p><button type="button" className="font-semibold underline" onClick={refreshStatus}>Check again</button></div>
          {status?.method && <p>{status.method}</p>}
          {refineStatus && <p>Refinement: {refineStatus.available ? `RDKit ${refineStatus.rdkitVersion || ''} · ${(refineStatus.forceFields || []).join(', ')}` : refineStatus.reason || 'unavailable'}</p>}
          <p>Candidates do not establish binding activity, synthesis feasibility or availability. Refinement is not equivalent to MOE refinement and does not estimate binding affinity or synthesis feasibility.</p>
          {limitations && <p className={muted}>{Array.isArray(limitations) ? limitations.join(' ') : String(limitations)}</p>}
        </div>
      </details>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <section className="min-w-0 space-y-4 rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900" aria-labelledby="fragment-query-heading">
          <h2 id="fragment-query-heading" className="text-lg font-semibold dark:text-white">1. Query fragments</h2>
          <label className="block text-sm font-medium dark:text-slate-200">Fragment SDF (two molecules)<input key={queryInputKey} type="file" accept=".sdf,chemical/x-mdl-sdfile" disabled={locked || !!busy} className="mt-2 block w-full rounded border border-slate-300 p-2 text-sm disabled:opacity-50 dark:border-slate-600" onChange={event => upload(event.target.files?.[0])} /></label>
          <p className={muted}>One 3D V2000 file containing both fragments in the same frame · up to 800 KB.{fileName && ` ${fileName}`}</p>
          <details className="space-y-2 rounded-lg border border-slate-200 p-3 dark:border-slate-700" open={!!receptor || !!receptorError || receptorValidation.state === 'reading'}>
            <summary className="cursor-pointer text-sm font-medium dark:text-slate-200">Include a receptor</summary>
            <p className={muted}>Ligand-free PDB in the fragments’ coordinate frame · up to 5 MB. Used for clash ranking and refinement.</p>
            <label className="block text-sm font-medium dark:text-slate-200">Receptor PDB (optional)<input key={receptorInputKey} type="file" accept=".pdb,chemical/x-pdb" disabled={locked || !!busy} className="mt-2 block w-full rounded border border-slate-300 p-2 text-sm dark:border-slate-600" onChange={event => loadReceptor(event.target.files?.[0])} /></label>
            {receptor && <p className="flex flex-wrap items-center gap-2 text-sm dark:text-slate-200">Receptor: {receptor.name}<button type="button" onClick={() => { resetResults(); clearReceptor(); }} disabled={locked || !!busy} className="font-semibold underline disabled:opacity-50">Remove receptor</button></p>}
            {receptorError && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{receptorError}</p>}
            {['reading', 'checking'].includes(receptorValidation.state) && <p role="status" className="text-sm dark:text-slate-200">Checking receptor coordinates and ligand overlap…</p>}
            {receptorValidation.state === 'waiting' && <p role="status" className={muted}>Upload query fragments to check that the receptor shares their coordinate frame.</p>}
            {receptorValidation.state === 'invalid' && receptorValidation.error && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{receptorValidation.error}</p>}
            {receptor && receptorValidationReady(receptor, sdf, receptorValidation) && <p role="status" className="text-sm text-emerald-700 dark:text-emerald-300">Receptor checked. Products will be ranked by clashes, then fit.</p>}
            {(receptorValidation.report?.warnings || []).map(warning => <p key={warning} className={muted}>{warning}</p>)}
          </details>
          {jobActive && <p className={muted}>Cancel the running search to change the query.</p>}
          {busy === 'inspect' && <p role="status" className="text-sm dark:text-slate-200">Inspecting fragments and attachment sites…</p>}
          {sdf && <>
            <Fragment3DViewer querySdf={sdf} attachmentAtoms={selections.map(selection => selection?.atom || null)} hydrogenAtoms={selections.map(selection => Number.isInteger(selection?.hydrogen) ? selection.hydrogen : null)} eligibleAtoms={eligibleAtoms} onAtomSelect={chooseFromViewer} />
            <p className={muted}>Click a green attachment site or use the selectors below. Drag to rotate; scroll to zoom.</p>
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
            <details className={muted}><summary className="cursor-pointer">Attachment help</summary><p className="mt-1">A search covers replacement of the selected hydrogen only. Click an explicit hydrogen to choose it; the replaced hydrogen is magenta. A different hydrogen requires another search. Surviving atoms keep their coordinates and original numbering.</p></details>
          </>}
          <details className="rounded-lg border border-slate-200 p-3 dark:border-slate-700"><summary className="cursor-pointer text-sm font-medium dark:text-slate-200">Search settings <span className="font-normal">· RMSD ≤ {maxRmsd} Å · keep {limit}</span></summary><div className="mt-3 flex flex-wrap gap-4">
            <label className="block text-sm font-medium dark:text-slate-200">Maximum attachment fit RMSD (Å)<input type="number" min="0.1" max="1" step="0.05" value={maxRmsd} disabled={locked} className={`ml-3 w-24 ${input}`} onChange={event => { resetResults(); setMaxRmsd(event.target.value); }} /></label>
            <label className="block text-sm font-medium dark:text-slate-200">Products to keep<input type="number" min="1" max="50" step="1" value={limit} disabled={locked} className={`ml-3 w-20 ${input}`} onChange={event => { resetResults(); setLimit(event.target.value); }} /></label>
          </div>
          <p className={`mt-2 ${muted}`}>Lower RMSD means a closer attachment fit. Keep 1–50 distinct products.</p></details>
          <button type="button" onClick={startSearch} disabled={!canSearch} className="w-full rounded-lg bg-brand-500 px-4 py-3 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">{busy === 'start' ? 'Starting search…' : jobActive ? 'Search running…' : 'Start linker search'}</button>
          {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">{error}</p>}
        </section>
        <section className="min-w-0 space-y-4 rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900" aria-labelledby="fragment-results-heading">
          <h2 id="fragment-results-heading" className="text-lg font-semibold dark:text-white">2. Linker candidates</h2>
          {busy === 'restore' && <p role="status" className="text-sm dark:text-slate-200">Restoring saved query and products…</p>}
          {!job && <p className="text-sm text-slate-500 dark:text-slate-300">Choose an attachment on each fragment, then start the search.</p>}
          {job && <div className={`space-y-3 rounded-lg border p-3 text-sm ${TONES[label.tone] || TONES.idle}`}>
            <div className="flex flex-wrap items-center justify-between gap-2"><p className="font-semibold" aria-live="polite">{label.title}</p>{jobActive && <button type="button" onClick={cancelSearch} disabled={busy === 'cancel'} className="rounded border border-current px-3 py-1 text-sm font-semibold disabled:opacity-50">{busy === 'cancel' ? 'Canceling…' : 'Cancel search'}</button>}</div>
            {jobActive ? <p>Live previews may change. Downloads and refinement unlock when the search finishes or you stop it.</p> : <p>{label.detail}</p>}
            <div role="progressbar" aria-label="Search progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress.percent} aria-valuetext={`${formatCount(progress.examined)} of ${formatCount(progress.total)} pairs examined`} className="h-2 w-full overflow-hidden rounded bg-white/70 dark:bg-slate-700"><div className="h-2 bg-brand-500 transition-[width]" style={{ width: `${progress.percent}%` }} /></div>
            <p className="text-xs font-medium">{progress.percent.toFixed(1)}% · {formatCount(progress.examined)} / {formatCount(progress.total)} pairs checked · {results.length} retained</p>
            <details className="text-xs"><summary className="cursor-pointer">Search details</summary><div className="mt-2 space-y-1"><p>{formatCount(progress.conformers)} conformers checked · {formatCount(progress.placements)} valid placements</p><p>{(job.query?.attachments || []).map(formatQuerySelection).join(' · ')}{job.query?.maxRmsd ? ` · RMSD ≤ ${job.query.maxRmsd} Å` : ''}{progress.window ? ` · distance window ${Number(progress.window.lo).toFixed(2)}–${Number(progress.window.hi).toFixed(2)} Å` : ''}</p></div></details>
            {resumed && <p className="text-xs">{resumed === 'busy' ? 'Your existing search is shown here.' : resumed === 'finished' ? 'Saved search reopened.' : 'Your running search has been restored.'}</p>}
            {jobNotice && (jobNotice.text || jobNotice.retry) && <div role={jobNotice.fatal ? 'alert' : 'status'} className="text-xs">{jobNotice.text}{jobNotice.retry && job?.id && <button type="button" className={`${jobNotice.text ? 'ml-2 ' : ''}font-semibold underline`} onClick={() => { setJobNotice(null); poller.current.start(job.id); }}>Check again</button>}</div>}
          </div>}
          {job && results.length === 0 && (jobActive || resultsKnown) && <p role="status" className="text-sm dark:text-slate-200">{jobActive ? 'No valid products yet.' : 'No valid linker products matched these attachment sites and fit limit in the pairs examined.'}</p>}
          {job && !jobActive && !resultsKnown && !jobNotice?.fatal && <p role="status" className="text-sm dark:text-slate-200">Loading products…</p>}
          {results.length > 0 && <ol className="max-h-72 space-y-1 overflow-y-auto" aria-label={receptor ? "Products ranked by receptor clash severity, then fit RMSD" : "Products ranked by fit RMSD"}>{results.map(item => <li key={item.id}><button type="button" aria-pressed={item.id === selectedId} onClick={() => selectResult(job.id, item.id)} disabled={refining} className={`w-full rounded-lg border px-3 py-2 text-left text-sm ${item.id === selectedId ? 'border-brand-500 bg-brand-50 dark:bg-slate-800' : 'border-slate-200 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800'} dark:text-slate-100`}>
            <span className="block truncate font-semibold">{item.rank}. {item.linkerId}{item.refined ? ' · refined' : ''}</span><span className="mt-1 block text-xs text-slate-500 dark:text-slate-300">Fit {Number(item.rmsd).toFixed(3)} Å{item.receptor ? ` · ${formatCount(item.receptor.clashes)} clashes (${formatCount(item.receptor.severeClashes)} severe)` : ''}</span>
          </button></li>)}</ol>}
          {detailState.busy && !productView && <p role="status" className="text-sm dark:text-slate-200">Loading product…</p>}
          {detailState.error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">{detailState.error}</p>}
          {detail && refinement && <fieldset className="inline-flex overflow-hidden rounded-lg border border-slate-300 text-sm dark:border-slate-600"><legend className="sr-only">Structure shown</legend>{['original', 'refined'].map(option => <button key={option} type="button" aria-pressed={view === option} onClick={() => setView(option)} className={`px-3 py-1 ${view === option ? 'bg-brand-500 text-white' : 'dark:text-slate-200'}`}>{option === 'original' ? 'Original placement' : `Refined (${refinement.forceField})`}</button>)}</fieldset>}
          {/* Mounted at a stable position so selecting another product reuses the WebGL viewer. */}
          {productView && <Fragment3DViewer querySdf={jobQuerySdf} {...productView} loading={detailState.busy ? 'Loading product…' : ''} />}
          {detail && selectedRetained && <>
            <p className={muted}>{jobActive ? 'Provisional preview · ' : ''}Green: product · gray: uploaded fragments{pocket?.atoms ? ' and receptor pocket' : ''}.</p>
            {receptor && <label className="flex items-center gap-2 text-sm dark:text-slate-200"><input type="checkbox" checked={showReceptor} onChange={event => setShowReceptor(event.target.checked)} />Show receptor pocket</label>}
            <details className="text-sm dark:text-slate-200"><summary className="cursor-pointer font-medium">Product details and atom mapping</summary><div className="mt-2 space-y-2"><p className={muted}>Conformer {detail.conformerId} · fit RMSD {Number(detail.rmsd).toFixed(3)} Å · {detail.heavyAtoms} heavy atoms{Number.isFinite(detail.minimumNonbondedRadiusRatio) ? ` · closest contact ${Number(detail.minimumNonbondedRadiusRatio).toFixed(2)} × radius sum` : ''}.</p><ul className="list-disc space-y-1 pl-5">{attachmentMappingLines(detail).map(line => <li key={line}>{line}</li>)}</ul>{Number.isInteger(detail.fragmentAtomCount) && <p className={muted}>Uploaded atoms are product atoms 1–{detail.fragmentAtomCount} and keep their coordinates.</p>}{detail.smiles && <p className="break-all font-mono text-xs">{detail.smiles}</p>}</div></details>
            <p className={muted}>Candidates need scientific review.</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => downloadResult('original')} disabled={!resultActionsReady} className="rounded-lg bg-brand-500 px-4 py-2 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">Download original SDF</button>
              <button type="button" onClick={() => downloadResult('report')} disabled={!resultActionsReady} className="rounded-lg border border-slate-300 px-4 py-2 font-semibold disabled:cursor-not-allowed disabled:opacity-50 dark:text-slate-100">Quality report</button>
              {refinement && <button type="button" onClick={() => downloadResult('refined')} disabled={!resultActionsReady} className="rounded-lg border border-brand-500 px-4 py-2 font-semibold text-brand-700 disabled:cursor-not-allowed disabled:opacity-50 dark:text-slate-100">Download refined SDF</button>}
            </div>
            {detail.receptor?.clashes > 0 && <p className={`rounded-lg p-2 text-sm ${TONES.warning}`}>Original placement: {formatCount(detail.receptor.clashes)} receptor clashes ({formatCount(detail.receptor.severeClashes)} severe).</p>}
            <section className="space-y-3 rounded-lg border border-slate-200 p-3 dark:border-slate-700" aria-labelledby="refinement-heading">
              <h3 id="refinement-heading" className="font-semibold dark:text-white">Refine this product</h3>
              <p className={muted}>Relax the linker; your uploaded atoms stay fixed. This does not predict binding.</p>
              <div className="flex flex-wrap items-end gap-3">
                <label className="block text-sm font-medium dark:text-slate-200">Force field<select className={`mt-1 block ${input}`} value={forceField} onChange={event => setForceField(event.target.value)}><option value="auto">Auto: MMFF94, then UFF</option><option value="MMFF94">MMFF94</option><option value="UFF">UFF</option></select></label>
                <p className={muted}>{receptor ? `Receptor ${receptor.name} will be used as excluded volume.` : 'No receptor included.'}</p>
              </div>
              <button type="button" onClick={refine} disabled={!resultActionsReady || refineStatus?.available === false || !receptorValidationReady(receptor, sdf, receptorValidation)} className="rounded-lg bg-brand-500 px-4 py-2 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">{refining ? 'Refining…' : refinement ? 'Refine again' : 'Refine product'}</button>
              {refineStatus?.available === false && <p className={muted}>Refinement is unavailable{refineStatus.reason ? `: ${refineStatus.reason}` : '.'}</p>}
              {refineError && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">{refineError}</p>}
              {refinement && <div className="space-y-2 text-sm dark:text-slate-200">
                {refinement.receptor?.clashesAfter > 0 && <p className={`rounded p-2 ${TONES.warning}`}>Refined product still has {formatCount(refinement.receptor.clashesAfter)} receptor clashes.</p>}
                {!refinement.converged && <p className="rounded bg-amber-50 p-2 text-amber-900 dark:bg-amber-950 dark:text-amber-100">Minimization did not converge. Review before use.</p>}
                <p className="font-medium">{refinement.forceField} · {refinement.converged ? 'converged' : 'not converged'}</p>
                <details><summary className="cursor-pointer font-medium">Refinement report</summary><div className="mt-2 space-y-2"><dl className="grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-2">{refinementRows(refinement).map(([name, value]) => <div key={name}><dt className="text-xs text-slate-500 dark:text-slate-400">{name}</dt><dd>{value}</dd></div>)}</dl>
                  <p className={muted}>Energies compare this product before and after cleanup, not binding affinity across molecules. RDKit keeps all uploaded fragment atoms (heavy atoms and uploaded explicit hydrogens) held fixed.</p>
                  {detail.refinementReceptor && <p className={muted}>Receptor: {detail.refinementReceptor}.</p>}
                  {[...(refinement.receptor?.warnings || []), ...(refinement.limitations || [])].map(text => <p key={text} className={muted}>{text}</p>)}
                  {refinement.method && <p className={muted}>{refinement.method}</p>}
                </div></details>
              </div>}
            </section>
          </>}
        </section>
      </div>

    </div>
  );
}
export default LinkFragments;
