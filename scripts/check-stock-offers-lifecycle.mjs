import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const simulation = readFileSync(
  path.join(root, 'client/src/pages/dashboard/simulation.jsx'),
  'utf8',
);
const stockOffersUtil = readFileSync(
  path.join(root, 'client/src/utils/stockOffers.js'),
  'utf8',
);
const serverOffers = readFileSync(
  path.join(root, 'server/utils/stockOffers.js'),
  'utf8',
);
const indexJs = readFileSync(path.join(root, 'server/index.js'), 'utf8');
const stagingDemo = readFileSync(
  path.join(root, 'server/routes/stagingDemo.js'),
  'utf8',
);

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

console.log('Stock offers lifecycle (Simulation purchase + cart):\n');

check('simulation imports stockOffers helpers', simulation.includes("from '@/utils/stockOffers'"));
check('purchase column header present', simulation.includes('>Purchase</'));
check('offers fetched via authenticated /stock-offers', simulation.includes("/stock-offers") && simulation.includes('Authorization'));
check('offers state map drives purchase cells', simulation.includes('stockOffersByCode'));
check('pack buttons use packsFromStockOffer', simulation.includes('packsFromStockOffer(offer)'));
check('addToCart accepts offer for stock packs', simulation.includes('addToCart(mol, pack.amountMg, pack.priceUSD, offer)'));
check('unresolved codes show Quote required', simulation.includes('Quote required'));
check('resolved empty packs show Price unavailable', simulation.includes('Price unavailable'));
check('header no longer claims stock is not purchasable', !simulation.includes('not purchasable in this flow'));
check('header mentions live supplier quotes', simulation.includes('live supplier quotes'));
check('catalog PRICE_* cart buttons still present', simulation.includes('addToCart(mol, 1, mol.PRICE_1MG)') && simulation.includes('addToCart(mol, 5, mol.PRICE_5MG)'));
check('cartItemFromStockOffer keeps stockCode', stockOffersUtil.includes('stockCode: code') && stockOffersUtil.includes("source: 'stock'"));
check('server resolveStockOffers posts /api4/bas', serverOffers.includes('/api4/bas'));
check('checkout re-prices via priceMoleculeCartFromOffers', indexJs.includes('priceMoleculeCartFromOffers'));
check('POST /api/stock-offers route registered', indexJs.includes("app.post('/api/stock-offers'"));
check('staging refuses /api/stock-offers', stagingDemo.includes('"/api/stock-offers"'));

const {
  cartItemFromStockOffer,
  packsFromStockOffer,
} = await import(pathToFileURL(path.join(root, 'client/src/utils/stockOffers.js')).href);

const offer = {
  offerId: 2081,
  code: 'ASN 33727025',
  packs: [
    { amountMg: 1, priceUSD: 170 },
    { amountMg: 5, priceUSD: 218 },
    { amountMg: 3, priceUSD: 99 },
    { amountMg: 10, priceUSD: 0 },
  ],
  smiles: 'C1CCC(=O)NC2CCNC2C1',
  formula: 'C9 H16 N2 O',
};
const packs = packsFromStockOffer(offer);
check('client packs filter to positive 1/2/5/10 only', packs.length === 2 && packs[0].amountMg === 1 && packs[1].amountMg === 5);

const item = cartItemFromStockOffer(
  { stockCode: 'ASN 33727025', SMILES_STRING: 'CCO' },
  5,
  218,
  offer,
);
check('cart item retains original stock code', item?.catalogId === 'ASN 33727025' && item?.name === 'ASN 33727025' && item?.source === 'stock');
check('cart item keeps pack USD without multiplying', item?.totalPrice === 218 && item?.amount === 5);
check('invalid pack amount rejected', cartItemFromStockOffer({ stockCode: 'ASN 1' }, 3, 10, offer) === null);

console.log(`\nstock-offers lifecycle: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
