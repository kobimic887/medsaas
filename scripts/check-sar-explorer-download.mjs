#!/usr/bin/env node
// SAR Explorer download page: executes the link and platform logic, and checks that the
// page is routed, listed in navigation and names the upstream program it is built on.
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => readFileSync(path.join(root, relativePath), 'utf8');
const util = await import(pathToFileURL(path.join(root, 'client/src/utils/sarExplorer.js')).href);
const page = read('client/src/pages/dashboard/sar-explorer.jsx');
const routes = read('client/src/routes.jsx');
const navbar = read('client/src/widgets/layout/dashboard-navbar.jsx');

const {
  SAR_EXPLORER_INSTALLERS: installers,
  SAR_EXPLORER_RELEASES_URL: releases,
  SAR_EXPLORER_REPOSITORY_URL: repository,
  detectSarExplorerInstaller: detect,
  sarExplorerDownloadUrl: url,
} = util;
const byId = Object.fromEntries(installers.map((installer) => [installer.id, installer]));
const chrome = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36';
const macSafari = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18 Safari/605.1.15';

const checks = [
  ['four installers with distinct ids and files',
    installers.length === 4
    && new Set(installers.map(({ id }) => id)).size === 4
    && new Set(installers.map(({ file }) => file)).size === 4],
  // These names are produced by pyxis/stable-installer-names.sh in the SAR Explorer repository.
  ['installer files use the release names the program\'s CI publishes',
    byId.windows?.file === 'Pyxis-SAR-Explorer-windows-x64.msi'
    && byId['macos-arm64']?.file === 'Pyxis-SAR-Explorer-macos-arm64.dmg'
    && byId['macos-x64']?.file === 'Pyxis-SAR-Explorer-macos-x64.dmg'
    && byId.linux?.file === 'Pyxis-SAR-Explorer-linux-x64.deb'],
  ['every installer explains the first start', installers.every(({ firstStart }) => firstStart.length > 20)],
  ['without a published release every button opens the releases page',
    installers.every((installer) => url(installer, false) === releases)],
  ['with a release each button is a permanent latest-download link',
    installers.every((installer) => url(installer, true) === `${releases}/latest/download/${installer.file}`)],
  ['links stay on the project repository over https',
    repository.startsWith('https://github.com/') && releases === `${repository}/releases`],
  ['Windows is recognised', detect({ platform: 'Win32', userAgent: chrome }) === 'windows'],
  ['Linux is recognised', detect({ platform: 'Linux x86_64', userAgent: 'Mozilla/5.0 (X11; Linux x86_64)' }) === 'linux'],
  ['a Mac is not guessed when the browser hides its architecture',
    detect({ platform: 'MacIntel', userAgent: macSafari }) === null],
  ['Apple silicon is used when the browser reports it',
    detect({ platform: 'MacIntel', userAgent: macSafari, architecture: 'arm' }) === 'macos-arm64'],
  ['Intel Mac is used when the browser reports it',
    detect({ platform: 'MacIntel', userAgent: macSafari, architecture: 'x86' }) === 'macos-x64'],
  ['phones and tablets get no suggestion',
    detect({ platform: 'iPhone', userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)' }) === null
    && detect({ platform: 'Linux armv8l', userAgent: 'Mozilla/5.0 (Linux; Android 15)' }) === null],
  ['an unknown system gets no suggestion', detect({}) === null && detect() === null],
  ['page is lazy-routed at /sar-explorer',
    routes.includes('lazy(() => import("@/pages/dashboard/sar-explorer"))')
    && /name: "SAR Explorer",\s*path: "\/sar-explorer",\s*element: <SarExplorer \/>/.test(routes)],
  ['navigation lists the page and labels it',
    navbar.includes('{ label: "SAR Explorer", path: "/dashboard/sar-explorer" }')
    && navbar.includes('"sar-explorer": "SAR Explorer"')],
  ['page renders every installer through the shared link builder',
    page.includes('SAR_EXPLORER_INSTALLERS.map(') && page.includes('sarExplorerDownloadUrl(installer)')],
  ['external links cannot reach back into the app window',
    (page.match(/target="_blank"/g) || []).length === (page.match(/rel="noopener noreferrer"/g) || []).length
    && page.includes('target="_blank"')],
  ['page credits the program it is built on and its licence',
    page.includes('modified version of DataWarrior') && page.includes('GNU General Public License')],
  ['page does not fetch anything', !/\bfetch\(/.test(page) && !/\bfetch\(/.test(read('client/src/utils/sarExplorer.js'))],
];

let failed = 0;
for (const [name, ok] of checks) {
  if (!ok) {
    failed += 1;
    console.error(`FAIL ${name}`);
  }
}
if (failed) {
  console.error(`${failed} of ${checks.length} SAR Explorer download checks failed`);
  process.exit(1);
}
console.log(`SAR Explorer download: ${checks.length} checks passed`);
