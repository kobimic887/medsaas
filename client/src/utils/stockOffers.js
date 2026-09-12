// Client helpers for stock-compound pack offers → cart items.
// Server /api/stock-offers is authoritative for packs and USD prices; this
// module only shapes UI/cart payloads. Checkout discards client totals and
// re-prices via the same bas_code lookup.

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
