import { useEffect, useState } from 'react';
import { loadCompoundDescriptors } from '@/utils/compoundDescriptors';

export function CompoundDescriptorCells({ smiles }) {
  const [result, setResult] = useState({ smiles, state: 'loading' });
  useEffect(() => {
    let cancelled = false;
    loadCompoundDescriptors(smiles).then(
      values => { if (!cancelled) setResult({ smiles, state: 'ready', ...values }); },
      () => { if (!cancelled) setResult({ smiles, state: 'error' }); },
    );
    return () => { cancelled = true; };
  }, [smiles]);
  const current = result.smiles === smiles ? result : { state: 'loading' };
  const title = current.state === 'error' ? 'Could not calculate from this exact SMILES' : 'Calculated locally from exact SMILES with RDKit; formula uses element totals, MW includes isotopic masses';
  return (
    <>
      <td className="p-2 text-xs whitespace-nowrap" title={title}>{current.state === 'ready' ? current.formula : current.state === 'loading' ? '…' : '—'}</td>
      <td className="p-2 text-xs whitespace-nowrap" title={title}>{current.state === 'ready' ? current.mw.toFixed(2) : current.state === 'loading' ? '…' : '—'}</td>
    </>
  );
}
