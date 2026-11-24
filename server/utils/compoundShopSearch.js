import { mintCompoundOffer } from './compoundShopOffers.js';

const rowSource = (row, source) => (source === 'both' || source === 'multi' ? row?.source : source);
const rowCode = (row) => (row?.metadata || {}).MAIN_BAS ?? (row?.metadata || {}).compound_id;

// Only call this on responses from the configured owned catalog engines. A
// client-supplied identifier or structure is never enough to mint an offer.
//
// `stock` is an optional, already-resolved stock availability lookup (see
// withCompoundShopOffersChecked): `{ failed: true }` mints no stock offers,
// `{ active: true, mg(code) }` makes the snapshot amount authoritative for stock
// rows (missing or under 1 mg: no offer), `{ active: false }` or omitted keeps
// the imported amounts. Only rows whose source is `stock` consult it.
export function withCompoundShopOffers(payload, source, { secret, now, stock } = {}) {
  if (!Array.isArray(payload?.results)) return payload;
  return {
    ...payload,
    results: payload.results.map((row) => {
      const actualSource = rowSource(row, source);
      const metadata = row?.metadata || {};
      if (actualSource === 'stock' && stock?.failed) return { ...row, snapshotAvailableMg: null, shopOffer: null };
      const available = actualSource === 'stock'
        ? (stock?.active ? stock.mg(rowCode(row)) : metadata.CURRENT_TOT_NETTO_MG)
        : metadata.web_mg ?? metadata.CURRENT_TOT_NETTO_MG;
      const availableMg = available === null || available === undefined || String(available).trim() === ''
        ? null : Number(available);
      const shopOffer = mintCompoundOffer({
        source: actualSource,
        rowId: row?.molecule_id,
        code: metadata.MAIN_BAS ?? metadata.compound_id,
        smiles: row?.canonical_smiles,
        availableMg,
        leadTime: metadata.Lead_TIME === undefined ? null : String(metadata.Lead_TIME),
      }, { secret, now });
      if (actualSource === 'stock' && stock?.active) return { ...row, snapshotAvailableMg: availableMg, shopOffer };
      return { ...row, shopOffer };
    }),
  };
}

/**
 * Same as withCompoundShopOffers, but resolves the active stock availability
 * snapshot first when `stockAvailability` is configured (opt-in; see
 * server/utils/stockAvailability.js). Every stock search path goes through here:
 * /api/stock-search/similarity, /api/macrocycles/similarity and /api/owned-search.
 * One lookup per payload, and none when it holds no stock rows. A failed lookup
 * mints no stock offers; search results themselves are unaffected.
 */
export async function withCompoundShopOffersChecked(payload, source, { secret, now, stockAvailability, timeoutMs } = {}) {
  const stockRows = Array.isArray(payload?.results) && stockAvailability
    ? payload.results.filter((row) => rowSource(row, source) === 'stock') : [];
  if (!stockRows.length) return withCompoundShopOffers(payload, source, { secret, now });
  let stock;
  try { stock = await stockAvailability.lookup(stockRows.map(rowCode), { timeoutMs }); }
  catch (error) {
    console.error('Stock availability lookup failed; no stock offers on this page:', error.message);
    stock = { failed: true };
  }
  return withCompoundShopOffers(payload, source, { secret, now, stock });
}
