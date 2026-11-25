// Emit SQL for the price book from a specific release. Run with psql -1 -v ON_ERROR_STOP=1.
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

if (process.argv.length !== 3) throw new Error('Pass the released compoundPriceBook module path.');
const book = await import(pathToFileURL(resolve(process.argv[2])).href);
const quote = (value) => "'" + value.replaceAll("'", "''") + "'";
const rows = [];
for (const [source, guide] of Object.entries(book.COMPOUND_PRICE_GUIDE)) {
  for (const column of guide.columns) {
    const prefix = column.label === 'not LAS' ? 'BAS' : column.label;
    const code = source === 'smallvirtual' ? '1-1' : prefix + '1';
    const price = book.workbookPacksForRow(source, code);
    if (price?.category !== column.label || !price.packs.length) throw new Error('Unmapped price category: ' + column.label);
    for (const pack of price.packs) {
      const usd = book.packUnitCents(pack, 'usd');
      const eur = book.packUnitCents(pack, 'eur');
      if (![pack.mg, usd, eur].every((n) => Number.isSafeInteger(n) && n > 0)) throw new Error('Invalid pack');
      rows.push('(' + [
        quote(source), quote(column.label), pack.mg, (usd / 100).toFixed(2), (eur / 100).toFixed(2),
        quote(guide.currency.toUpperCase()), quote(pack.sourceCell), quote(book.PRICE_BOOK_VERSION),
      ].join(', ') + ')');
    }
  }
}
const marker = 'Catalog reporting view generated from the released Pyxis compound price book.';
console.log(`DO $$ BEGIN
  IF to_regclass('pricing.pack_prices') IS NOT NULL AND
     obj_description(to_regclass('pricing.pack_prices'), 'pg_class') IS DISTINCT FROM ${quote(marker)} THEN
    RAISE EXCEPTION 'pricing.pack_prices already exists and is unmanaged';
  END IF;
END $$;
CREATE OR REPLACE VIEW pricing.pack_prices
  (source, price_category, pack_mg, price_usd, price_eur, list_currency, workbook_cell, price_book_version)
AS VALUES
${rows.join(',\n')};
COMMENT ON VIEW pricing.pack_prices IS ${quote(marker)};`);
