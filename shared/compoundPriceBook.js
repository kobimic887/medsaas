// Two owner-supplied price lists, 1–3 distinct compounds per order:
// - Stock: "Prices_NEW (December 2025) (15).xls" (Asinex, USD), sheet
//   "ASINEX Price List USD", 1–10 compounds block C6:E13 (not LAS / LAS / PRO).
//   File SHA-256: 91b5b99fef9f7d74b1e3b7f75a84be4d29751e69d33af112274e9edac387e3d0.
// - RPX / VPX / small-molecule virtual: Pyxis-e-shop_PRICE_LIST.xlsx (EUR),
//   Sheet1 E:F rows 10–12. Workbook SHA-256:
//   e06cb5f85a172ecd6dccd17348f7cafc29cb5c0bddc3a895c234b6af2042b2c9.
// Each list keeps its own currency exactly; the other currency uses the fixed
// rate below, rounded half-up to whole cents per pack.
export const PRICE_BOOK_VERSION = 'pyxis-stock-usd-202512-macro-eur-20260924-v2';
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

// `currency` is the list's own currency; `values` are whole units of it.
export const COMPOUND_PRICE_GUIDE = freeze({
  stock: {
    title: 'Stock compound price guide',
    currency: 'usd',
    columns: [
      { label: 'not LAS', sheetColumn: 'C', values: [132, 158, 184, 211, 277, 330, 422, 587] },
      { label: 'LAS', sheetColumn: 'D', values: [194, 224, 254, 284, 375, 466, 568, 786] },
      { label: 'PRO', sheetColumn: 'E', values: [251, 291, 330, 370, 487, 606, 739, 1022] },
    ],
    sizes: [1, 2, 5, 10, 20, 30, 50, 100],
  },
  real: {
    title: 'RPX price guide',
    currency: 'eur',
    columns: [{ label: 'RPX', sheetColumn: 'E', values: [317, 365, 420] }],
    sizes: [1, 2, 5],
  },
  virtual: {
    title: 'VPX price guide',
    currency: 'eur',
    columns: [{ label: 'VPX', sheetColumn: 'F', values: [400, 460, 529] }],
    sizes: [1, 2, 5],
  },
  // Small-molecule virtual set (2026-10-15): priced as VPX per the data owner.
  smallvirtual: {
    title: 'Small-molecule virtual price guide (VPX tier)',
    currency: 'eur',
    columns: [{ label: 'VPX', sheetColumn: 'F', values: [400, 460, 529] }],
    sizes: [1, 2, 5],
  },
});

/**
 * Checkout currencies. The browser picks one automatically (EU visitors EUR,
 * everyone else USD); both are approved prices, and the server prices
 * whichever is requested.
 */
export const SHOP_CURRENCIES = Object.freeze(['eur', 'usd']);

/** Charged unit amount in minor units of `currency` for a price-book pack or cart line. */
export function packUnitCents(pack, currency) {
  if (currency === 'eur') return Number.isSafeInteger(pack.eurCents) ? pack.eurCents : Math.round(pack.eur * 100);
  if (currency === 'usd') return pack.unitAmountCents;
  throw new TypeError('Unsupported shop currency.');
}

/** Virtual collections are made to order: no snapshot quantity limits a pack. */
export const MADE_TO_ORDER_SOURCES = Object.freeze(['virtual', 'smallvirtual']);
// Small-molecule virtual IDs have no prefix: digit groups joined by "-".
const SMALL_VIRTUAL_CODE = /^\d+(?:-\d+)+$/;

function wholeUnits(value) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 1000000) {
    throw new TypeError('List prices must be whole non-negative currency units.');
  }
  return value;
}

export function euroToUsdCents(euros) {
  // EUR × 11367/10000 × 100 cents; integer half-up rounding avoids float drift.
  return Math.floor((wholeUnits(euros) * 11367 + 50) / 100);
}

export function usdToEuroCents(dollars) {
  // USD × 10000/11367 × 100 cents, half-up in integers.
  return Math.floor((wholeUnits(dollars) * 2000000 + 11367) / 22734);
}

const formatMoney = (cents, currency) => new Intl.NumberFormat(currency === 'eur' ? 'en-IE' : 'en-US', {
  style: 'currency', currency: currency === 'eur' ? 'EUR' : 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2,
}).format(cents / 100);

export function approximateUsd(euros) {
  return formatMoney(euroToUsdCents(euros), 'usd');
}

export function workbookPacksForRow(source, code) {
  if (!['stock', 'real', 'virtual', 'smallvirtual'].includes(source) || typeof code !== 'string') return null;
  if (source === 'smallvirtual') return SMALL_VIRTUAL_CODE.test(code.trim()) ? packsFor('smallvirtual', 'VPX') : null;
  const prefix = code.trim().match(/^([a-z]+)\s*\d+$/i)?.[1].toUpperCase();
  if (!prefix || (source === 'real' && prefix !== 'RPX') || (source === 'virtual' && prefix !== 'VPX')) return null;
  if (source === 'stock' && ['RPX', 'VPX'].includes(prefix)) return null;
  const stockColumn = prefix === 'LAS' ? 'LAS' : prefix === 'PRO' ? 'PRO' : 'not LAS';
  return packsFor(source, source === 'real' ? 'RPX' : source === 'virtual' ? 'VPX' : stockColumn);
}

function packsFor(source, category) {
  const guide = COMPOUND_PRICE_GUIDE[source];
  const column = guide.columns.find(({ label }) => label === category);
  return { category, listCurrency: guide.currency, packs: guide.sizes.map((mg, index) => {
    const listValue = column.values[index];
    const usdList = guide.currency === 'usd';
    const eurCents = usdList ? usdToEuroCents(listValue) : wholeUnits(listValue) * 100;
    const unitAmountCents = usdList ? wholeUnits(listValue) * 100 : euroToUsdCents(listValue);
    return {
      mg,
      listCurrency: guide.currency,
      listValue,
      eurCents,
      eur: eurCents / 100,
      unitAmountCents,
      currency: 'usd',
      usd: formatMoney(unitAmountCents, 'usd'),
      sourceCell: usdList ? `ASINEX Price List USD!${column.sheetColumn}${13 - index}` : `Sheet1!${column.sheetColumn}${12 - index}`,
    };
  }) };
}
