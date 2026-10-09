import { addShopPack } from './compoundShop.js';

export const offerSelectionKey = (offer) => `${offer.source}:${offer.rowId}`;

// Work on a new array and publish only after every selected pack passes. A
// rejected fourth compound or missing offer must never partially fill the cart.
export function addSelectedShopPacks(items, selections) {
  if (!selections.length) throw new Error('Select compounds to order first.');
  return selections.reduce((next, { offer, amountMg }) => {
    if (!offer?.token) throw new Error('A selected compound has no purchase offer. Choose only available packs.');
    return addShopPack(next, offer, amountMg);
  }, items);
}
