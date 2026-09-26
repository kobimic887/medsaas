import { createHash } from 'node:crypto';
import express from 'express';
import { quoteCompoundCart } from '../utils/compoundShopOffers.js';
import { PRICE_BOOK_VERSION } from '../../shared/compoundPriceBook.js';
import {
  CHECKOUT_SESSION_ID, COMPOUND_ORDER_ID, CompoundOrderError, SHIPPING_NOTE,
  compoundOrderId, handleCompoundShopSession, orderItem, orderOwner, publicCompoundOrder,
} from '../utils/compoundShopOrders.js';

// Stripe SDK 18.3 ShippingAddressCollection.AllowedCountry, excluding its
// unknown-country sentinel ZZ. Keep international checkout available.
const SHIPPING_COUNTRIES = 'AC AD AE AF AG AI AL AM AO AQ AR AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CD CF CG CH CI CK CL CM CN CO CR CV CW CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HN HR HT HU ID IE IL IM IN IO IQ IS IT JE JM JO JP KE KG KH KI KM KN KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MK ML MM MN MO MQ MR MS MT MU MV MW MX MY MZ NA NC NE NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SZ TA TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG US UY UZ VA VC VE VG VN VU WF WS XK YE YT ZA ZM ZW'.split(' ');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function checkoutParams(order, appUrl) {
  const base = String(appUrl || '').replace(/\/$/, '');
  if (!/^https?:\/\//.test(base)) throw new CompoundOrderError(503, 'SHOP_UNAVAILABLE', 'Checkout is not configured.');
  const metadata = {
    purchaseType: 'pyxis_compounds', orderId: order._id, username: order.username,
    companyId: order.companyId, userId: order.userId,
  };
  return {
    mode: 'payment',
    payment_method_types: ['card'],
    payment_intent_data: { capture_method: 'automatic', metadata },
    client_reference_id: order._id,
    billing_address_collection: 'required',
    shipping_address_collection: { allowed_countries: SHIPPING_COUNTRIES },
    phone_number_collection: { enabled: true },
    line_items: order.items.map((item) => ({
      price_data: {
        currency: 'usd', unit_amount: item.unitAmountCents,
        product_data: {
          name: `${item.code} · ${item.amountMg} mg`,
          description: `${item.source === 'virtual' ? 'Made to order. ' : ''}${SHIPPING_NOTE}`,
        },
      },
      quantity: item.quantity,
    })),
    success_url: `${base}/dashboard/compound-orders?order_id=${order._id}&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${base}/dashboard/compound-orders?order_id=${order._id}&canceled=true`,
    metadata,
  };
}

function sendError(res, error) {
  const status = Number.isInteger(error.status) && error.status >= 400 && error.status < 500 ? error.status : 503;
  return res.status(status).json({
    error: status === 503 ? 'Compound checkout is temporarily unavailable. Please retry.' : error.message,
    code: typeof error.code === 'string' && /^[A-Z][A-Z_]+$/.test(error.code) ? error.code : (status === 503 ? 'SHOP_UNAVAILABLE' : 'SHOP_INVALID_REQUEST'),
  });
}

export function createCompoundShopRouter({ stripe, getOrders, secret, getAppUrl, quoteCart = quoteCompoundCart }) {
  const router = express.Router();
  const config = () => ({
    enabled: Boolean(stripe), paymentMode: 'automatic', currency: 'usd',
    priceBookVersion: PRICE_BOOK_VERSION, shippingNote: SHIPPING_NOTE, maxCompounds: 3,
  });
  const quote = (items) => quoteCart(items, { secret });
  router.get('/config', (_req, res) => res.json(config()));
  router.post('/quote', async (req, res) => {
    try { res.json({ ...await quote(req.body?.items), config: config() }); }
    catch (error) { sendError(res, error); }
  });
  router.post('/checkout', async (req, res) => {
    try {
      if (!stripe) throw new CompoundOrderError(503, 'SHOP_UNAVAILABLE', 'Checkout is not configured.');
      const owner = orderOwner(req.user);
      const key = req.body?.idempotencyKey;
      if (typeof key !== 'string' || !UUID.test(key)) throw new CompoundOrderError(400, 'SHOP_INVALID_REQUEST', 'A UUID checkout key is required.');
      const orders = await getOrders();
      const id = compoundOrderId(owner, key.toLowerCase());
      const requestFingerprint = createHash('sha256').update(JSON.stringify(
        Array.isArray(req.body?.items) ? req.body.items.map((item) => ({ offerToken: item?.offerToken, amountMg: item?.amountMg, quantity: item?.quantity })) : null
      )).digest('hex');
      let order = await orders.findOne({ _id: id });
      if (order?.requestFingerprint && order.requestFingerprint !== requestFingerprint) {
        throw new CompoundOrderError(409, 'SHOP_CHECKOUT_KEY_REUSED', 'This checkout key belongs to a different cart. Start a new checkout.');
      }
      const respondToExistingSession = async (saved) => {
        const session = await stripe.checkout.sessions.retrieve(saved.sessionId);
        if (session.metadata?.orderId !== saved._id || session.metadata?.purchaseType !== 'pyxis_compounds') {
          throw new CompoundOrderError(409, 'SHOP_SESSION_MISMATCH', 'Payment session does not match the order.');
        }
        await handleCompoundShopSession(session, { orders });
        const reconciled = await orders.findOne({ _id: saved._id });
        if (reconciled.status === 'paid') return res.status(409).json({
          code: 'SHOP_ORDER_ALREADY_PAID', error: 'This order is already paid.', orderId: saved._id,
        });
        if (session.status === 'expired') return res.status(409).json({
          code: 'SHOP_CHECKOUT_EXPIRED', error: 'This payment session expired. Review your cart to start a new checkout.', orderId: saved._id,
        });
        if (session.status === 'complete') return res.status(409).json({
          code: 'SHOP_PAYMENT_PENDING', error: 'Payment is still being confirmed. Check your order before another payment attempt.', orderId: saved._id,
        });
        if (session.status !== 'open' || !session.url) throw new Error('Payment session is not available');
        if (req.body.expectedTotalCents !== saved.totalCents || req.body.priceBookVersion !== saved.priceBookVersion) {
          return res.status(409).json({ code: 'SHOP_PRICES_CHANGED', error: 'Review the existing checkout total before paying.', quote: {
            items: saved.items, totalCents: saved.totalCents, currency: saved.currency, priceBookVersion: saved.priceBookVersion, fx: saved.fx,
          } });
        }
        return res.json({ url: session.url, sessionId: session.id, orderId: saved._id });
      };
      // Reconcile known attempts before validating expiring search offers. An
      // expired offer must not hide a payment that Stripe already completed.
      if (order?.sessionId && order.requestFingerprint) return await respondToExistingSession(order);
      const quoted = await quote(req.body?.items);
      if (req.body.expectedTotalCents !== quoted.totalCents || req.body.priceBookVersion !== quoted.priceBookVersion) {
        return res.status(409).json({ code: 'SHOP_PRICES_CHANGED', error: 'Review the current total before paying.', quote: quoted });
      }
      const items = quoted.items.map(orderItem);
      const fingerprint = createHash('sha256').update(JSON.stringify({ items, totalCents: quoted.totalCents, priceBookVersion: quoted.priceBookVersion })).digest('hex');
      if (!order) {
        const now = new Date();
        const candidate = {
          _id: id, ...owner, userId: String(req.user.userId || ''), items,
          totalCents: quoted.totalCents, currency: 'usd', priceBookVersion: quoted.priceBookVersion,
          fx: quoted.fx, fingerprint, requestFingerprint, status: 'awaiting_payment', fulfillmentStatus: 'pending', createdAt: now, updatedAt: now,
        };
        // Persist the exact Stripe request: retries remain identical even across
        // application deploys, changed app URLs or a concurrent request.
        candidate.checkoutParams = checkoutParams(candidate, getAppUrl(req));
        try { await orders.insertOne(candidate); order = candidate; }
        catch (error) {
          if (error.code !== 11000) throw error;
          order = await orders.findOne({ _id: id });
          if (!order) throw error;
        }
      }
      if (order.fingerprint !== fingerprint) throw new CompoundOrderError(409, 'SHOP_CHECKOUT_KEY_REUSED', 'This checkout key belongs to a different cart. Start a new checkout.');
      if (order.sessionId) return await respondToExistingSession(order);
      // Stripe may evict idempotency records after 24 hours. Never retry session
      // creation indefinitely after a lost response: that could double-charge.
      if (Date.now() - new Date(order.createdAt).getTime() > 20 * 60 * 60 * 1000) {
        throw new CompoundOrderError(409, 'SHOP_CHECKOUT_RECOVERY_REQUIRED', 'This checkout needs support review before another payment attempt.');
      }
      const session = await stripe.checkout.sessions.create(order.checkoutParams, { idempotencyKey: id });
      if (!CHECKOUT_SESSION_ID.test(session.id || '') || !session.url) throw new Error('Stripe returned an incomplete session');
      const attached = await orders.updateOne({ _id: id, $or: [{ sessionId: null }, { sessionId: session.id }] }, {
        $set: { sessionId: session.id, checkoutUrl: session.url, updatedAt: new Date() },
      });
      if (!attached.matchedCount) throw new Error('Conflicting Stripe session for order');
      return res.json({ url: session.url, sessionId: session.id, orderId: id });
    } catch (error) { return sendError(res, error); }
  });
  router.get('/orders', async (req, res) => {
    try {
      const orders = await getOrders();
      const rows = await orders.find(orderOwner(req.user)).sort({ createdAt: -1 }).limit(50).toArray();
      res.json({ orders: rows.map(publicCompoundOrder) });
    } catch (error) { sendError(res, error); }
  });
  router.get('/orders/:id', async (req, res) => {
    try {
      if (!COMPOUND_ORDER_ID.test(req.params.id)) throw new CompoundOrderError(400, 'SHOP_INVALID_REQUEST', 'Invalid order ID.');
      const orders = await getOrders();
      const filter = { _id: req.params.id, ...orderOwner(req.user) };
      let order = await orders.findOne(filter);
      if (!order) throw new CompoundOrderError(404, 'SHOP_ORDER_NOT_FOUND', 'Order not found.');
      const sessionId = req.query.session_id;
      if (sessionId !== undefined) {
        if (typeof sessionId !== 'string' || !CHECKOUT_SESSION_ID.test(sessionId) || (order.sessionId && order.sessionId !== sessionId)) {
          throw new CompoundOrderError(409, 'SHOP_SESSION_MISMATCH', 'Payment session does not match the order.');
        }
        if (!stripe) throw new CompoundOrderError(503, 'SHOP_UNAVAILABLE', 'Payment lookup is unavailable.');
        const session = await stripe.checkout.sessions.retrieve(sessionId);
        if (session.metadata?.orderId !== order._id || session.metadata?.purchaseType !== 'pyxis_compounds') {
          throw new CompoundOrderError(409, 'SHOP_SESSION_MISMATCH', 'Payment session does not match the order.');
        }
        await handleCompoundShopSession(session, { orders });
        order = await orders.findOne(filter);
      }
      res.json({ order: publicCompoundOrder(order) });
    } catch (error) { sendError(res, error); }
  });
  return router;
}
