import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dashboard = readFileSync(path.join(root, 'client/src/pages/dashboard/paidplans.jsx'), 'utf8');
const marketing = readFileSync(path.join(root, 'client/src/pages/main/paidplansdescription.jsx'), 'utf8');
const server = readFileSync(path.join(root, 'server/index.js'), 'utf8');

const checks = [
  ['both plan screens share the current client catalog', dashboard.includes('TOKEN_PLANS') && marketing.includes('TOKEN_PLANS')],
  ['dashboard does not require an unused Stripe publishable key', !dashboard.includes('VITE_STRIPE_PUBLISHABLE_KEY')],
  ['marketing does not expose environment setup instructions', !marketing.includes('VITE_STRIPE_PUBLISHABLE_KEY')],
  ['marketing makes the one-time contract explicit', marketing.includes('There is no recurring self-serve subscription')],
  ['retired 14-day trial claim is absent', !marketing.includes('14-day')],
  ['marketing sends signed-in users to the real plans route', marketing.includes("signedIn ? '/dashboard/paid-plans' : '/auth/sign-up'")],
  ['dashboard checkout requests abort on route exit', dashboard.includes('requestControllerRef.current?.abort()')],
  ['checkout return parameters are removed after display', dashboard.includes("urlParams.delete('session_id')")],
  ['only the selected plan shows a progress state', dashboard.includes('loadingPlan === plan.name')],
  ['plan buttons have plan-specific accessible names', /aria-label=\{plan\.name.*Purchase.*plan\.name.*credit pack/s.test(dashboard)],
  ['both server plan routes use the canonical builder', (server.match(/buildPlanCheckoutSessionParams\(\{/g) || []).length === 2],
  ['legacy subscription mode is absent', !server.includes("mode: 'subscription'")],
  ['obsolete dashboard return route is absent', !server.includes('/dashboard/paidplans?')],
  ['checkout failures do not expose provider error details',
    (server.match(/Unable to start checkout\. Please try again\./g) || []).length === 2
      && server.includes('Unable to retrieve checkout details. Please try again.')],
];

const failures = checks.filter(([, passed]) => !passed).map(([label]) => label);
if (failures.length) {
  console.error('Plan UX regression check failed:');
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log(`✓ Plan UX check passed (${checks.length} invariants)`);
