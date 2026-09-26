import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(path.join(root, rel), 'utf8');
const indexJs = read('server/index.js');
const policy = read('server/utils/catalogAccessPolicy.js');
const dashboardNavbar = read('client/src/widgets/layout/dashboard-navbar.jsx');
let passed = 0;
let failed = 0;
function check(label, condition) {
  console.log(`  ${condition ? 'PASS' : 'FAIL'} ${label}`);
  if (condition) passed++; else failed++;
}

console.log('Retired catalog checkout lifecycle:\n');
check('catalog retirement is authenticated and independent of staging mode', indexJs.includes('app.use(createRetiredCatalogRouter({ middleware: [ensureMongoConnected, authenticateToken, requireActiveUser] }));'));
check('retirement answers a recoverable 503 with owned search sources', policy.includes('res.status(503)') && policy.includes("code: 'CATALOG_RETIRED'") && policy.includes("['stock', 'macrocycles', 'open']"));
check('molecule checkout does not import or invoke supplier repricing', !indexJs.includes('priceMoleculeCartFromCatalog') && !indexJs.includes('moleculeCartPriceReview'));
const checkoutRoute = indexJs.split("app.post('/create-checkout-session-onetime'")[1].split("app.post('/create-checkout-session'")[0];
check('the one-time route refuses molecule checkout locally', checkoutRoute.includes('return refuseRetiredCatalog(req, res);'));
check('credit packs retain their separate server-priced Stripe branch', checkoutRoute.includes('stripe.checkout.sessions.create') && checkoutRoute.includes('plan') && checkoutRoute.indexOf('stripe.checkout.sessions.create') < checkoutRoute.indexOf('return refuseRetiredCatalog(req, res);'));

// Execute cart operations and the actual navbar checkout handler. No payment
// SDK/network is used; HTTP replies are injected at the real request boundary.
const shop = await import('../client/src/utils/compoundShop.js');
const { stockResultsFromPayload } = await import('../client/src/utils/stockResults.js');
const { macrocycleResultsFromPayload } = await import('../client/src/utils/macrocycleResults.js');
const { addShopPack, shopRequestItems, shopCartTotal, readShopCart, writeShopCart, basketSignature, checkoutAttempt, cartAfterConfirmedOrder } = shop;
const storage = () => { const data = new Map(); return { getItem: (key) => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) }; };
const offer = (rowId = 1, source = 'stock') => ({ token: `token-${source}-${rowId}`, source, rowId, code: `BAS ${rowId}`, smiles: 'CC', packs: [{ mg: 1, eur: 170, unitAmountCents: 19324, currency: 'usd' }] });
const searchHit = { molecule_id: 1, canonical_smiles: 'CC', metadata: { MAIN_BAS: 'RPX 1' }, shopOffer: offer(1, 'real') };
check('stock normalization preserves server offer unchanged', stockResultsFromPayload({ results: [searchHit] })[0].shopOffer === searchHit.shopOffer);
check('macrocycle normalization preserves server offer unchanged', macrocycleResultsFromPayload({ results: [searchHit] }, 'real')[0].shopOffer === searchHit.shopOffer);
let items = addShopPack([], offer(), 1);
items = addShopPack(items, offer(), 1);
check('repeated pack increments quantity and uses integer-cent totals', items.length === 1 && items[0].quantity === 2 && shopCartTotal(items) === 38648);
check('checkout payload contains only signed identity and pack selection', JSON.stringify(shopRequestItems(items)) === JSON.stringify([{ offerToken: 'token-stock-1', amountMg: 1, quantity: 2 }]));
let refused = false;
try { addShopPack(addShopPack(addShopPack(items, offer(2), 1), offer(3), 1), offer(4), 1); } catch { refused = true; }
check('fourth distinct compound is refused', refused);
refused = false;
try { addShopPack(items, offer(), 10); } catch { refused = true; }
check('unsupported pack is refused', refused);
refused = false;
try { shopRequestItems([{ source: 'catalog' }]); } catch { refused = true; }
check('legacy basket cannot become an owned-shop request', refused);
const memory = storage();
writeShopCart(memory, items);
check('cart reload preserves owned token and quantity', JSON.stringify(readShopCart(memory)) === JSON.stringify(items));
const signature = basketSignature(items);
check('checkout retries reuse an idempotency key', checkoutAttempt(memory, signature, () => 'attempt-1') === checkoutAttempt(memory, signature, () => 'attempt-2'));
check('re-adding the same purchased pack creates a distinct basket signature', basketSignature(addShopPack(addShopPack([], offer(), 1), offer(), 1)) !== signature);
check('changed basket uses a new checkout attempt', checkoutAttempt(memory, `${signature}changed`, () => 'attempt-3') === 'attempt-3');
const paidOrder = { status: 'paid', items: [{ source: 'stock', rowId: 1, amountMg: 1, quantity: 2 }] };
check('paid order clears only exact locally recorded purchased lines', cartAfterConfirmedOrder([...items, ...addShopPack([], offer(2), 1)], paidOrder, items).length === 1);
check('redirect params and unpaid orders never clear basket', cartAfterConfirmedOrder(items, { ...paidOrder, status: 'pending' }, items).length === 1 && cartAfterConfirmedOrder(items, paidOrder).length === 1);
check('re-added identical pack survives delayed payment return', cartAfterConfirmedOrder(addShopPack(addShopPack([], offer(), 1), offer(), 1), paidOrder, items).length === 1);
check('newer offer or changed quantity survives delayed payment return', cartAfterConfirmedOrder([{ ...items[0], offerToken: 'new-token' }], paidOrder, items).length === 1 && cartAfterConfirmedOrder([{ ...items[0], quantity: 3 }], paidOrder, items).length === 1);
const handlerSource = dashboardNavbar.split('  const handleCheckout = async () => {')[1].split('\n  const logout =')[0].trim().replace(/};$/, '');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const names = ['readShopCart', 'localStorage', 'shopRequestItems', 'basketSignature', 'reviewedQuoteRef', 'cartRequestControllerRef', 'cartTimeoutRef', 'window', 'CART_FETCH_TIMEOUT_MS', 'setCartAction', 'fetch', 'API_CONFIG', 'getAuthToken', 'checkoutAttempt', 'crypto', 'setReviewedQuote', 'showActionMessage'];
const execute = new AsyncFunction(...names, handlerSource);
const mem = storage(); writeShopCart(mem, items);
const review = { current: null }; const messages = []; const requests = []; let nextReply;
const win = { location: { href: '' }, setTimeout: () => 1, clearTimeout() {} };
const run = () => execute(readShopCart, mem, shopRequestItems, basketSignature, review, { current: null }, { current: null }, win, 15000, () => {}, async (url, options) => { requests.push({ url, body: JSON.parse(options.body), headers: options.headers }); return nextReply; }, { buildApiUrl: (url) => url }, () => 'fixture-auth', checkoutAttempt, { randomUUID: () => 'attempt-fixture' }, () => {}, (message) => messages.push(message));
const quote = { items: paidOrder.items, totalCents: 38648, priceBookVersion: 'v1', shippingNote: 'Shipping included', paymentMode: 'automatic' };
nextReply = { ok: true, status: 200, json: async () => quote }; await run();
check('first checkout click requests authenticated server quote and never redirects', requests[0].url.endsWith('/quote') && requests[0].headers.Authorization === 'Bearer fixture-auth' && win.location.href === '' && review.current.quote.totalCents === 38648);
nextReply = { ok: false, status: 409, json: async () => ({ code: 'SHOP_PRICES_CHANGED', quote: { ...quote, totalCents: 39000 } }) }; await run();
check('changed price requires another explicit click with updated quote', review.current.quote.totalCents === 39000 && win.location.href === '' && messages.at(-1).includes('Prices changed'));
nextReply = { ok: false, status: 503, json: async () => ({ error: 'Temporary payment issue' }) }; await run();
check('checkout failure preserves basket and does not redirect', readShopCart(mem).length === 1 && win.location.href === '');
nextReply = { ok: true, status: 200, json: async () => ({ url: 'https://checkout.stripe.com/c/pay/fixture', orderId: 'order-fixture' }) }; await run();
check('accepted review submits authoritative expected total and stable retry key', requests.at(-1).body.expectedTotalCents === 39000 && requests.at(-1).body.priceBookVersion === 'v1' && requests.at(-1).body.idempotencyKey === requests.at(-2).body.idempotencyKey);
check('successful checkout saves basket snapshot then redirects to Stripe', win.location.href === 'https://checkout.stripe.com/c/pay/fixture' && JSON.parse(mem.getItem('compoundOrderCart:order-fixture')).length === 1 && readShopCart(mem).length === 1);
console.log(`\ncatalog-pricing lifecycle: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
