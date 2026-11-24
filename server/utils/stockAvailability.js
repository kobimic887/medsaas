// Weekly offline stock availability snapshot → offers (opt-in).
//
// The snapshot itself (scripts/stock-availability-snapshot.mjs) and its loader
// live on the scientific host: services/owned-search/stockAvailability.mjs,
// served by the combined loopback service under /stock-availability. This module
// is the application side plus the format constants both sides share. Both ship
// in the immutable search release (it archives server/utils), so the service
// imports these constants rather than copying them. docs: services/owned-search/README.md.
//
// Three states, never two. A lookup answers one of:
//   inactive  no snapshot has been activated: imported CURRENT_TOT_NETTO_MG still applies;
//   active    the snapshot is authoritative: a code missing from it, or under 1 mg, has no offer;
//   error     the service is unreachable, still loading or holds only an invalid snapshot.
// An error must never fall back to the imported amounts once activation is
// possible, so searches mint no stock offers and quotes answer 503.

export const STOCK_SNAPSHOT_FORMAT = 'pyxis-stock-availability-v1';
export const STOCK_SNAPSHOT_HEADER = Object.freeze(['MAIN_BAS', 'CURRENT_TOT_NETTO_MG', 'CURRENT_TOT_AMOUNT_UM', 'VIALS']);
// Same minimum as compoundShopOffers.js: an offer needs at least 1 mg.
export const STOCK_MIN_OFFER_MG = 1;
export const STOCK_LOOKUP_MAX_CODES = 5000;
const MAIN_BAS = /^[A-Z]{3} \d{6,9}$/;
// Loopback through the tunnel: a half-open connection must not eat the 90 s search batch budget.
const LOOKUP_TIMEOUT_MS = 3000;

export class StockAvailabilityError extends Error {
  constructor(code, message, status = 503) {
    super(message);
    this.name = 'StockAvailabilityError';
    this.code = code;
    this.status = status;
  }
}

/**
 * The snapshot tool's key rule (trim, upper-case, collapse whitespace). Used for
 * lookups only: an offer's own `code` is never rewritten. Returns null for a
 * value that cannot be a MAIN_BAS code, which is therefore never in a snapshot.
 */
export function normalizeStockCode(code) {
  if (typeof code !== 'string') return null;
  const normalized = code.trim().toUpperCase().replace(/\s+/g, ' ');
  return MAIN_BAS.test(normalized) ? normalized : null;
}

function unavailable(message) {
  return new StockAvailabilityError('STOCK_AVAILABILITY_UNAVAILABLE', message);
}

/**
 * Client for the scientific host's /stock-availability service. Returns null when
 * `baseUrl` is empty, which keeps every caller on the imported amounts (opt-in).
 * `lookup(codes)` resolves `{ active: false }` or `{ active: true, asOf, mg(code) }`
 * and rejects with StockAvailabilityError for anything else.
 */
export function createStockAvailability({ baseUrl, fetchImpl = fetch, timeoutMs = LOOKUP_TIMEOUT_MS } = {}) {
  const base = String(baseUrl || '').trim().replace(/\/+$/, '');
  if (!base) return null;
  async function lookup(codes, { timeoutMs: remainingMs } = {}) {
    const keys = [...new Set((codes || []).map(normalizeStockCode).filter(Boolean))];
    if (keys.length > STOCK_LOOKUP_MAX_CODES) throw unavailable('Too many stock codes for one availability lookup');
    const budget = Math.min(timeoutMs, Number.isFinite(remainingMs) ? remainingMs : timeoutMs);
    if (budget <= 0) throw unavailable('Stock availability lookup ran out of time');
    let response; let payload;
    try {
      response = await fetchImpl(`${base}/lookup`, {
        method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ codes: keys }), timeoutMs: budget, signal: AbortSignal.timeout(budget),
      });
      payload = await response.json();
    } catch { throw unavailable('Stock availability service is unreachable'); }
    if (!response.ok) throw unavailable('Stock availability service is not ready');
    if (payload?.state === 'inactive') return { active: false };
    if (payload?.state !== 'active' || !payload.items || typeof payload.items !== 'object' || Array.isArray(payload.items)) {
      throw unavailable('Stock availability service returned an invalid answer');
    }
    const items = new Map();
    for (const [code, mg] of Object.entries(payload.items)) {
      if (typeof mg !== 'number' || !Number.isFinite(mg) || mg < 0) throw unavailable('Stock availability service returned an invalid amount');
      items.set(code, mg);
    }
    return {
      active: true, asOf: typeof payload.asOf === 'string' ? payload.asOf : null,
      // null = missing from the active snapshot.
      mg: (code) => { const key = normalizeStockCode(code); return key !== null && items.has(key) ? items.get(key) : null; },
    };
  }
  return { lookup };
}

/**
 * Revalidate stock lines of a freshly quoted cart against the active snapshot.
 * A pure gate: it never edits the quoted lines, so the order fingerprint and the
 * persisted Stripe checkout parameters stay identical across retries. Not called
 * for an order that already has a Stripe session (the route reconciles those first).
 */
export async function assertStockOffersAvailable(items, stockAvailability) {
  if (!stockAvailability) return;
  const stockLines = (items || []).filter((item) => item?.source === 'stock');
  if (!stockLines.length) return;
  let state;
  try { state = await stockAvailability.lookup(stockLines.map((item) => item.code)); }
  catch (error) {
    console.error('Stock availability lookup failed during quote:', error.message);
    throw error instanceof StockAvailabilityError ? error : unavailable('Stock availability could not be checked');
  }
  if (!state.active) return;
  const compounds = new Map();
  for (const item of stockLines) {
    const key = JSON.stringify([item.source, item.rowId]);
    const entry = compounds.get(key) || { code: item.code, requestedMg: 0 };
    entry.requestedMg += item.amountMg * item.quantity;
    compounds.set(key, entry);
  }
  for (const { code, requestedMg } of compounds.values()) {
    const mg = state.mg(code);
    if (mg === null || mg < STOCK_MIN_OFFER_MG) {
      throw new StockAvailabilityError('COMPOUND_STOCK_UNAVAILABLE', 'A compound in your cart is no longer in stock. Search again.', 409);
    }
    if (requestedMg > mg) {
      throw new StockAvailabilityError('COMPOUND_STOCK_LIMIT', 'Requested packs exceed the quantity currently in stock. Search again.', 409);
    }
  }
}
