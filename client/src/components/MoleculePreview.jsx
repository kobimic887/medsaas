import { useEffect, useState } from 'react';
import { moleculePreviewDataUrl } from '@/utils/moleculePreview';

export function MoleculePreview({ smiles }) {
  const [preview, setPreview] = useState({ smiles, state: 'loading' });
  useEffect(() => {
    let cancelled = false;
    setPreview({ smiles, state: 'loading' });
    (async () => {
      try {
        const rdkit = await window.loadRDKit();
        if (cancelled) return;
        const src = moleculePreviewDataUrl(rdkit, smiles);
        if (!cancelled) setPreview({ smiles, state: 'ready', src });
      } catch {
        if (!cancelled) setPreview({ smiles, state: 'error' });
      }
    })();
    return () => { cancelled = true; };
  }, [smiles]);

  const current = preview.smiles === smiles ? preview : { state: 'loading' };
  return (
    <div className="flex h-[150px] w-[200px] items-center justify-center rounded border border-gray-200 bg-white">
      {current.state === 'ready' ? (
        <img src={current.src} width={200} height={150} alt="2D molecule structure" />
      ) : (
        <span role="status" className="px-2 text-center text-xs text-gray-600">
          {current.state === 'error' ? 'Structure preview unavailable' : 'Drawing structure…'}
        </span>
      )}
    </div>
  );
}
