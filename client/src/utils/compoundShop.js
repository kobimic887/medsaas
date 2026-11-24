import { packUnitCents } from '../../../shared/compoundPriceBook.js';

// Display prices are convenient; only the authenticated server validates offers
// and computes the amount sent to Stripe.
export const shopMoney = (cents, currency = 'usd') => new Intl.NumberFormat(currency === 'eur' ? 'en-IE' : 'en-US', {
  style: 'currency', currency: currency === 'eur' ? 'EUR' : 'USD',
}).format(cents / 100);

// IANA time zones of the 27 EU member states, including their outermost regions.
// Visitors in these zones pay EUR; everyone else pays USD.
// The zone is only a currency preference: both are approved list prices and the
// server prices whichever currency is requested.
export const EU_TIME_ZONES = new Set([
  'Europe/Vienna', 'Europe/Brussels', 'Europe/Sofia', 'Europe/Zagreb', 'Asia/Nicosia', 'Asia/Famagusta',
  'Europe/Nicosia', 'Europe/Prague', 'Europe/Copenhagen', 'Europe/Tallinn', 'Europe/Helsinki', 'Europe/Mariehamn',
  'Europe/Paris', 'Europe/Berlin', 'Europe/Busingen', 'Europe/Athens', 'Europe/Budapest', 'Europe/Dublin',
  'Europe/Rome', 'Europe/Riga', 'Europe/Vilnius', 'Europe/Luxembourg', 'Europe/Malta', 'Europe/Amsterdam',
  'Europe/Warsaw', 'Europe/Lisbon', 'Atlantic/Madeira', 'Atlantic/Azores', 'Europe/Bucharest', 'Europe/Bratislava',
  'Europe/Ljubljana', 'Europe/Madrid', 'Africa/Ceuta', 'Atlantic/Canary', 'Europe/Stockholm',
  'America/Guadeloupe', 'America/Martinique', 'America/Cayenne', 'Indian/Reunion', 'Indian/Mayotte', 'America/Marigot',
]);
export function detectShopCurrency(timeZone) {
  let zone = timeZone;
  if (zone === undefined) {
    try { zone = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { zone = ''; }
  }
  return EU_TIME_ZONES.has(zone) ? 'eur' : 'usd';
}
let detectedCurrency;
export const shopCurrency = () => (detectedCurrency ??= detectShopCurrency());
/** Charged unit amount of an offer pack or cart line in the shop currency. */
export const shopUnitCents = (packOrItem, currency = shopCurrency()) => packUnitCents(packOrItem, currency);
export const compoundKey = (item) => `${item.catalogSource}:${item.rowId}`;
export const cartLineKey = (item) => `${compoundKey(item)}:${item.amountMg}`;
export const isOwnedCartItem = (item) => item?.source === 'pyxis' && typeof item.offerToken === 'string' && item.offerToken.length > 0;
// Old saved lines have a whole-euro value; new lines carry cents in both currencies.
export const shopCartTotal = (items, currency = shopCurrency()) => items.reduce((sum, item) => sum + (isOwnedCartItem(item) ? shopUnitCents(item, currency) * item.quantity : 0), 0);
export function readShopCart(storage) {
  try {
    const saved = JSON.parse(storage.getItem('moleculeCart') || '[]');
    return Array.isArray(saved) ? saved : Array.isArray(saved?.items) ? saved.items : [];
  } catch { return []; }
}
export function writeShopCart(storage, items) {
  storage.setItem('moleculeCart', JSON.stringify({ items, total: shopCartTotal(items, 'usd') / 100 }));
}
export function addShopPack(items, offer, amountMg) {
  const pack = offer?.packs?.find((entry) => entry.mg === amountMg);
  const eurCents = pack && shopUnitCents(pack, 'eur');
  if (!offer?.token || !pack || !Number.isSafeInteger(pack.unitAmountCents) || pack.unitAmountCents <= 0 || !Number.isSafeInteger(eurCents) || eurCents <= 0) throw new Error('This pack is unavailable. Search again for current offers.');
  const item = { entryId: crypto.randomUUID(), source: 'pyxis', catalogSource: offer.source, rowId: offer.rowId, code: offer.code, name: offer.code, smiles: offer.smiles, offerToken: offer.token, amountMg: pack.mg, amount: pack.mg, quantity: 1, unitAmountCents: pack.unitAmountCents, eurCents, eur: eurCents / 100, currency: 'usd', expiresAt: offer.expiresAt };
  const distinct = new Set(items.filter(isOwnedCartItem).map(compoundKey));
  distinct.add(compoundKey(item));
  if (distinct.size > 3) throw new Error('This price tier supports up to 3 distinct compounds per order.');
  const existing = items.findIndex((entry) => isOwnedCartItem(entry) && cartLineKey(entry) === cartLineKey(item));
  if (existing < 0) return [...items, item];
  const quantity = items[existing].quantity + 1;
  if (quantity > 10) throw new Error('Choose at most 10 packs per item.');
  return items.map((entry, index) => index === existing ? { ...item, quantity } : entry);
}
export function shopRequestItems(items) {
  if (!items.length || items.some((item) => !isOwnedCartItem(item))) throw new Error('Remove unavailable legacy items before checkout. Search the Pyxis catalog to add current packs.');
  return items.map(({ offerToken, amountMg, quantity }) => ({ offerToken, amountMg, quantity }));
}
export const basketSignature = (items) => JSON.stringify({ items: shopRequestItems(items), entries: items.map((item) => item.entryId) });
export function checkoutAttempt(storage, signature, randomId) {
  let previous;
  try { previous = JSON.parse(storage.getItem('compoundCheckoutAttempt') || 'null'); } catch { /* replaced below */ }
  if (previous?.signature === signature && previous?.id) return previous.id;
  const id = randomId();
  storage.setItem('compoundCheckoutAttempt', JSON.stringify({ signature, id }));
  return id;
}
// Returning from Stripe is not evidence of payment. Remove only matching lines
// after a server-owned order reaches a paid/authorized state. A changed basket
// (new token, quantity or pack) must survive a delayed payment return.
export function cartAfterConfirmedOrder(items, order, checkoutSnapshot = []) {
  if (!['paid', 'payment_authorized'].includes(order?.status)) return items;
  return items.filter((item) => !isOwnedCartItem(item) || !checkoutSnapshot.some((line) =>
    line.entryId === item.entryId && line.offerToken === item.offerToken && line.amountMg === item.amountMg && line.quantity === item.quantity &&
    order.items?.some((purchased) => (purchased.source || purchased.catalogSource) === item.catalogSource && String(purchased.rowId) === String(item.rowId) && Number(purchased.amountMg) === item.amountMg && Number(purchased.quantity) === item.quantity)));
}
