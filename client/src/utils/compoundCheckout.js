import { basketSignature, checkoutAttempt, readShopCart, shopCurrency, shopRequestItems } from './compoundShop.js';

// This boundary creates no payment until an explicitly reviewed, unchanged cart
// is submitted. Keep it independent of the page so retry/race behavior is tested.
export async function requestCompoundCheckout({ storage, reviewed, reviewOnly = false, signal, fetchImpl = fetch, buildApiUrl, authToken, randomId = () => crypto.randomUUID(), currency = shopCurrency() }) {
  const current = readShopCart(storage);
  const items = shopRequestItems(current);
  const signature = basketSignature(current);
  // Pay in the currency the customer reviewed; a new review uses the detected currency.
  const continuing = !reviewOnly && reviewed?.signature === signature && reviewed.quote?.currency === currency;
  const response = await fetchImpl(buildApiUrl(continuing ? '/compound-shop/checkout' : '/compound-shop/quote'), {
    method: 'POST', signal,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
    body: JSON.stringify(continuing ? {
      items, currency, expectedTotalCents: reviewed.quote.totalCents, priceBookVersion: reviewed.quote.priceBookVersion,
      // USD keeps the original key namespace so in-flight attempts survive this release.
      idempotencyKey: checkoutAttempt(storage, currency === 'usd' ? signature : `${currency}:${signature}`, randomId),
    } : { items, currency }),
  });
  const result = await response.json();
  if (signal?.aborted) throw new DOMException('Request canceled', 'AbortError');
  if (basketSignature(readShopCart(storage)) !== signature) throw new Error('Your cart changed. Review the updated order before continuing.');
  if (response.status === 409 && result.code === 'SHOP_PRICES_CHANGED' && result.quote) return { kind: 'prices_changed', reviewed: { signature, quote: result.quote } };
  if (response.status === 409 && result.code === 'SHOP_CHECKOUT_EXPIRED') {
    // Only verified expiration permits a new key. Network failures retain it.
    storage.removeItem('compoundCheckoutAttempt');
    return { kind: 'expired' };
  }
  if (response.status === 409 && ['SHOP_ORDER_ALREADY_PAID', 'SHOP_PAYMENT_PENDING'].includes(result.code) && /^pc_[a-f0-9]{64}$/.test(result.orderId || '')) {
    storage.setItem(`compoundOrderCart:${result.orderId}`, JSON.stringify(current));
    return { kind: 'order', orderId: result.orderId };
  }
  if (!response.ok) throw new Error(result.error || 'Checkout is unavailable. Your cart is saved.');
  if (!continuing) return { kind: 'review', reviewed: { signature, quote: result } };
  const url = new URL(result.url);
  if (url.protocol !== 'https:' || url.hostname !== 'checkout.stripe.com') throw new Error('Invalid payment redirect. Your cart is saved.');
  storage.setItem(`compoundOrderCart:${result.orderId}`, JSON.stringify(current));
  return { kind: 'redirect', url: url.href };
}
