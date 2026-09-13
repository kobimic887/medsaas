// Molecule-cart checkout price-review helpers (409 MOLECULE_PRICES_CHANGED).
//
// Cart schema (simulation.jsx addToCart, controlpanel.jsx addToCart,
// stockOffers.js cartItemFromStockOffer): every item carries `amount` (pack
// mg) and the pack price in USD written to `totalPrice`, usually `price`, and
// the legacy `pricePerMg` alias — that alias holds the pack price, not a
// per-mg figure. A basket row is one pack; there is no quantity field.
// `localStorage['moleculeCart']` exists in two shapes: a plain array
// (Simulation add, molstar3d) or `{ items, total }` (navbar removal,
// controlpanel). Both must keep working.

// Parse a stored moleculeCart payload into { items, storedAsObject } or null.
export function parseStoredMoleculeCart(raw) {
  try {
    const parsed = raw ? JSON.parse(raw) : null;
    if (Array.isArray(parsed)) return { items: parsed, storedAsObject: false };
    if (parsed && typeof parsed === 'object' && Array.isArray(parsed.items)) {
      return { items: parsed.items, storedAsObject: true };
    }
  } catch {
    // Fall through: a corrupted cart is treated as absent.
  }
  return null;
}

export function cartItemDisplayPrice(item) {
  const value = Number(item?.totalPrice ?? item?.price);
  return Number.isFinite(value) ? value : 0;
}

export function cartTotalFromItems(items) {
  return (Array.isArray(items) ? items : []).reduce(
    (sum, item) => sum + cartItemDisplayPrice(item),
    0,
  );
}

/**
 * Build the refreshed basket from a 409 MOLECULE_PRICES_CHANGED response body.
 * Returns { items, total } with authoritative prices, or null when the payload
 * is unusable (caller falls back to the generic error path).
 */
export function cartItemsFromPriceReview(payload) {
  const updated = payload?.updatedCartItems;
  if (!Array.isArray(updated) || updated.length === 0) return null;
  if (!updated.every((item) => item && typeof item === 'object')) return null;
  const total = Number(payload?.totalAmount);
  return {
    items: updated,
    total: Number.isFinite(total) && total >= 0 ? total : cartTotalFromItems(updated),
  };
}

/**
 * Persist refreshed basket items, keeping whichever storage shape was already
 * there (array vs { items, total }). Storage is injected so this stays testable
 * outside the browser; failures are swallowed — in-memory state still carries
 * the refreshed prices for the retry click.
 */
export function persistMoleculeCart(storage, items, total) {
  try {
    const stored = parseStoredMoleculeCart(storage.getItem('moleculeCart'));
    // An empty stored cart (or unparseable raw) defaults to the object shape
    // the navbar's own removeFromCart writes.
    const asObject = stored ? stored.storedAsObject : true;
    const data = asObject ? { items, total } : items;
    storage.setItem('moleculeCart', JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}
