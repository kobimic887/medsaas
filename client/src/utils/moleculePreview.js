// Render the exact structure locally. Never alter SMILES to satisfy an image
// provider: that can silently show a chemically different molecule.
export function moleculePreviewDataUrl(rdkit, smiles) {
  let molecule;
  try {
    molecule = rdkit.get_mol(smiles);
    if (!molecule || !molecule.is_valid()) throw new Error('Invalid structure');
    const svg = molecule.get_svg(200, 150);
    if (!svg.includes('<svg')) throw new Error('Structure drawing unavailable');
    // An image data URL keeps SVG out of the page's executable DOM.
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  } finally {
    molecule?.delete();
  }
}
