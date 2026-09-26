import { createHash } from 'node:crypto';

export const COMPOUND_ORDER_ID = /^pc_[a-f0-9]{64}$/;
export const CHECKOUT_SESSION_ID = /^cs_(?:test_|live_)?[A-Za-z0-9]{8,240}$/;
export const SHIPPING_NOTE = 'Shipping is included in the listed USD price.';

export class CompoundOrderError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function orderOwner(user) {
  if (!user?.username) throw new CompoundOrderError(403, 'SHOP_IDENTITY_REQUIRED', 'An active account is required.');
  return { username: String(user.username), companyId: String(user.companyId || '') };
}

export function compoundOrderId(owner, key) {
  return `pc_${createHash('sha256').update(JSON.stringify([owner.username, owner.companyId, key])).digest('hex')}`;
}

// Explicit projection prevents signed offer tokens, request hashes and internal
// payment parameters from leaking into order history or Stripe product metadata.
export function orderItem(item) {
  const fields = ['key', 'source', 'rowId', 'code', 'smiles', 'amountMg', 'quantity', 'eur', 'unitAmountCents', 'lineTotalCents', 'availableMg', 'leadTime'];
  return Object.fromEntries(fields.filter((field) => item[field] !== undefined).map((field) => [field, item[field]]));
}

export function publicCompoundOrder(order) {
  return {
    orderId: order._id,
    status: order.status,
    fulfillmentStatus: order.fulfillmentStatus || 'pending',
    items: order.items.map(orderItem),
    currency: order.currency,
    totalCents: order.totalCents,
    priceBookVersion: order.priceBookVersion,
    fx: order.fx,
    shippingNote: SHIPPING_NOTE,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
    paidAt: order.paidAt || null,
    shipping: order.shipping || null,
    customer: order.customer || null,
  };
}

function safeAddress(address) {
  if (!address) return null;
  return Object.fromEntries(['line1', 'line2', 'city', 'state', 'postal_code', 'country'].map((field) => [field, typeof address[field] === 'string' ? address[field].slice(0, 500) : null]));
}

function sessionContacts(session) {
  const shipping = session.collected_information?.shipping_details || session.shipping_details;
  const customer = session.customer_details;
  return {
    shipping: shipping ? { name: shipping.name || null, address: safeAddress(shipping.address) } : null,
    customer: customer ? {
      name: customer.name || null,
      email: customer.email || null,
      phone: customer.phone || null,
      address: safeAddress(customer.address),
    } : null,
  };
}

// Call only with a Stripe API response or an event whose signature was verified.
// Browser query parameters are never evidence of payment.
export async function handleCompoundShopSession(session, { orders, eventType } = {}) {
  if (session?.metadata?.purchaseType !== 'pyxis_compounds') return false;
  const metadata = session.metadata;
  if (!COMPOUND_ORDER_ID.test(metadata.orderId || '') || !CHECKOUT_SESSION_ID.test(session.id || '')) {
    throw new CompoundOrderError(409, 'SHOP_SESSION_MISMATCH', 'Payment session does not match the order.');
  }
  const order = await orders.findOne({ _id: metadata.orderId });
  if (!order) throw new CompoundOrderError(409, 'SHOP_ORDER_NOT_FOUND', 'Payment order was not found.');
  if (metadata.username !== order.username || metadata.companyId !== order.companyId ||
      String(metadata.userId || '') !== String(order.userId || '') ||
      session.client_reference_id !== order._id ||
      (order.sessionId && order.sessionId !== session.id) ||
      session.amount_total !== order.totalCents || session.currency !== order.currency || session.mode !== 'payment') {
    throw new CompoundOrderError(409, 'SHOP_SESSION_MISMATCH', 'Payment session does not match the order.');
  }
  let status = 'awaiting_payment';
  if (session.payment_status === 'paid' && session.status === 'complete') status = 'paid';
  else if (session.status === 'expired' || eventType === 'checkout.session.expired') status = 'expired';
  else if (eventType === 'checkout.session.async_payment_failed') status = 'payment_failed';
  const now = new Date();
  const update = { sessionId: session.id, status, updatedAt: now };
  if (status === 'paid') {
    Object.assign(update, sessionContacts(session), { paidAt: order.paidAt || now });
  }
  // A delayed unpaid event must never turn a paid order back into an unpaid one.
  // Matching the session atomically also closes concurrent reconciliation races.
  const filter = { _id: order._id, $or: [{ sessionId: null }, { sessionId: session.id }] };
  filter.status = { $ne: 'paid' };
  const result = await orders.updateOne(filter, { $set: update });
  if (!result.matchedCount) {
    const latest = await orders.findOne({ _id: order._id });
    if (latest?.sessionId !== session.id || latest.status !== 'paid') {
      throw new CompoundOrderError(409, 'SHOP_SESSION_MISMATCH', 'Payment session does not match the order.');
    }
  }
  return true;
}
