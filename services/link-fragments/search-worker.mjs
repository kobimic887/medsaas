import { parentPort, workerData } from 'node:worker_threads';
import { prepareQuery, fitAndJoin } from './engine.mjs';
try {
  const prepared = await prepareQuery(workerData.sdf, workerData.attachmentAtoms);
  if (!prepared.ok) throw new Error('Invalid query');
  const products = new Map();
  for (const candidate of workerData.candidates) {
      // fitAndJoin considers both fragment assignments internally.
      const fit = await fitAndJoin(prepared, candidate.sdf, { pair: candidate.pair, maxRmsd: workerData.maxRmsd });
      if (!fit.ok) continue;
      // Conformations remain independently searchable; equivalent products are
      // shown once using RDKit's hydrogen-normalized stereochemical SMILES.
      const previous = products.get(fit.smiles);
      if (previous && previous.rmsd <= fit.rmsd) continue;
      products.set(fit.smiles, { ...fit, linkerId: candidate.linkerId, conformerId: candidate.conformerId, linkerAtoms: fit.selectedLabels });
  }
  const results = [...products.values()];
  results.sort((a, b) => a.rmsd - b.rmsd || a.conformerId - b.conformerId);
  parentPort.postMessage({ results: results.slice(0, workerData.limit), matchedProducts: results.length });
} catch { parentPort.postMessage({ error: 'Candidate fitting failed' }); }
