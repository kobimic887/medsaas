export const PREVIEW_WIDTH = 200;
export const PREVIEW_HEIGHT = 150;

function previewSize({ width = PREVIEW_WIDTH, height = PREVIEW_HEIGHT } = {}) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error('Preview size must be positive whole pixels');
  }
  return { width, height };
}

// Render the exact structure locally. Never alter SMILES to satisfy an image
// provider: that can silently show a chemically different molecule.
export function moleculePreviewDataUrl(rdkit, smiles, options) {
  const { width, height } = previewSize(options);
  let molecule;
  try {
    molecule = rdkit.get_mol(smiles);
    if (!molecule || !molecule.is_valid()) throw new Error('Invalid structure');
    const svg = molecule.get_svg(width, height);
    if (!svg.includes('<svg')) throw new Error('Structure drawing unavailable');
    // An image data URL keeps SVG out of the page's executable DOM.
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  } finally {
    molecule?.delete();
  }
}

// Exact SMILES plus every rendering setting. Charges, isotopes and stereo marks
// are part of the string, so no normalization may happen before this key.
export function moleculePreviewKey(smiles, options) {
  const { width, height } = previewSize(options);
  return JSON.stringify([width, height, smiles]);
}

// Least-recently-used cache of finished data URLs (strings only — the RDKit
// molecule is freed inside moleculePreviewDataUrl before anything is stored).
// Concurrent requests for one key share a single render; failures are dropped
// so the next request retries.
export function createMoleculePreviewCache({ limit = 150, loadRdkit = () => window.loadRDKit() } = {}) {
  const entries = new Map();
  const touch = (key, entry) => {
    entries.delete(key);
    entries.set(key, entry);
    while (entries.size > limit) entries.delete(entries.keys().next().value);
  };

  return {
    get size() { return entries.size; },
    peek(smiles, options) {
      const key = moleculePreviewKey(smiles, options);
      const entry = entries.get(key);
      if (!entry?.src) return null;
      touch(key, entry);
      return entry.src;
    },
    load(smiles, options) {
      const key = moleculePreviewKey(smiles, options);
      const existing = entries.get(key);
      if (existing) {
        touch(key, existing);
        return existing.src ? Promise.resolve(existing.src) : existing.promise;
      }
      const entry = {};
      entry.promise = Promise.resolve()
        .then(loadRdkit)
        .then(rdkit => moleculePreviewDataUrl(rdkit, smiles, options))
        .then(src => {
          entry.src = src;
          return src;
        }, error => {
          if (entries.get(key) === entry) entries.delete(key);
          throw error;
        });
      touch(key, entry);
      return entry.promise;
    },
  };
}

export const moleculePreviewCache = createMoleculePreviewCache();
