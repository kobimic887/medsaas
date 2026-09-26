import { createHmac, timingSafeEqual } from 'node:crypto';
import { PRICE_BOOK_VERSION, PRICE_GUIDE_EUR_USD, workbookPacksForRow } from '../../shared/compoundPriceBook.js';

const OFFER_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_TOKEN_LENGTH = 24000;
const MAX_CART_LINES = 24;
const PURPOSE = 'pyxis-owned-compound-offer-v1';

export class CompoundShopError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = 'CompoundShopError';
    this.status = status;
    this.code = code;
  }
}

function fail(code, message, status) { throw new CompoundShopError(code, message, status); }

function signingKey(secret) {
  if (typeof secret !== 'string' || secret.length < 16) {
    throw new Error('Compound offer signing requires a configured secret of at least 16 characters.');
  }
  return createHmac('sha256', secret).update(PURPOSE).digest();
}

function signature(payload, secret) {
  return createHmac('sha256', signingKey(secret)).update(payload).digest('base64url');
}

function positiveDecimal(value) {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  // Search metadata contains float32 quantities such as 8.3999996 mg. Preserve
  // their full numeric value; limiting decimal places incorrectly hides stock.
  if (typeof value === 'string' && !/^(?:0|[1-9]\d*)(?:\.\d{1,15})?$/.test(value)) return null;
  const number = Number(value);
  return Number.isFinite(number) && number > 0 && number <= 1000000000 ? number : null;
}

function canonicalIdentity(input) {
  if (!input || !['stock', 'real', 'virtual'].includes(input.source)) return null;
  const rowId = typeof input.rowId === 'string' ? input.rowId.trim()
    : Number.isSafeInteger(input.rowId) && input.rowId >= 0 ? String(input.rowId) : '';
  if (!rowId || rowId.length > 128 || [...rowId].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) return null;
  if (typeof input.code !== 'string' || input.code.length > 100) return null;
  if (typeof input.smiles !== 'string' || !input.smiles.trim() || input.smiles.length > 12000) return null;
  const code = input.code.trim();
  const price = workbookPacksForRow(input.source, code);
  if (!price) return null;
  const availableMg = input.source === 'virtual' ? null : positiveDecimal(input.availableMg);
  if (input.source !== 'virtual' && availableMg === null) return null;
  const leadTime = input.leadTime == null ? null : String(input.leadTime).trim();
  if (leadTime !== null && (leadTime.length > 120 || typeof input.leadTime === 'object')) return null;
  return { source: input.source, rowId, code, smiles: input.smiles, availableMg, leadTime };
}

function publicOffer(payload, token) {
  const { purpose: _purpose, issuedAt, expiresAt, ...identity } = payload;
  const packs = workbookPacksForRow(payload.source, payload.code).packs
    .filter(({ mg }) => payload.source === 'virtual' || mg <= payload.availableMg);
  return { ...identity, token, packs, issuedAt: new Date(issuedAt).toISOString(), expiresAt: new Date(expiresAt).toISOString() };
}

// Call only on trusted search-service rows. Never expose a client-driven mint route.
export function mintCompoundOffer(input, { secret, now = Date.now() } = {}) {
  signingKey(secret);
  if (!Number.isSafeInteger(now) || now < 0) throw new TypeError('now must be epoch milliseconds.');
  const identity = canonicalIdentity(input);
  if (!identity) return null;
  if (identity.source !== 'virtual' && identity.availableMg < 1) return null;
  const payload = { purpose: PURPOSE, priceBookVersion: PRICE_BOOK_VERSION, ...identity, issuedAt: now, expiresAt: now + OFFER_TTL_MS };
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const token = `${encoded}.${signature(encoded, secret)}`;
  if (token.length > MAX_TOKEN_LENGTH) return null;
  return publicOffer(payload, token);
}

function verifyOffer(token, secret, now) {
  if (typeof token !== 'string' || token.length > MAX_TOKEN_LENGTH || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(token)) {
    fail('INVALID_COMPOUND_OFFER', 'Search again to obtain a valid compound offer.');
  }
  const [encoded, supplied] = token.split('.');
  const expected = signature(encoded, secret);
  if (!timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) fail('INVALID_COMPOUND_OFFER', 'The compound offer could not be verified.');
  let payload;
  try { payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')); }
  catch { fail('INVALID_COMPOUND_OFFER', 'The compound offer could not be read.'); }
  if (!payload || payload.purpose !== PURPOSE || payload.priceBookVersion !== PRICE_BOOK_VERSION || !canonicalIdentity(payload)
    || !Number.isSafeInteger(payload.issuedAt) || !Number.isSafeInteger(payload.expiresAt)
    || payload.issuedAt < 0 || payload.issuedAt > now || payload.expiresAt - payload.issuedAt !== OFFER_TTL_MS) {
    fail('INVALID_COMPOUND_OFFER', 'Search again to refresh the compound offer.');
  }
  if (payload.expiresAt <= now) fail('SHOP_OFFER_EXPIRED', 'This compound offer expired. Search again to refresh it.', 409);
  return payload;
}

export function quoteCompoundCart(items, { secret, now = Date.now() } = {}) {
  signingKey(secret);
  if (!Number.isSafeInteger(now) || now < 0) throw new TypeError('now must be epoch milliseconds.');
  if (!Array.isArray(items) || !items.length || items.length > MAX_CART_LINES) fail('INVALID_COMPOUND_CART', 'Choose between 1 and 24 compound packs.');
  const compounds = new Map();
  const seenPacks = new Set();
  const canonicalItems = items.map((item) => {
    if (!item || typeof item !== 'object') fail('INVALID_COMPOUND_CART', 'Invalid compound cart item.');
    const offer = verifyOffer(item.offerToken, secret, now);
    if (!Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 10) fail('INVALID_COMPOUND_QUANTITY', 'Pack quantity must be a whole number from 1 to 10.');
    if (!Number.isInteger(item.amountMg)) fail('INVALID_COMPOUND_PACK', 'Choose an available workbook pack size.');
    const pack = workbookPacksForRow(offer.source, offer.code).packs.find(({ mg }) => mg === item.amountMg);
    if (!pack) fail('INVALID_COMPOUND_PACK', 'This pack size is not in the approved workbook tier.');
    const compoundKey = JSON.stringify([offer.source, offer.rowId]);
    const key = JSON.stringify([offer.source, offer.rowId, pack.mg]);
    if (seenPacks.has(key)) fail('DUPLICATE_COMPOUND_PACK', 'Combine repeated packs into one cart line.');
    seenPacks.add(key);
    const existing = compounds.get(compoundKey);
    // Different signed snapshots must not combine to inflate available stock.
    if (existing && (existing.code !== offer.code || existing.smiles !== offer.smiles)) fail('INVALID_COMPOUND_OFFER', 'Conflicting compound identities. Search again.');
    compounds.set(compoundKey, {
      code: offer.code,
      smiles: offer.smiles,
      requestedMg: (existing?.requestedMg || 0) + pack.mg * item.quantity,
      availableMg: offer.source === 'virtual' ? null : Math.min(existing?.availableMg ?? Infinity, offer.availableMg),
    });
    return {
      key, source: offer.source, rowId: offer.rowId, code: offer.code, smiles: offer.smiles,
      amountMg: pack.mg, quantity: item.quantity, eur: pack.eur,
      unitAmountCents: pack.unitAmountCents, lineTotalCents: pack.unitAmountCents * item.quantity,
      currency: 'usd', offerToken: item.offerToken, leadTime: offer.leadTime, availableMg: offer.availableMg,
    };
  });
  if (compounds.size > 3) fail('COMPOUND_TIER_LIMIT', 'The approved price tier allows at most 3 distinct compounds per order.');
  for (const compound of compounds.values()) {
    if (compound.availableMg !== null && compound.requestedMg > compound.availableMg) fail('COMPOUND_STOCK_LIMIT', 'Requested packs exceed the quantity in the catalog snapshot.');
  }
  return {
    items: canonicalItems,
    totalCents: canonicalItems.reduce((sum, item) => sum + item.lineTotalCents, 0),
    currency: 'usd', priceBookVersion: PRICE_BOOK_VERSION, fx: PRICE_GUIDE_EUR_USD,
  };
}
