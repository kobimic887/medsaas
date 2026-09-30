import { useEffect, useRef, useState } from 'react';
import { withAppBase } from '@/utils/appEnv';
import { releaseViewerCanvases } from '@/utils/linkFragmentsJobs';

let scriptPromise;
function load3Dmol() {
  if (window.$3Dmol) return Promise.resolve(window.$3Dmol);
  if (!scriptPromise) scriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = withAppBase('/3dmol/3Dmol-min.js');
    script.async = true;
    const timer = setTimeout(() => { script.remove(); reject(new Error('3D viewer took too long to load.')); }, 20000);
    script.onload = () => { clearTimeout(timer); window.$3Dmol ? resolve(window.$3Dmol) : reject(new Error('3D viewer unavailable.')); };
    script.onerror = () => { clearTimeout(timer); script.remove(); reject(new Error('3D viewer unavailable.')); };
    document.head.appendChild(script);
  }).catch(error => { scriptPromise = null; throw error; });
  return scriptPromise;
}

const ATTACHMENT_COLORS = ['#f97316', '#06b6d4'];
const HYDROGEN_COLOR = '#d946ef';

// Renders uploaded fragments, an optional product and optional receptor pocket
// exactly as supplied: numbering is the original SDF atom order (index + 1,
// explicit hydrogens included); conformers are never created or converted here.
// `loading` overlays a message while the parent fetches new coordinates, so the
// viewer (and its WebGL context) stays mounted between product selections.
export function Fragment3DViewer({ querySdf, productSdf, receptorPdb, attachmentAtoms = [], hydrogenAtoms = [], eligibleAtoms, onAtomSelect, label, loading = '' }) {
  const container = useRef(null);
  const viewer = useRef(null);
  const selectionCallback = useRef(onAtomSelect);
  selectionCallback.current = onAtomSelect;
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let cancelled = false;
    // The ref is detached before passive cleanup runs; keep the element for release.
    const element = container.current;
    load3Dmol().then(threeDmol => {
      if (cancelled) return;
      viewer.current = threeDmol.createViewer(element, { backgroundColor: '#f8fafc' });
      setReady(true);
    }).catch(error => { if (!cancelled) setError(error.message); });
    const resize = new ResizeObserver(() => { viewer.current?.resize(); viewer.current?.render(); });
    resize.observe(element);
    return () => {
      cancelled = true;
      resize.disconnect();
      viewer.current?.divwatcher?.disconnect();
      viewer.current?.intwatcher?.disconnect();
      viewer.current?.clear();
      viewer.current = null;
      releaseViewerCanvases(element);
    };
  }, []);
  const eligibleKey = eligibleAtoms ? eligibleAtoms.map(list => (list || []).join(',')).join('|') : '';
  const attachmentKey = attachmentAtoms.join(',');
  const hydrogenKey = hydrogenAtoms.join(',');
  useEffect(() => {
    if (!ready || !viewer.current) return;
    try {
      const v = viewer.current;
      v.clear();
      const ligandModels = [];
      const records = querySdf?.split('$$$$').filter(record => record.trim()) || [];
      records.forEach((record, fragmentIndex) => {
        // Strip only the record-separator newline, not a blank molecule title.
        const model = v.addModel(fragmentIndex ? record.replace(/^\r?\n/, '') : record, 'sdf', { keepH: true });
        ligandModels.push(model);
        model.setStyle({}, productSdf ? { stick: { radius: 0.07, color: '#94a3b8', opacity: 0.45 } } : { stick: { radius: 0.16, colorscheme: fragmentIndex === 0 ? 'orangeCarbon' : 'cyanCarbon' } });
        // GLModel exposes setStyle(..., true) for additive styling;
        // addStyle belongs to GLViewer in the bundled 3Dmol version.
        const eligible = !productSdf && eligibleAtoms?.[fragmentIndex]?.filter(number => number !== attachmentAtoms[fragmentIndex]);
        if (eligible?.length) model.setStyle({ index: eligible.map(number => number - 1) }, { sphere: { radius: 0.3, color: '#22c55e', opacity: 0.55 } }, true);
        const attachment = attachmentAtoms[fragmentIndex];
        if (attachment) {
          const selection = { index: attachment - 1 };
          model.setStyle(selection, { sphere: { radius: 0.55, color: ATTACHMENT_COLORS[fragmentIndex] } }, true);
          const atom = model.selectedAtoms(selection)[0];
          if (atom) v.addLabel(`${fragmentIndex + 1}:${attachment}`, { position: atom, fontSize: 13, backgroundColor: '#0f172a', fontColor: 'white' });
        }
        const hydrogen = hydrogenAtoms[fragmentIndex];
        if (attachment && hydrogen) {
          const selection = { index: hydrogen - 1 };
          model.setStyle(selection, { sphere: { radius: 0.38, color: HYDROGEN_COLOR } }, true);
          const atom = model.selectedAtoms(selection)[0];
          if (atom) v.addLabel(`H${hydrogen} replaced`, { position: atom, fontSize: 11, backgroundColor: '#701a75', fontColor: 'white' });
        }
        if (selectionCallback.current) {
          // Heavy atoms select themselves; an explicit H selects its heavy atom and that H.
          model.setClickable({}, true, atom => selectionCallback.current?.(fragmentIndex, atom.index + 1));
        }
      });
      if (productSdf) {
        const product = v.addModel(productSdf, 'sdf', { keepH: true });
        product.setStyle({}, { stick: { radius: 0.15, colorscheme: 'greenCarbon' } });
        ligandModels.push(product);
      }
      if (receptorPdb) {
        const receptor = v.addModel(receptorPdb, 'pdb');
        receptor.setStyle({}, { line: { color: '#64748b' } });
      }
      // Only camera placement changes. Uploaded and returned coordinates stay
      // in the same frame; there is no embedding, minimization or conversion.
      v.zoomTo(ligandModels.length ? { model: ligandModels } : {});
      v.render();
      setError('');
    } catch { setError('Could not display this 3D structure. Atom selectors and SDF downloads remain available.'); }
  }, [ready, querySdf, productSdf, receptorPdb, attachmentKey, hydrogenKey, eligibleKey]);
  return (
    <div className="relative h-80 w-full overflow-hidden rounded-xl border border-slate-200 bg-slate-50 dark:border-slate-700">
      <div ref={container} role="img" className="h-full w-full" aria-label={label || (productSdf ? 'Product and query fragments in their original 3D frame' : 'Two query fragments in 3D; click atoms to select attachment sites')} />
      {(!ready || error) && <p role="status" className="absolute inset-x-4 top-4 rounded bg-white/95 p-3 text-sm text-slate-700">{error || 'Loading 3D viewer…'}</p>}
      {ready && !error && loading && <div role="status" className="absolute inset-0 flex items-center justify-center bg-white/70 text-sm font-medium text-slate-700 dark:bg-slate-900/70 dark:text-slate-100">{loading}</div>}
    </div>
  );
}
