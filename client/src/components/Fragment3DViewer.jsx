import { useEffect, useRef, useState } from 'react';
import { withAppBase } from '@/utils/appEnv';

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

export function Fragment3DViewer({ querySdf, productSdf, attachmentAtoms = [], onAtomSelect }) {
  const container = useRef(null);
  const viewer = useRef(null);
  const selectionCallback = useRef(onAtomSelect);
  selectionCallback.current = onAtomSelect;
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let cancelled = false;
    load3Dmol().then(threeDmol => {
      if (cancelled) return;
      viewer.current = threeDmol.createViewer(container.current, { backgroundColor: '#f8fafc' });
      setReady(true);
    }).catch(error => { if (!cancelled) setError(error.message); });
    const resize = new ResizeObserver(() => { viewer.current?.resize(); viewer.current?.render(); });
    resize.observe(container.current);
    return () => {
      cancelled = true;
      resize.disconnect();
      viewer.current?.divwatcher?.disconnect();
      viewer.current?.intwatcher?.disconnect();
      viewer.current?.clear();
      viewer.current = null;
    };
  }, []);
  useEffect(() => {
    if (!ready || !viewer.current) return;
    try {
      const v = viewer.current;
      v.clear();
      const records = querySdf?.split('$$$$').filter(record => record.trim()) || [];
      records.forEach((record, fragmentIndex) => {
        // Strip only the record-separator newline, not a blank molecule title.
        const model = v.addModel(fragmentIndex ? record.replace(/^\r?\n/, '') : record, 'sdf', { keepH: true });
        model.setStyle({}, productSdf ? { stick: { radius: 0.07, color: '#94a3b8', opacity: 0.45 } } : { stick: { radius: 0.16, colorscheme: fragmentIndex === 0 ? 'orangeCarbon' : 'cyanCarbon' } });
        if (attachmentAtoms[fragmentIndex]) {
          const selection = { index: attachmentAtoms[fragmentIndex] - 1 };
          // GLModel exposes setStyle(..., true) for additive styling;
          // addStyle belongs to GLViewer in the bundled 3Dmol version.
          model.setStyle(selection, { sphere: { radius: 0.55, color: fragmentIndex === 0 ? '#f97316' : '#06b6d4' } }, true);
          const atom = model.selectedAtoms(selection)[0];
          if (atom) v.addLabel(`${fragmentIndex + 1}:${attachmentAtoms[fragmentIndex]}`, { position: atom, fontSize: 13, backgroundColor: '#0f172a', fontColor: 'white' });
        }
        if (selectionCallback.current) {
          model.setClickable({ not: { elem: ['H', 'He'] } }, true, atom => selectionCallback.current?.(fragmentIndex, atom.index + 1));
        }
      });
      if (productSdf) {
        const product = v.addModel(productSdf, 'sdf', { keepH: true });
        product.setStyle({}, { stick: { radius: 0.15, colorscheme: 'greenCarbon' } });
      }
      // Only camera placement changes. Uploaded and returned coordinates stay
      // in the same frame; there is no embedding, minimization or conversion.
      v.zoomTo();
      v.render();
      setError('');
    } catch { setError('Could not display this 3D structure. Atom selectors and SDF downloads remain available.'); }
  }, [ready, querySdf, productSdf, attachmentAtoms]);
  return (
    <div className="relative h-80 w-full overflow-hidden rounded-xl border border-slate-200 bg-slate-50 dark:border-slate-700">
      <div ref={container} role="img" className="h-full w-full" aria-label={productSdf ? 'Product and query fragments in their original 3D frame' : 'Two query fragments in 3D; click atoms to select attachment sites'} />
      {(!ready || error) && <p role="status" className="absolute inset-x-4 top-4 rounded bg-white/95 p-3 text-sm text-slate-700">{error || 'Loading 3D viewer…'}</p>}
    </div>
  );
}
