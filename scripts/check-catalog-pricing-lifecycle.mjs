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

// Execute the real navbar handler: old persisted baskets must surface the new
// refusal, preserve their contents, and never redirect to a payment page.
const handlerSource = dashboardNavbar.split('  const handleCheckout = async () => {')[1].split('\n  const logout =')[0].trim().replace(/};$/, '');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const runCheckout = new AsyncFunction(
  'cartItems', 'window', 'cartRequestControllerRef', 'cartTimeoutRef', 'CART_FETCH_TIMEOUT_MS',
  'setCartAction', 'getAuthToken', 'API_CONFIG', 'fetch', 'showActionMessage',
  'persistMoleculeCart', 'cartItemsFromPriceReview', 'cartTotalFromItems', 'loadCartFromStorage', 'console',
  handlerSource,
);
for (const source of ['catalog', 'stock']) {
  const basket = [{ source, catalogId: 'fixture-id', amount: 1, totalPrice: 100 }];
  const messages = [];
  let persisted = false;
  let requested = false;
  const windowStub = { location: { href: '' }, clearTimeout() {}, setTimeout() { return 1; } };
  await runCheckout(
    basket, windowStub, { current: null }, { current: null }, 30000,
    () => {}, () => 'fixture-token', { buildUrl: (p) => p },
    async (url, options) => {
      requested = url === '/create-checkout-session-onetime' && options.headers.Authorization === 'Bearer fixture-token';
      return { ok: false, status: 503, json: async () => ({ code: 'CATALOG_RETIRED', error: 'Verified compound purchase offers are unavailable.' }) };
    },
    (message) => messages.push(message), () => { persisted = true; },
    () => null, () => 0, () => {}, { error() {} },
  );
  check(`${source} legacy basket reaches authenticated refusal`, requested);
  check(`${source} refusal displays the server explanation`, messages.some((message) => message.includes('Verified compound purchase offers are unavailable.')));
  check(`${source} refusal never changes basket or redirects to Stripe`, !persisted && windowStub.location.href === '' && basket.length === 1);
}
console.log(`\ncatalog-pricing lifecycle: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
