// Normalize legacy supplier response casing at the API boundary and retain its
// price-category conversion helpers. Catalog checkout uses catalogPricing.js;
// stock checkout is disabled. See docs/DATA-STOCK-COMPOUNDS.md.

// price_category -> weight(mg) -> USD.
export const ASINEX_PRICE_TABLE = Object.freeze({
  1: Object.freeze({ 1: 100, 2: 120, 5: 140, 10: 160 }),
  2: Object.freeze({ 1: 160, 2: 185, 5: 210, 10: 235 }),
  3: Object.freeze({ 1: 200, 2: 240, 5: 280, 10: 320 })
});

// Flat per-order shipping surcharge the legacy storefront added at submit time.
export const ASINEX_SHIPPING_USD = 50;

// The only weights the legacy storefront sells.
export const ASINEX_WEIGHTS_MG = Object.freeze([1, 2, 5, 10]);
export const MAX_MOLECULE_CART_ITEMS = 100;

// Price for one (category, weight); null if the pair isn't in the table.
export function priceForCategory(category, weightMg) {
  const tier = ASINEX_PRICE_TABLE[Number(category)];
  if (!tier) return null;
  const price = tier[Number(weightMg)];
  return typeof price === 'number' ? price : null;
}

// All weight prices for a category as { 1, 2, 5, 10 }; null for unknown category.
export function priceTableForCategory(category) {
  const tier = ASINEX_PRICE_TABLE[Number(category)];
  return tier ? { ...tier } : null;
}

// Map one legacy eShop compound to clean camelCase and attach server-computed
// prices. Tolerant of both the legacy casing (elE_ID) and already-clean input.
export function normalizeShopCompound(raw) {
  if (!raw || typeof raw !== 'object') return raw;
  const pick = (...keys) => {
    for (const key of keys) {
      if (raw[key] !== undefined && raw[key] !== null) return raw[key];
    }
    return null;
  };
  const priceCategory = pick('price_category', 'priceCategory');
  return {
    eleId: pick('elE_ID', 'ELE_ID', 'eleId'),
    basCode: pick('baS_CODE', 'BAS_CODE', 'basCode'),
    molWeight: pick('molwt', 'mol_weight', 'molWeight'),
    molFormula: pick('molformula', 'brutto_formula', 'molFormula'),
    availableMg: pick('available', 'available_mg', 'availableMg'),
    clogp: pick('clogp'),
    hac: pick('hac', 'h_acc_count'),
    salt: raw.salt ?? '',
    priceCategory,
    prices: priceTableForCategory(priceCategory)
  };
}

// Normalise a legacy POST /api/Shop search response ({ list, found, totalFound }).
// Anything that isn't that shape is returned unchanged (defensive passthrough).
export function normalizeShopSearchResponse(data) {
  if (!data || !Array.isArray(data.list)) return data;
  return {
    ...data,
    list: data.list.map(normalizeShopCompound),
    found: typeof data.found === 'number' ? data.found : data.list.length,
    totalFound:
      typeof data.totalFound === 'number'
        ? data.totalFound
        : typeof data.found === 'number'
          ? data.found
          : data.list.length
  };
}

// Validate the identity/weight portion of a client cart. Prices and names are
// intentionally discarded: checkout reconstructs both from mol_price records.
export function normalizeMoleculeCartRequest(cartItems) {
  if (!Array.isArray(cartItems) || cartItems.length === 0) {
    throw new Error('The molecule cart is empty');
  }
  if (cartItems.length > MAX_MOLECULE_CART_ITEMS) {
    throw new Error(`A molecule order can contain at most ${MAX_MOLECULE_CART_ITEMS} items`);
  }

  return cartItems.map((item, index) => {
    if (!item || typeof item !== 'object') {
      throw new Error(`Cart item ${index + 1} is invalid`);
    }
    const catalogId = [item.catalogId, item.moleculeId, item.ASINEX_ID, item.id]
      .find((value) => value !== undefined && value !== null && String(value).trim() && String(value).trim() !== 'N/A');
    const normalizedId = catalogId === undefined ? '' : String(catalogId).trim();
    if (!normalizedId || normalizedId.length > 128) {
      throw new Error(`Cart item ${index + 1} has no valid catalog ID`);
    }

    // Each basket row buys one pack. Only the number 1 is accepted — clients
    // never send a quantity (existing rows represent one pack), so anything
    // else is an explicit unsupported order ("1" as a string included) and
    // must fail validation rather than be silently repeated or dropped.
    if (item.quantity !== undefined && item.quantity !== 1) {
      throw new Error(`Cart item ${index + 1} has an unsupported quantity; use one pack per item`);
    }
    const amount = Number(item.amount);
    if (!Number.isInteger(amount) || !ASINEX_WEIGHTS_MG.includes(amount)) {
      throw new Error(`Cart item ${index + 1} has an unsupported package size`);
    }
    const smiles = typeof item.smiles === 'string' ? item.smiles.trim() : '';
    if (smiles.length > 5000) throw new Error(`Cart item ${index + 1} has an invalid SMILES value`);
    return { catalogId: normalizedId, amount, ...(smiles ? { smiles } : {}) };
  });
}

export function catalogRowsFromResponse(result) {
  if (Array.isArray(result)) return result;
  if (!result || typeof result !== 'object') return [];
  if (Array.isArray(result.data)) return result.data;
  if (Array.isArray(result.molecules)) return result.molecules;
  if (result.data && typeof result.data === 'object') return [result.data];
  return result.ASINEX_ID || result.BAS_CODE || result.bas_code || result.id_number || result.id
    ? [result]
    : [];
}

const compoundIdentifiers = (compound) => [
  compound?.ASINEX_ID,
  compound?.BAS_CODE,
  compound?.bas_code,
  compound?.basCode,
  compound?.id_number,
  compound?.id,
].filter((value) => value !== undefined && value !== null && String(value).trim());

const compoundSmiles = (compound) => [
  compound?.SMILES_STRING,
  compound?.smiles_string,
  compound?.smiles,
].find((value) => typeof value === 'string' && value.trim());

// Build Stripe line items exclusively from server-owned catalog documents.
export function priceMoleculeCart(cartItems, compounds) {
  const requestedItems = normalizeMoleculeCartRequest(cartItems);
  const compoundsById = new Map();
  const compoundsBySmiles = new Map();
  for (const compound of compounds || []) {
    for (const identifier of compoundIdentifiers(compound)) {
      compoundsById.set(String(identifier).trim(), compound);
    }
    const smiles = compoundSmiles(compound);
    if (smiles) compoundsBySmiles.set(smiles.trim(), compound);
  }

  let totalCents = 0;
  const lineItems = requestedItems.map(({ catalogId, amount, smiles }, index) => {
    const compound = compoundsById.get(catalogId) || (smiles ? compoundsBySmiles.get(smiles) : null);
    if (!compound) throw new Error(`Cart item ${index + 1} is no longer in the catalog`);

    const price = Number(compound[`PRICE_${amount}MG`] ?? compound[`price_${amount}mg`]);
    const unitAmount = Math.round(price * 100);
    if (!Number.isFinite(price) || price <= 0 || !Number.isSafeInteger(unitAmount)) {
      throw new Error(`Cart item ${index + 1} has no valid ${amount} mg price`);
    }

    totalCents += unitAmount;
    const catalogName = String(compound.ASINEX_ID || compound.id_number || catalogId).slice(0, 100);
    const formula = String(compound.BRUTTO_FORMULA || compound.brutto_formula || '').slice(0, 200);
    return {
      price_data: {
        currency: 'usd',
        product_data: {
          name: `${catalogName} · ${amount} mg`,
          ...(formula ? { description: formula } : {}),
        },
        unit_amount: unitAmount,
      },
      quantity: 1,
    };
  });

  if (!Number.isSafeInteger(totalCents) || totalCents <= 0) {
    throw new Error('The molecule order total is invalid');
  }
  return { requestedItems, lineItems, totalCents };
}

// Compare the totals the customer reviewed with the fresh supplier quote before
// creating any Stripe session. A missing or unparsable displayed total also
// forces review, so a client that never prices the cart cannot skip straight
// to payment. priceMoleculeCart maps line items 1:1 in cart order, so index
// alignment holds. Updated items re-carry the pack price into every field the
// cart UI reads: totalPrice, price, and the legacy pricePerMg alias — that
// alias holds the pack price, not a per-mg figure (see addToCart in Simulation
// and controlpanel; controlpanel rows have no `price`, navbar rows read
// `totalPrice || price`).
export function moleculeCartPriceReview(cartItems, priced) {
  if (!Array.isArray(priced?.lineItems) || priced.lineItems.length !== cartItems.length) {
    throw new Error('Molecule cart pricing did not return one line per cart item');
  }
  let changed = false;
  const updatedCartItems = cartItems.map((item, index) => {
    const cents = priced.lineItems[index].price_data.unit_amount;
    const displayed = Number(item.totalPrice ?? item.price);
    if (!Number.isFinite(displayed) || Math.round(displayed * 100) !== cents) changed = true;
    return { ...item, price: cents / 100, pricePerMg: cents / 100, totalPrice: cents / 100 };
  });
  return { changed, updatedCartItems };
}
