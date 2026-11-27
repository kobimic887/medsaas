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

// One topological polar surface area readout, calculated locally from the exact
// SMILES with browser RDKit (loaded on demand, shared cache with other cells).
export function PolarSurfaceValue({ smiles }) {
  const [result, setResult] = useState({ smiles, state: smiles ? 'loading' : 'error' });
  useEffect(() => {
    if (!smiles) return undefined;
    let cancelled = false;
    loadCompoundDescriptors(smiles).then(
      values => { if (!cancelled) setResult({ smiles, state: Number.isFinite(values.tpsa) ? 'ready' : 'error', tpsa: values.tpsa }); },
      () => { if (!cancelled) setResult({ smiles, state: 'error' }); },
    );
    return () => { cancelled = true; };
  }, [smiles]);
  const current = result.smiles === smiles ? result : { state: smiles ? 'loading' : 'error' };
  if (current.state === 'ready') {
    return <span className="font-mono text-sm tabular-nums" title="Topological polar surface area (Ertl, N and O contributions), calculated with RDKit from the exact SMILES">{current.tpsa.toFixed(1)}</span>;
  }
  return <span className="text-slate-400" title={current.state === 'error' ? 'Could not calculate from this structure' : 'Calculating…'}>{current.state === 'loading' ? '…' : '—'}</span>;
}
