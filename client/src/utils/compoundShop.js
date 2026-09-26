// Display prices are convenient; only the authenticated server validates offers
// and computes the amount sent to Stripe.
export const shopMoney = (cents) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
export const compoundKey = (item) => `${item.catalogSource}:${item.rowId}`;
export const cartLineKey = (item) => `${compoundKey(item)}:${item.amountMg}`;
export const isOwnedCartItem = (item) => item?.source === 'pyxis' && typeof item.offerToken === 'string' && item.offerToken.length > 0;
export const shopCartTotal = (items) => items.reduce((sum, item) => sum + (isOwnedCartItem(item) ? item.unitAmountCents * item.quantity : 0), 0);
export function readShopCart(storage) {
  try {
    const saved = JSON.parse(storage.getItem('moleculeCart') || '[]');
    return Array.isArray(saved) ? saved : Array.isArray(saved?.items) ? saved.items : [];
  } catch { return []; }
}
export function writeShopCart(storage, items) {
  storage.setItem('moleculeCart', JSON.stringify({ items, total: shopCartTotal(items) / 100 }));
}
export function addShopPack(items, offer, amountMg) {
  const pack = offer?.packs?.find((entry) => entry.mg === amountMg);
  if (!offer?.token || !pack || !Number.isInteger(pack.unitAmountCents) || pack.unitAmountCents <= 0) throw new Error('This pack is unavailable. Search again for current offers.');
  const item = { entryId: crypto.randomUUID(), source: 'pyxis', catalogSource: offer.source, rowId: offer.rowId, code: offer.code, name: offer.code, smiles: offer.smiles, offerToken: offer.token, amountMg: pack.mg, amount: pack.mg, quantity: 1, unitAmountCents: pack.unitAmountCents, eur: pack.eur, currency: 'usd', expiresAt: offer.expiresAt };
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
