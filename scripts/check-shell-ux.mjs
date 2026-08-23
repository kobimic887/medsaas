import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => readFileSync(path.join(root, relativePath), 'utf8');
const navbar = read('client/src/widgets/layout/dashboard-navbar.jsx');
const dashboard = read('client/src/layouts/dashboard.jsx');
const dashboardhome = read('client/src/pages/dashboard/dashboardhome.jsx');
const controlpanel = read('client/src/pages/dashboard/controlpanel.jsx');
const literature = read('client/src/pages/dashboard/literature.jsx');
const contact = read('client/src/pages/main/contact-us.jsx');
const currency = read('client/src/utils/algo/algo.jsx');
const generation = read('client/src/pages/dashboard/generate-molecules.jsx');
const companyAdmin = read('client/src/pages/dashboard/company-admin.jsx');

const checks = [
  ['dashboard exposes a skip link to main content', dashboard.includes('SkipLink') && dashboard.includes('id="main-content"')],
  ['navbar token balance uses tabular numerals', navbar.includes('tabular-nums') && navbar.includes('Simulation Tokens:')],
  ['navbar validation requests are cancellable', navbar.includes('validateTokenAndLoadUser(controller.signal)') && navbar.includes('controller.abort()')],
  ['navbar validation fetch receives its signal', navbar.includes('method: "POST",\n        signal,')],
  ['navbar validation has a hard timeout', navbar.includes('NAVBAR_VALIDATE_TIMEOUT_MS') && navbar.includes('window.setTimeout(() => controller.abort(), NAVBAR_VALIDATE_TIMEOUT_MS)')],
  ['home activity fetch has a hard timeout', dashboardhome.includes('DASHBOARD_FETCH_TIMEOUT_MS') && dashboardhome.includes('controller.abort()')],
  ['control panel ghost chips stay readable in dark mode', controlpanel.includes('variant="ghost"') && controlpanel.includes('cb-activity-chip')],
  ['literature ghost chips stay readable in dark mode', literature.includes('variant="ghost"') && literature.includes('cb-activity-chip')],
  ['navbar initializes from the stored account', navbar.includes('useState(getStoredNavbarUser)')],
  ['mobile page finder has real destinations', navbar.includes('PAGE_DESTINATIONS') && navbar.includes('Find a dashboard page')],
  ['cart actions use non-blocking status UI', navbar.includes('showActionMessage') && !navbar.includes('alert(')],
  ['cart actions cannot be double-submitted', navbar.includes('disabled={cartAction !== null}')],
  ['cart actions abort on shell exit', navbar.includes('cartRequestControllerRef.current?.abort()') && navbar.includes('signal: controller.signal')],
  ['contact form describes the sender address honestly', contact.includes('Your email') && !contact.includes('Send to Email')],
  ['contact requests abort on route exit', contact.includes('requestControllerRef.current?.abort()') && contact.includes('signal: controller.signal')],
  ['external currency lookups have a hard timeout', currency.includes('AbortSignal.timeout(EXTERNAL_LOOKUP_TIMEOUT_MS)')],
  ['external currency lookups are shared per page session', currency.includes('exchangeRatePromise') && currency.includes('userCountryPromise')],
  ['external lookup payloads are validated', currency.includes('Number.isFinite(rate)') && currency.includes('/^[A-Z]{2}$/')],
  ['generated-molecule previews share one bounded fallback', generation.includes('showStructurePreviewFallback') && !generation.includes('maxRetries')],
  ['generated-molecule previews preserve the submitted SMILES', !generation.includes('simplifiedSmiles')],
  ['generated-molecule requests abort on route exit', generation.includes('requestControllerRef.current?.abort()') && generation.includes('signal: controller.signal')],
  ['company member removal uses inline confirmation', /Confirm removal of .*member\.username/.test(companyAdmin) && !companyAdmin.includes('window.confirm(')],
  ['company feedback uses one replaceable timer', companyAdmin.includes('messageTimerRef.current = window.setTimeout')],
  ['company feedback timer clears on route exit', companyAdmin.includes('window.clearTimeout(messageTimerRef.current)')],
  ['company admin fetches abort on route exit', companyAdmin.includes('refreshAll(controller.signal)') && companyAdmin.includes('return () => controller.abort()')],
];

const failures = checks.filter(([, passed]) => !passed).map(([label]) => label);
if (failures.length) {
  console.error('Dashboard shell UX regression check failed:');
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log(`✓ Dashboard shell UX check passed (${checks.length} invariants)`);
