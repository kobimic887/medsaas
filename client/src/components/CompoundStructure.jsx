import { useEffect, useState } from 'react';
import { moleculePreviewCache } from '@/utils/moleculePreview';

export default function CompoundStructure({ smiles, code }) {
  const [drawing, setDrawing] = useState(null);
  useEffect(() => {
    let active = true;
    setDrawing(null);
    if (smiles) moleculePreviewCache.load(smiles).then(
      (src) => { if (active) setDrawing({ smiles, src }); },
      () => { if (active) setDrawing({ smiles, error: true }); },
    );
    return () => { active = false; };
  }, [smiles]);
  const current = drawing?.smiles === smiles ? drawing : null;
  return <div className="flex h-[150px] w-[200px] items-center justify-center rounded-lg border border-slate-200 bg-white text-center text-xs text-slate-600">
    {current?.src ? <img src={current.src} width="200" height="150" alt={`Structure of ${code}`} /> : <span role="status">{!smiles || current?.error ? 'Structure preview unavailable' : 'Drawing structure…'}</span>}
  </div>;
}
