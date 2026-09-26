import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const simulation = readFileSync(path.join(root, 'client/src/pages/dashboard/simulation.jsx'), 'utf8');
const { workbookPacksForRow, PRICE_GUIDE_EUR_USD } = await import(pathToFileURL(path.join(root, 'client/src/utils/compoundPriceGuide.js')).href);
let passed = 0;
let failed = 0;
function check(label, condition) {
  console.log(`  ${condition ? 'PASS' : 'FAIL'} ${label}`);
  if (condition) passed++; else failed++;
}
console.log('Owned collection reference-pricing lifecycle:\n');
const stockTable = simulation.match(/searchSource === "stock" \? \(([\s\S]*?)\) : searchSource === "open" \? \(/)?.[1] || '';
const macroTable = simulation.match(/MACROCYCLE_SOURCES\[searchSource\] \? \(([\s\S]*?)\) : searchSource === "stock" \? \(/)?.[1] || '';
check('source picker and default contain no supplier catalog', simulation.includes('useState("stock")') && !simulation.includes("{ value: 'asinex', title:"));
check('stock estimates have no purchase control', stockTable.includes('<WorkbookRowPrices source="stock"') && !stockTable.includes('addToCart('));
check('macrocycle estimates retain each row source and have no purchase control', macroTable.includes('WorkbookRowPrices source={mol.macrocycleSource}') && !macroTable.includes('addToCart('));
check('page never requests stock offers', !simulation.includes('/stock-offers'));
check('estimates disclose tier, currency conversion and unavailable checkout prices', simulation.includes('Workbook 1–3 selected tier') && simulation.includes('Availability and checkout prices are unconfirmed.'));
for (const [source, code, category, firstEuro] of [
  ['stock', 'BAS 123', 'Other codes', 170], ['stock', 'LAS 123', 'LAS', 226],
  ['real', 'RPX 123', 'RPX', 317], ['virtual', 'VPX 123', 'VPX', 400],
]) {
  const row = workbookPacksForRow(source, code);
  check(`${category} maps only to its workbook category and approved first-tier amount`, row?.category === category && row.packs[0].mg === 1 && row.packs[0].eur === firstEuro);
  check(`${category} USD display converts the documented euro amount`, row.packs[0].usd === new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(firstEuro * PRICE_GUIDE_EUR_USD.rate));
}
check('unknown or mismatched sources never acquire a price', workbookPacksForRow('open', 'CHEMBL1') === null && workbookPacksForRow('stock', 'RPX 1') === null && workbookPacksForRow('real', 'VPX 1') === null && workbookPacksForRow('both', 'RPX 1') === null);
console.log(`\nsimulation pricing lifecycle: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
