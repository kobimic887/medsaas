// Owner-supplied Pyxis-e-shop_PRICE_LIST.xlsx, Sheet1 C:F, rows 5–12.
// SHA-256 e06cb5f85a172ecd6dccd17348f7cafc29cb5c0bddc3a895c234b6af2042b2c9.
// Only the 1–3 selected-compound tier is approved for this reference display.
// ECB EUR/USD reference rate, 24 September 2026; indicative, never checkout FX.
export const PRICE_GUIDE_EUR_USD = Object.freeze({ rate: 1.1367, date: '24 Sep 2026' });

export const COMPOUND_PRICE_GUIDE = Object.freeze({
  stock: Object.freeze({
    title: 'Stock compound price guide',
    columns: Object.freeze([
      { label: 'Other codes', values: [170, 194, 218, 242, 302, 350, 434, 584] },
      { label: 'LAS', values: [226, 254, 281, 309, 391, 474, 567, 765] },
    ]),
    sizes: Object.freeze([1, 2, 5, 10, 20, 30, 50, 100]),
  }),
  real: Object.freeze({
    title: 'RPX price guide',
    columns: Object.freeze([{ label: 'RPX', values: [317, 365, 420] }]),
    sizes: Object.freeze([1, 2, 5]),
  }),
  virtual: Object.freeze({
    title: 'VPX price guide',
    columns: Object.freeze([{ label: 'VPX', values: [400, 460, 529] }]),
    sizes: Object.freeze([1, 2, 5]),
  }),
});

export function approximateUsd(euros) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD', maximumFractionDigits: 0,
  }).format(euros * PRICE_GUIDE_EUR_USD.rate);
}

// The workbook is a prefix/pack price list, not an individual compound quote.
// Keep source row identity and dated availability separate from this mapping.
export function workbookPacksForRow(source, code) {
  if (!['stock', 'real', 'virtual'].includes(source)) return null;
  const prefix = String(code || '').trim().split(/\s+/)[0].toUpperCase();
  if (!prefix || (source === 'real' && prefix !== 'RPX') || (source === 'virtual' && prefix !== 'VPX')) return null;
  if (source === 'stock' && ['RPX', 'VPX'].includes(prefix)) return null;
  const category = source === 'real' ? 'RPX' : source === 'virtual' ? 'VPX' : prefix === 'LAS' ? 'LAS' : 'Other codes';
  const guide = category === 'RPX' ? COMPOUND_PRICE_GUIDE.real
    : category === 'VPX' ? COMPOUND_PRICE_GUIDE.virtual
      : COMPOUND_PRICE_GUIDE.stock;
  const column = guide.columns.find(({ label }) => label === category);
  if (!column) return null;
  return { category, packs: guide.sizes.map((mg, index) => ({ mg, eur: column.values[index], usd: approximateUsd(column.values[index]) })) };
}
