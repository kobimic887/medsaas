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
check('stock rows use their server-owned offer', stockTable.includes('<CompoundShopPacks offer={mol.shopOffer}'));
check('macrocycle rows use their server-owned offer', macroTable.includes('<CompoundShopPacks offer={mol.shopOffer}'));
check('page never requests stock offers', !simulation.includes('/stock-offers'));
check('shop discloses approved tier and review step', simulation.includes('up to 3 distinct compounds') && simulation.includes('review shipping and terms before checkout'));
// Independently transcribed: stock from the December 2025 USD list (1–10 block),
// macrocycles from the EUR workbook Sheet1 (1–3 tier).
for (const [source, code, category, cell, values, firstUsd] of [
  ['stock', 'BAS 123', 'not LAS', (i) => `ASINEX Price List USD!C${13 - i}`, [132, 158, 184, 211, 277, 330, 422, 587], '$132.00'],
  ['stock', 'LAS 123', 'LAS', (i) => `ASINEX Price List USD!D${13 - i}`, [194, 224, 254, 284, 375, 466, 568, 786], '$194.00'],
  ['stock', 'PRO 123', 'PRO', (i) => `ASINEX Price List USD!E${13 - i}`, [251, 291, 330, 370, 487, 606, 739, 1022], '$251.00'],
  ['real', 'RPX 123', 'RPX', (i) => `Sheet1!E${12 - i}`, [317, 365, 420], '$360.33'],
  ['virtual', 'VPX 123', 'VPX', (i) => `Sheet1!F${12 - i}`, [400, 460, 529], '$454.68'],
]) {
  const row = workbookPacksForRow(source, code);
  check(`${category} maps all approved list prices and cells`, row?.category === category && row.packs.length === values.length && row.packs.every((pack, i) => pack.listValue === values[i] && pack.sourceCell === cell(i) && pack.mg === [1, 2, 5, 10, 20, 30, 50, 100][i]));
  check(`${category} USD conversion retains cents`, row.packs[0].usd === firstUsd);
  check(`${category} compact/lowercase identifiers keep the same category`, JSON.stringify(workbookPacksForRow(source, code.replace(' ', '').toLowerCase())) === JSON.stringify(row));
}
check('conversion rate has dated source provenance', PRICE_GUIDE_EUR_USD.rate === 1.1367 && PRICE_GUIDE_EUR_USD.sourceUrl.startsWith('https://www.ecb.europa.eu/'));
check('RPX USD cents round consistently', workbookPacksForRow('real', 'RPX123').packs.map(({ usd }) => usd).join(',') === '$360.33,$414.90,$477.41');
check('unknown or mismatched sources never acquire a price', workbookPacksForRow('open', 'CHEMBL1') === null && workbookPacksForRow('stock', 'RPX 1') === null && workbookPacksForRow('real', 'VPX 1') === null && workbookPacksForRow('both', 'RPX 1') === null);
console.log(`\nsimulation pricing lifecycle: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
