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
const notifications = read('client/src/pages/dashboard/notifications.jsx');
const routes = read('client/src/routes.jsx');
const folding = read('client/src/pages/dashboard/protein-folding.jsx');
const gromacs = read('client/src/pages/dashboard/gromacs-md.jsx');
const glioblastoma = read('client/src/pages/dashboard/glioblastoma-predict.jsx');

const checks = [
  ['dashboard exposes a skip link to main content', dashboard.includes('SkipLink') && dashboard.includes('id="main-content"')],
  ['navbar token balance uses tabular numerals', navbar.includes('tabular-nums') && navbar.includes('Simulation Tokens:')],
  ['navbar validation requests are cancellable', navbar.includes('validateTokenAndLoadUser(controller.signal)') && navbar.includes('controller.abort()')],
  ['navbar validation fetch receives its signal', navbar.includes('method: "POST",\n        signal,')],
  ['navbar validation has a hard timeout', navbar.includes('NAVBAR_VALIDATE_TIMEOUT_MS') && navbar.includes('window.setTimeout(() => controller.abort(), NAVBAR_VALIDATE_TIMEOUT_MS)')],
  ['home activity fetch has a hard timeout', dashboardhome.includes('DASHBOARD_FETCH_TIMEOUT_MS') && dashboardhome.includes('controller.abort()')],
  ['control panel activity fetch has a hard timeout', controlpanel.includes('CONTROL_PANEL_FETCH_TIMEOUT_MS') && controlpanel.includes('startPanelFetches')],
  ['signed-in landing is labeled Home, not Control Panel', routes.includes('name: "home"') && navbar.includes('controlpanel: "Home"') && !navbar.includes('Control Panel')],
  ['home page does not show compute-admin URLs', !controlpanel.includes('Compute services') && !controlpanel.includes('fetchComputeEndpoints')],
  ['notifications activity fetch has a hard timeout', notifications.includes('NOTIFICATIONS_FETCH_TIMEOUT_MS') && notifications.includes('controller.abort()')],
  ['cart enquiry and checkout have a hard timeout', navbar.includes('CART_FETCH_TIMEOUT_MS') && navbar.includes('Enquiry timed out') && navbar.includes('Checkout timed out')],
  ['dashboard home uses company wording, not workspace', dashboardhome.includes('company members') && dashboardhome.includes('in this company') && !dashboardhome.includes('workspace members')],
  ['protein folding stays readable in dark mode', folding.includes('dark:bg-slate-900') && folding.includes('dark:text-slate-100')],
  ['gromacs page stays readable in dark mode', gromacs.includes('dark:bg-slate-900') && gromacs.includes('dark:text-slate-100')],
  ['glioblastoma page stays readable in dark mode', glioblastoma.includes('dark:bg-slate-900') && glioblastoma.includes('dark:text-slate-100')],
  ['gromacs and glioblastoma requests abort on route exit', gromacs.includes('requestControllerRef.current?.abort()') && glioblastoma.includes('requestControllerRef.current?.abort()')],
  ['literature ghost chips stay readable in dark mode', literature.includes('variant="ghost"') && literature.includes('cb-activity-chip')],
  ['navbar initializes from the stored account', navbar.includes('useState(getStoredNavbarUser)')],
  ['mobile page finder has real destinations', navbar.includes('PAGE_DESTINATIONS') && navbar.includes('Find a dashboard page')],
  ['cart actions use non-blocking status UI', navbar.includes('showActionMessage') && !navbar.includes('alert(')],
  ['cart actions cannot be double-submitted', navbar.includes('disabled={cartAction !== null}')],
  ['cart actions abort on shell exit', navbar.includes('cartRequestControllerRef.current?.abort()') && navbar.includes('signal: controller.signal')],
  ['contact form describes the sender address honestly', contact.includes('Your email') && !contact.includes('Send to Email')],
  ['contact requests abort on route exit', contact.includes('requestControllerRef.current?.abort()') && contact.includes('signal: controller.signal')],
  ['contact form stays readable in dark mode', contact.includes('dark:text-slate-50') && contact.includes('dark:bg-slate-900') && contact.includes('dark:text-slate-100')],
  ['contact requests have a hard timeout', contact.includes('CONTACT_FETCH_TIMEOUT_MS') && contact.includes('controller.abort()')],
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
