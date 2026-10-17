// Pyxis-e-shop_PRICE_LIST.xlsx, Sheet1 C:F rows 5–12, 1–3 distinct compounds.
// Workbook SHA-256: e06cb5f85a172ecd6dccd17348f7cafc29cb5c0bddc3a895c234b6af2042b2c9.
// This version fixes the USD conversion for a reproducible server-owned quote.
export const PRICE_BOOK_VERSION = 'pyxis-workbook-1-3-20260924-v1';
export const PRICE_GUIDE_EUR_USD = Object.freeze({
  rate: 1.1367,
  date: '24 Sep 2026',
  sourceUrl: 'https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/eurofxref-graph-usd.de.html',
});

const freeze = (value) => {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
};

export const COMPOUND_PRICE_GUIDE = freeze({
  stock: {
    title: 'Stock compound price guide',
    columns: [
      { label: 'Other codes', values: [170, 194, 218, 242, 302, 350, 434, 584] },
      { label: 'LAS', values: [226, 254, 281, 309, 391, 474, 567, 765] },
    ],
    sizes: [1, 2, 5, 10, 20, 30, 50, 100],
  },
  real: {
    title: 'RPX price guide',
    columns: [{ label: 'RPX', values: [317, 365, 420] }],
    sizes: [1, 2, 5],
  },
  virtual: {
    title: 'VPX price guide',
    columns: [{ label: 'VPX', values: [400, 460, 529] }],
    sizes: [1, 2, 5],
  },
  // Small-molecule virtual set (2026-10-15): priced as VPX per the data owner.
  smallvirtual: {
    title: 'Small-molecule virtual price guide (VPX tier)',
    columns: [{ label: 'VPX', values: [400, 460, 529] }],
    sizes: [1, 2, 5],
  },
});

/** Virtual collections are made to order: no snapshot quantity limits a pack. */
export const MADE_TO_ORDER_SOURCES = Object.freeze(['virtual', 'smallvirtual']);
// Small-molecule virtual IDs have no prefix: digit groups joined by "-".
const SMALL_VIRTUAL_CODE = /^\d+(?:-\d+)+$/;

export function euroToUsdCents(euros) {
  if (!Number.isSafeInteger(euros) || euros < 0 || euros > 1000000) {
    throw new TypeError('Workbook prices must be whole non-negative euros.');
  }
  // EUR × 11367/10000 × 100 cents; integer half-up rounding avoids float drift.
  return Math.floor((euros * 11367 + 50) / 100);
}

export function approximateUsd(euros) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(euroToUsdCents(euros) / 100);
}

export function workbookPacksForRow(source, code) {
  if (!['stock', 'real', 'virtual', 'smallvirtual'].includes(source) || typeof code !== 'string') return null;
  if (source === 'smallvirtual') return SMALL_VIRTUAL_CODE.test(code.trim()) ? packsFor('smallvirtual', 'VPX') : null;
  const prefix = code.trim().match(/^([a-z]+)\s*\d+$/i)?.[1].toUpperCase();
  if (!prefix || (source === 'real' && prefix !== 'RPX') || (source === 'virtual' && prefix !== 'VPX')) return null;
  if (source === 'stock' && ['RPX', 'VPX'].includes(prefix)) return null;
  return packsFor(source, source === 'real' ? 'RPX' : source === 'virtual' ? 'VPX' : prefix === 'LAS' ? 'LAS' : 'Other codes');
}

function packsFor(source, category) {
  const guide = COMPOUND_PRICE_GUIDE[source];
  const column = guide.columns.find(({ label }) => label === category);
  const sheetColumn = { 'Other codes': 'C', LAS: 'D', RPX: 'E', VPX: 'F' }[category];
  return { category, packs: guide.sizes.map((mg, index) => ({
    mg,
    eur: column.values[index],
    unitAmountCents: euroToUsdCents(column.values[index]),
    currency: 'usd',
    usd: approximateUsd(column.values[index]),
    sourceCell: `Sheet1!${sheetColumn}${12 - index}`,
  })) };
}
