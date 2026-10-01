// Pure helpers for Link Fragments background searches: status wording, polling,
// attachment selections in ORIGINAL atom numbering and refinement reporting.
// Wording rule: only a job the service marks complete (state completed AND every
// distance-compatible pair examined) may be called complete. Canceled, failed,
// running and short-finished scans are always labelled partial.

export const isHydrogenElement = element => element === 'H' || element === 'D' || element === 'T';
export const TERMINAL_STATES = new Set(['completed', 'canceled', 'failed']);
export const isTerminalJob = job => TERMINAL_STATES.has(job?.state);
export const isActiveJob = job => job?.state === 'queued' || job?.state === 'running';
const count = value => Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0;
export const formatCount = value => count(value).toLocaleString('en-US');

export function isCompleteJob(job) {
  const total = count(job?.progress?.totalPairs);
  return job?.complete === true && job.state === 'completed' && count(job.progress?.examinedPairs) === total;
}

export function progressOf(job) {
  const progress = job?.progress || {};
  const total = count(progress.totalPairs), examined = Math.min(count(progress.examinedPairs), total);
  const complete = isCompleteJob(job);
  // Floor so an unfinished scan never rounds up to 100 %.
  let percent = total ? Math.floor((examined / total) * 1000) / 10 : complete ? 100 : 0;
  if (!complete && percent >= 100) percent = 99.9;
  return { total, examined, percent, complete, conformers: count(progress.conformersExamined), placements: count(progress.validPlacements), window: progress.distanceWindow || null };
}

export function jobStatusLabel(job) {
  if (!job) return { tone: 'idle', title: 'No search started', detail: '' };
  const { total, examined, percent, complete } = progressOf(job);
  const scanned = `${formatCount(examined)} of ${formatCount(total)} distance-compatible pairs examined`;
  if (job.state === 'queued') return { tone: 'info', title: 'Queued', detail: 'Waiting for a search worker. Nothing has been examined yet.' };
  // Titles change only with the state so screen readers are not flooded per poll.
  if (job.state === 'running') return { tone: 'info', title: 'Searching · partial results so far', detail: `${scanned} (${percent.toFixed(1)} %). Results so far are partial.` };
  if (job.state === 'completed' && complete) return { tone: 'success', title: 'Complete search', detail: `Complete search: all ${formatCount(total)} distance-compatible pairs examined.` };
  if (job.state === 'completed') return { tone: 'warning', title: 'Partial search', detail: `The search stopped with ${scanned}. Results are partial.` };
  if (job.state === 'canceled') return { tone: 'warning', title: 'Canceled · partial results', detail: `Canceled with ${scanned}. Results are partial.` };
  // A job this page could no longer follow (gone from the service or repeated
  // poll failures) is terminal locally so the form unlocks; it is never complete.
  if (job.state === 'failed' && job.local) return { tone: 'warning', title: 'No longer followed · partial results', detail: `${job.error?.message || UNAVAILABLE_JOB_MESSAGE} Last known progress: ${scanned}.` };
  if (job.state === 'failed') return { tone: 'error', title: 'Search failed · partial results', detail: `${job.error?.message ? `${job.error.message} ` : ''}Stopped with ${scanned}. Results are partial.` };
  return { tone: 'warning', title: 'Unknown search state', detail: 'Results are partial.' };
}

export function pickResumableJob(jobs) {
  if (!Array.isArray(jobs)) return null;
  return [...jobs].filter(isActiveJob).sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))[0] || null;
}
// Newest finished (completed, canceled or failed) job, so a scan that ended while
// the user was elsewhere can be reopened. Its label still decides complete vs partial.
export function pickRecentJob(jobs) {
  if (!Array.isArray(jobs)) return null;
  const finished = job => String(job.finishedAt || job.createdAt || '');
  return [...jobs].filter(isTerminalJob).sort((a, b) => finished(b).localeCompare(finished(a)))[0] || null;
}

export const UNAVAILABLE_JOB_MESSAGE = 'This search is no longer available on the scientific service; results shown are partial.';
export function pollFailureMessage(failure) {
  return failure?.status === 404 ? UNAVAILABLE_JOB_MESSAGE : `Stopped following this search (${failure?.message || 'the service did not answer'}); results shown are partial.`;
}
// Turn a job the page can no longer follow into a terminal local state. Without
// this a fatal poll error left it 'running' and the query form stayed locked.
export function markJobUnfollowable(job, message = UNAVAILABLE_JOB_MESSAGE) {
  if (!job || isTerminalJob(job)) return job;
  return { ...job, state: 'failed', complete: false, partial: true, local: true, error: { code: 'LINK_FRAGMENTS_JOB_UNAVAILABLE', message } };
}

// Poll one job until a terminal state, stop() or a fatal error. A generation
// counter discards responses that arrive after stop()/start() so a late poll
// can never overwrite a newer job or resurrect a stopped one.
export function createJobPoller({ fetchJob, onUpdate, onError = () => {}, interval = 1750, maxFailures = 5, schedule = (fn, ms) => setTimeout(fn, ms), unschedule = id => clearTimeout(id) }) {
  let generation = 0, timer = null, controller = null, failures = 0, jobId = null;
  const stop = () => {
    generation++; jobId = null;
    if (timer !== null) unschedule(timer);
    timer = null;
    controller?.abort(); controller = null;
  };
  const tick = async (id, gen) => {
    timer = null;
    const current = new AbortController();
    controller = current;
    try {
      const job = await fetchJob(id, current);
      if (gen !== generation) return;
      if (!job || job.id !== id) throw new Error('The search service returned an unexpected job.');
      failures = 0;
      onUpdate(job);
      if (gen !== generation) return;
      if (isTerminalJob(job)) { jobId = null; return; }
      timer = schedule(() => tick(id, gen), interval);
    } catch (error) {
      if (gen !== generation || error?.name === 'AbortError') return;
      failures++;
      const fatal = [400, 403, 404].includes(error?.status) || failures >= maxFailures;
      onError(error, { fatal, failures });
      if (fatal) { jobId = null; return; }
      timer = schedule(() => tick(id, gen), Math.min(interval * 2 ** failures, 15000));
    } finally { if (controller === current) controller = null; }
  };
  return {
    start(id) { stop(); jobId = id; failures = 0; tick(id, generation); },
    stop,
    get jobId() { return jobId; },
  };
}

// Selections: {atom, hydrogen} where hydrogen is 'implicit', 'auto' (engine
// default: implicit H when present, else its recommended explicit H) or the
// original number of an explicit H to replace.
export function defaultHydrogenChoice(atom) {
  if (!atom) return 'auto';
  if (atom.implicitHydrogens == null) return 'auto';
  if (atom.implicitHydrogens > 0) return 'implicit';
  // null = the user must pick which explicit H to replace before searching.
  if (atom.requiresHydrogenSelection) return atom.recommendedHydrogenAtom ?? null;
  return atom.recommendedHydrogenAtom ?? atom.explicitHydrogens?.[0] ?? 'auto';
}
export function hydrogenOptions(atom) {
  if (!atom) return [];
  const options = [];
  if (atom.implicitHydrogens == null) options.push({ value: 'auto', label: 'Automatic (implicit H if present, else recommended explicit H)' });
  else if (atom.implicitHydrogens > 0) options.push({ value: 'implicit', label: `Implicit H (${atom.implicitHydrogens} available)` });
  for (const h of atom.explicitHydrogens || []) options.push({ value: h, label: `Explicit H${h}${h === atom.recommendedHydrogenAtom ? ' (recommended)' : ''}` });
  return options;
}
export const selectionReady = selection => Number.isInteger(selection?.atom) && selection.hydrogen !== null && selection.hydrogen !== undefined;
export function selectionPayload(selection) {
  if (!selectionReady(selection)) return null;
  return Number.isInteger(selection.hydrogen) ? { atom: selection.atom, hydrogenAtom: selection.hydrogen } : selection.atom;
}
export function selectionForAtom(fragment, number) {
  const atom = fragment?.atoms?.find(item => item.number === number);
  if (!atom) return null;
  if (isHydrogenElement(atom.element)) {
    const parent = fragment.atoms.find(item => !isHydrogenElement(item.element) && item.explicitHydrogens?.includes(number));
    return parent && parent.eligible !== false ? { atom: parent.number, hydrogen: number } : null;
  }
  return atom.eligible === false ? null : { atom: number, hydrogen: defaultHydrogenChoice(atom) };
}
export function selectionLabel(fragment, selection) {
  if (!selection?.atom) return 'Not selected';
  const atom = fragment?.atoms?.find(item => item.number === selection.atom);
  const replaced = Number.isInteger(selection.hydrogen) ? `replaces explicit H${selection.hydrogen}` : selection.hydrogen === 'implicit' ? 'replaces an implicit H' : selection.hydrogen == null ? 'choose which hydrogen to replace' : 'hydrogen chosen by the search';
  return `Atom ${selection.atom}${atom ? ` · ${atom.element}` : ''} · ${replaced}`;
}
export function formatQuerySelection(selection, index) {
  const atom = typeof selection === 'object' && selection ? selection.atom : selection;
  if (!Number.isInteger(atom)) return `Fragment ${index + 1}: —`;
  return `Fragment ${index + 1} atom ${atom}${Number.isInteger(selection?.hydrogenAtom) ? ` (replacing H${selection.hydrogenAtom})` : ''}`;
}
// Heavy atom carrying an explicit hydrogen: the inspected explicitHydrogens list
// first, else the nearest heavy atom within 1.3 Å (a hydrogen the service does
// not offer, such as a charged or isotope-labelled one, is not listed there).
export function hydrogenParent(fragment, number) {
  const atoms = fragment?.atoms || [];
  const listed = atoms.find(item => !isHydrogenElement(item.element) && item.explicitHydrogens?.includes(number));
  if (listed) return listed;
  const hydrogen = atoms.find(item => item.number === number);
  if (!hydrogen || ![hydrogen.x, hydrogen.y, hydrogen.z].every(Number.isFinite)) return null;
  let best = null, bestDistance = 1.3 * 1.3;
  for (const item of atoms) {
    if (isHydrogenElement(item.element) || ![item.x, item.y, item.z].every(Number.isFinite)) continue;
    const distance = (item.x - hydrogen.x) ** 2 + (item.y - hydrogen.y) ** 2 + (item.z - hydrogen.z) ** 2;
    if (distance <= bestDistance) { best = item; bestDistance = distance; }
  }
  return best;
}
// Why a clicked hydrogen cannot start a selection: the parent's reason when the
// parent is ineligible, else that this hydrogen cannot be replaced automatically.
export function hydrogenClickHint(fragment, number, fragmentIndex = 0) {
  const prefix = `Fragment ${fragmentIndex + 1} hydrogen ${number}`;
  const hydrogen = fragment?.atoms?.find(item => item.number === number);
  const parent = hydrogenParent(fragment, number);
  if (!parent) return `${prefix} is not bonded to a heavy atom and cannot be replaced.`;
  const on = `${prefix} is on atom ${parent.number} (${parent.element})`;
  if (parent.eligible === false) return `${on}, which cannot be used: ${parent.reason || 'not a supported attachment site.'}`;
  const labelled = hydrogen && (hydrogen.charge || hydrogen.isotope || hydrogen.element !== 'H');
  const alternative = parent.implicitHydrogens > 0 || parent.explicitHydrogens?.length ? ` Choose atom ${parent.number} to replace one of its other hydrogens.` : '';
  return `${on}; this ${labelled ? 'charged or isotope-labelled ' : ''}hydrogen cannot be replaced automatically.${alternative}`;
}
export function unavailableReasons(fragment) {
  const groups = new Map();
  for (const atom of fragment?.atoms || []) {
    if (isHydrogenElement(atom.element) || atom.eligible !== false) continue;
    const reason = atom.reason || 'Not a supported attachment site.';
    groups.set(reason, [...(groups.get(reason) || []), atom.number]);
  }
  return [...groups].map(([reason, atoms]) => ({ reason, atoms }));
}

export function attachmentMappingLines(detail) {
  return (detail?.attachments || []).map(item => {
    const hydrogen = item.hydrogen === 'explicit' && item.removedHydrogenAtom ? `H${item.removedHydrogenAtom} replaced` : 'implicit H replaced';
    return `Fragment ${item.fragment} atom ${item.atom}${item.element ? ` ${item.element}` : ''} (${hydrogen}) → product atom ${item.productAtom ?? '—'}`;
  });
}
const safe = value => String(value ?? 'unknown').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 60);
export function resultFileName(result, refinement) {
  return `pyxis-linker-${safe(result?.linkerId)}-conformer-${safe(result?.conformerId)}${refinement ? `-refined-${safe(refinement.forceField)}` : ''}.sdf`;
}

const number = (value, digits) => Number.isFinite(Number(value)) && value !== null ? Number(value).toFixed(digits) : '—';
export const formatEnergy = (value, units = 'kcal/mol') => Number.isFinite(value) ? `${Number(value).toFixed(2)} ${units}` : '—';
// refine.py reports {forceField, atoms (1-based product atoms), elements, reason}.
export function formatUnsupported(item) {
  if (typeof item === 'string') return item;
  if (!item || typeof item !== 'object') return 'Unspecified';
  const list = value => (Array.isArray(value) ? value : []).filter(entry => typeof entry === 'string' || Number.isFinite(entry));
  const atoms = list(item.atoms), elements = list(item.elements);
  const where = [atoms.length ? `product atoms ${atoms.join(', ')}` : '', elements.length ? `elements ${elements.join(', ')}` : ''].filter(Boolean).join('; ');
  const text = typeof item.reason === 'string' && item.reason ? item.reason : typeof item.message === 'string' && item.message ? item.message : 'Missing parameters.';
  return `${typeof item.forceField === 'string' && item.forceField ? `${item.forceField}: ` : ''}${text}${where ? ` (${where})` : ''}`;
}
// Report rows keep failures and caveats visible; nothing here claims affinity.
export function refinementRows(refinement) {
  if (!refinement?.ok) return [];
  const units = refinement.energyUnits || 'kcal/mol';
  const rows = [
    ['Force field', `${refinement.forceField}${refinement.requestedForceField && refinement.requestedForceField !== refinement.forceField ? ` (requested ${refinement.requestedForceField})` : ''}`],
    ...(refinement.fallbackReason ? [['Fallback reason', refinement.fallbackReason]] : []),
    ['Converged', refinement.converged ? `Yes (${formatCount(refinement.iterations)} of ${formatCount(refinement.maxIterations)} iterations)` : `No — stopped after ${formatCount(refinement.iterations)} of ${formatCount(refinement.maxIterations)} iterations`],
    ['Force-field energy before', formatEnergy(refinement.initialEnergy, units)],
    ['Force-field energy after', formatEnergy(refinement.finalEnergy, units)],
    ...(Number.isFinite(refinement.restraintEnergy) ? [['Restraint energy (not included above)', formatEnergy(refinement.restraintEnergy, units)]] : []),
    ['Unsupported parameters', refinement.unsupported?.length ? refinement.unsupported.map(formatUnsupported).join('; ') : 'None reported'],
    ['Fixed uploaded atoms', `${formatCount(refinement.fixedAtoms?.count)} · max deviation ${number(refinement.fixedAtoms?.maxDeviation, 4)} Å`],
    ['Moved atoms', `${formatCount(refinement.moved?.atoms)} · RMSD ${number(refinement.moved?.rmsd, 3)} Å · max ${number(refinement.moved?.maxDisplacement, 3)} Å`],
    ['Stereochemistry preserved', refinement.stereo?.preserved === true ? 'Yes' : refinement.stereo?.preserved === false ? 'No — review the refined structure' : 'Not reported'],
  ];
  if (refinement.addedHydrogens) rows.push(['Hydrogens added for the force field', formatCount(refinement.addedHydrogens)]);
  const receptor = refinement.receptor;
  if (receptor) {
    rows.push(['Receptor atoms used', `${formatCount(receptor.atomsUsed)} of ${formatCount(receptor.atomsRead)} read${receptor.watersRemoved ? ` · ${formatCount(receptor.watersRemoved)} waters removed` : ''}`]);
    rows.push(['Receptor clashes before → after', `${formatCount(receptor.clashesBefore)} → ${formatCount(receptor.clashesAfter)}`]);
    rows.push(['Closest heavy-atom contact before → after', `${number(receptor.minHeavyDistanceBefore, 2)} → ${number(receptor.minHeavyDistanceAfter, 2)} Å`]);
    if (receptor.clashDefinition) rows.push(['Clash definition', receptor.clashDefinition]);
    if (receptor.hetGroups?.length) rows.push(['Receptor HET groups kept', receptor.hetGroups.join(', ')]);
  }
  return rows;
}

// Coordinates of every atom in a V2000 SDF text (all records).
export function sdfCoordinates(sdf) {
  const coordinates = [];
  for (const record of String(sdf || '').replaceAll('\r', '').split('$$$$')) {
    const lines = record.replace(/^\n/, '').split('\n');
    const counts = lines[3] || '';
    if (!counts.includes('V2000')) continue;
    const atoms = Number.parseInt(counts.slice(0, 3), 10) || 0;
    for (const line of lines.slice(4, 4 + atoms)) {
      const xyz = [0, 10, 20].map(start => Number(line.slice(start, start + 10)));
      if (xyz.every(Number.isFinite)) coordinates.push(xyz);
    }
  }
  return coordinates;
}
// Whole receptor residues with any atom within `cutoff` Å of the ligand, waters
// removed, for a light context display. The full file is still sent for refinement.
export function receptorPocket(pdb, ligand, cutoff = 8) {
  if (!pdb || !ligand?.length) return { pdb: '', residues: 0, atoms: 0 };
  const limit = cutoff * cutoff;
  const residues = new Map();
  for (const line of String(pdb).replaceAll('\r', '').split('\n')) {
    if (!/^(ATOM {2}|HETATM)/.test(line)) continue;
    const residueName = line.slice(17, 20).trim();
    if (residueName === 'HOH' || residueName === 'WAT' || residueName === 'DOD') continue;
    const xyz = [30, 38, 46].map(start => Number(line.slice(start, start + 8)));
    if (!xyz.every(Number.isFinite)) continue;
    const key = line.slice(17, 27);
    const residue = residues.get(key) || { lines: [], near: false };
    residue.lines.push(line);
    if (!residue.near) residue.near = ligand.some(point => (point[0] - xyz[0]) ** 2 + (point[1] - xyz[1]) ** 2 + (point[2] - xyz[2]) ** 2 <= limit);
    residues.set(key, residue);
  }
  const kept = [...residues.values()].filter(residue => residue.near);
  const lines = kept.flatMap(residue => residue.lines);
  return { pdb: lines.length ? `${lines.join('\n')}\nEND\n` : '', residues: kept.length, atoms: lines.length };
}

// 3Dmol keeps its WebGL context after clear(); browsers cap live contexts, so a
// viewer that unmounts must release its canvases explicitly.
export function releaseViewerCanvases(element) {
  for (const canvas of [...(element?.querySelectorAll?.('canvas') || [])]) {
    let context = null;
    for (const type of ['webgl2', 'webgl', 'experimental-webgl']) {
      try { context = canvas.getContext(type); } catch { context = null; }
      if (context) break;
    }
    context?.getExtension?.('WEBGL_lose_context')?.loseContext();
    canvas.remove();
  }
}

// Validation is tied to exact file text, so an old successful response cannot
// enable a search after either uploaded file changes (even before effects run).
export function receptorValidationReady(receptor, sdf, validation) {
  if (!receptor) return validation?.state !== 'reading';
  return validation?.state === 'valid' && validation.sdf === sdf && validation.receptorPdb === receptor.text;
}

export function restoreJobInput(job) {
  const saved = job?.input;
  if (!saved || typeof saved.sdf !== 'string' || !Array.isArray(saved.attachments) || saved.attachments.length !== 2) return null;
  const selections = saved.attachments.map(value => {
    const atom = typeof value === 'object' && value ? value.atom : value;
    const hydrogen = Number.isInteger(value?.hydrogenAtom) ? value.hydrogenAtom : 'auto';
    return Number.isInteger(atom) && atom > 0 ? { atom, hydrogen } : null;
  });
  if (selections.some(selection => !selection)) return null;
  return { sdf: saved.sdf, selections, maxRmsd: saved.maxRmsd, limit: saved.limit, receptor: saved.receptorPdb ? { name: 'Saved search receptor', text: saved.receptorPdb } : null };
}

// Reproducibility report uses an explicit allowlist: no credentials or server
// ownership tokens, and no extra receptor/query file contents are duplicated.
export function receptorForView(view, detail, receptor) {
  return view === 'refined' && detail?.refinement?.ok && detail.refinementInput
    ? detail.refinementInput.receptorPdb || '' : receptor?.text || '';
}
export function resultReport(job, detail) {
  return {
    schema: 'pyxis-link-fragments-result-1', jobId: job?.id,
    createdAt: job?.createdAt, finishedAt: job?.finishedAt,
    search: { state: job?.state, complete: isCompleteJob(job), progress: job?.progress, settings: job?.query },
    product: { linkerId: detail?.linkerId, conformerId: detail?.conformerId, smiles: detail?.smiles, rmsd: detail?.rmsd, minimumNonbondedRadiusRatio: detail?.minimumNonbondedRadiusRatio, attachments: detail?.attachments, sourceAtomMappings: detail?.sourceAtomMappings, receptor: detail?.receptor },
    refinement: detail?.refinement ? Object.fromEntries(Object.entries(detail.refinement).filter(([key]) => key !== 'sdf')) : null,
    refinementReceptor: detail?.refinement?.ok ? {
      supplied: detail.refinementInput ? Boolean(detail.refinementInput.receptorPdb) : Boolean(detail.refinement.receptor),
      sha256: detail.refinement.sdf?.match(/<PYXIS_REFINEMENT_RECEPTOR_SHA256>\s*\n([a-f0-9]{64})/)?.[1] || null,
    } : null,
    limitations: 'Geometric matching and local refinement do not establish binding affinity, synthesis feasibility or availability. Force-field energies describe this product before and after minimization and are not comparable affinity scores across products.',
  };
}
