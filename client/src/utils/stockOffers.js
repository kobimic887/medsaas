// Client helpers for supplier pack offers → cart items, shared by the Stock
// source and the Internal catalog. Server /api/stock-offers is authoritative
// for packs and USD prices; this module only shapes UI/cart payloads. Checkout
// discards client totals and re-prices via the same bas_code lookup.

export const STOCK_OFFER_WEIGHTS_MG = Object.freeze([1, 2, 5, 10]);

/** Positive packs only, amounts restricted to the supplier set. */
export function packsFromStockOffer(offer) {
  if (!offer || typeof offer !== 'object') return [];
  if (!Array.isArray(offer.packs)) return [];
  return offer.packs.filter((pack) => {
    if (!pack || typeof pack !== 'object') return false;
    const amountMg = Number(pack.amountMg);
    const priceUSD = Number(pack.priceUSD);
    return (
      Number.isInteger(amountMg)
      && STOCK_OFFER_WEIGHTS_MG.includes(amountMg)
      && Number.isFinite(priceUSD)
      && priceUSD > 0
    );
  });
}

/** Live USD price for one pack amount from a resolved offer; null when absent. */
export function priceFromStockOffer(offer, amountMg) {
  const amount = Number(amountMg);
  const pack = packsFromStockOffer(offer).find((entry) => entry.amountMg === amount);
  return pack ? pack.priceUSD : null;
}

/**
 * The supplier code an Internal-catalog row is quoted and checked out by.
 * BAS-first chain, matching the server cart normalizer so the displayed quote
 * is guaranteed to be the code checkout re-prices. Never a snapshot price.
 */
export function catalogOfferCode(molecule) {
  const raw = molecule
    && (molecule.BAS_CODE || molecule.bas_code || molecule.basCode
      || molecule.ASINEX_ID || molecule.id_number || molecule.id);
  if (raw === undefined || raw === null) return '';
  const text = String(raw).trim();
  if (!text || text === 'N/A') return '';
  return text;
}

/**
 * Build a cart entry from a resolved stock offer + chosen pack.
 * Retains the original stock code as name/catalogId/stockCode.
 */
export function cartItemFromStockOffer(molecule, amountMg, priceUSD, offer) {
  const code = String(
    offer?.code
      || molecule?.stockCode
      || molecule?.ASINEX_ID
      || '',
  ).trim();
  if (!code || code === 'N/A') return null;
  const amount = Number(amountMg);
  const price = Number(priceUSD);
  if (!Number.isInteger(amount) || !STOCK_OFFER_WEIGHTS_MG.includes(amount)) return null;
  if (!Number.isFinite(price) || price <= 0) return null;

  return {
    name: code,
    stockCode: code,
    amount,
    price,
    pricePerMg: price,
    totalPrice: price,
    id: code,
    catalogId: code,
    offerId: offer?.offerId ?? null,
    currency: 'usd',
    source: 'stock',
    smiles: molecule?.SMILES_STRING || molecule?.smiles || offer?.smiles || '',
    formula: offer?.formula || molecule?.BRUTTO_FORMULA || molecule?.formula || '',
  };
}

/**
 * Build a cart entry for an Internal-catalog row priced from a live offer.
 * Same pack rules as stock; snapshot PRICE_* fields are never read, so a
 * failed quote can only block the add — never fall back to an old price.
 */
export function cartItemFromCatalogOffer(molecule, amountMg, priceUSD, offer) {
  const code = catalogOfferCode(molecule);
  if (!code) return null;
  const amount = Number(amountMg);
  const price = Number(priceUSD);
  if (!Number.isInteger(amount) || !STOCK_OFFER_WEIGHTS_MG.includes(amount)) return null;
  if (!Number.isFinite(price) || price <= 0) return null;

  return {
    name: molecule?.BRUTTO_FORMULA || molecule?.formula || molecule?.SMILES_STRING || molecule?.smiles || code,
    amount,
    price,
    pricePerMg: price,
    totalPrice: price,
    id: code,
    catalogId: code,
    offerId: offer?.offerId ?? null,
    currency: 'usd',
    source: 'catalog',
    smiles: molecule?.SMILES_STRING || molecule?.smiles || '',
    formula: molecule?.BRUTTO_FORMULA || molecule?.formula || '',
  };
}
