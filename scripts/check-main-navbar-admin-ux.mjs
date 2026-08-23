import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const navbar = readFileSync(path.join(root, 'client/src/widgets/layout/main-navbar.jsx'), 'utf8');

const checks = [
  ['desktop admin menu opens Company Admin', /<MenuItem[\s\S]*?<Link to="\/dashboard\/company-admin"[\s\S]*?>\s*Admin Panel/.test(navbar)],
  ['mobile admin menu exposes Company Admin', /<Link\s+to="\/dashboard\/company-admin"\s+onClick=\{\(\) => setMobileOpen\(false\)\}[\s\S]*?>\s*Admin Panel/.test(navbar)],
];

const failures = checks.filter(([, passed]) => !passed).map(([label]) => label);
if (failures.length) {
  console.error('Main navbar admin UX regression check failed:');
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log(`✓ Main navbar admin UX check passed (${checks.length} invariants)`);
