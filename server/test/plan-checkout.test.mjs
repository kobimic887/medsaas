import { TOKEN_PLANS } from '../../client/src/utils/tokenPlans.js';
import {
  buildPlanCheckoutSessionParams,
  getPlan,
  PLAN_CATALOG,
} from '../utils/planCheckout.js';

let passed = 0;
let failed = 0;

function check(label, condition, extra = '') {
  if (condition) {
    console.log(`  PASS ${label}`);
    passed += 1;
  } else {
    console.log(`  FAIL ${label} ${extra}`);
    failed += 1;
  }
}

function checkThrows(label, fn, expectedMessage) {
  try {
    fn();
    check(label, false, '(did not throw)');
  } catch (error) {
    check(label, error.message.includes(expectedMessage), `(${error.message})`);
  }
}

console.log('Plan catalog + checkout contract:\n');

check('client and server expose the same number of plans', TOKEN_PLANS.length === Object.keys(PLAN_CATALOG).length);
for (const clientPlan of TOKEN_PLANS) {
  const serverPlan = getPlan(clientPlan.name);
  check(`${clientPlan.name} exists in the server catalog`, Boolean(serverPlan));
  check(`${clientPlan.name} credits match`, serverPlan?.credits === clientPlan.credits);
  check(`${clientPlan.name} price matches`, serverPlan?.priceCents === clientPlan.price * 100);
}

check('plan names are trimmed', getPlan(' Standard ') === PLAN_CATALOG.Standard);
check('unknown plans fail closed', getPlan('Budget') === null && getPlan(null) === null);

const checkout = buildPlanCheckoutSessionParams({
  appUrl: 'https://app.example.test/',
  plan: PLAN_CATALOG.Standard,
  user: {
    username: 'researcher',
    userId: 'user-1',
    companyId: 'company-1',
    companyName: 'Example Lab',
  },
});

check('credit packs use one-time payment mode', checkout.mode === 'payment');
check('credit packs never carry recurring Stripe data', !('recurring' in checkout.line_items[0].price_data));
check('server-owned price reaches Stripe', checkout.line_items[0].price_data.unit_amount === 2000);
check('server-owned credit description reaches Stripe', checkout.line_items[0].price_data.product_data.description === '50 simulation tokens');
check('success returns to the real dashboard route', checkout.success_url === 'https://app.example.test/dashboard/paid-plans?success=true&session_id={CHECKOUT_SESSION_ID}');
check('cancel returns to the real dashboard route', checkout.cancel_url === 'https://app.example.test/dashboard/paid-plans?canceled=true');
check('checkout metadata binds the authenticated owner', checkout.metadata.username === 'researcher' && checkout.metadata.companyId === 'company-1');
checkThrows('free trial cannot enter Stripe checkout', () => buildPlanCheckoutSessionParams({
  appUrl: 'https://app.example.test',
  plan: PLAN_CATALOG.Trial,
  user: { username: 'researcher' },
}), 'paid server-side plan');
checkThrows('checkout requires an authenticated user', () => buildPlanCheckoutSessionParams({
  appUrl: 'https://app.example.test',
  plan: PLAN_CATALOG.Standard,
  user: {},
}), 'authenticated user');
checkThrows('checkout requires a public app URL', () => buildPlanCheckoutSessionParams({
  appUrl: '/relative',
  plan: PLAN_CATALOG.Standard,
  user: { username: 'researcher' },
}), 'public application URL');

console.log('\n================================================');
console.log(`Result: ${passed} passed, ${failed} failed`);
console.log('================================================');
process.exit(failed === 0 ? 0 : 1);
