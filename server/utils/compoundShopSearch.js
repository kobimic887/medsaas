import { mintCompoundOffer } from './compoundShopOffers.js';

// Only call this on responses from the configured owned catalog engines. A
// client-supplied identifier or structure is never enough to mint an offer.
export function withCompoundShopOffers(payload, source, { secret, now } = {}) {
  if (!Array.isArray(payload?.results)) return payload;
  return {
    ...payload,
    results: payload.results.map((row) => {
      const actualSource = source === 'both' ? row?.source : source;
      const metadata = row?.metadata || {};
      const available = actualSource === 'stock'
        ? metadata.CURRENT_TOT_NETTO_MG
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
      return { ...row, shopOffer };
    }),
  };
}
