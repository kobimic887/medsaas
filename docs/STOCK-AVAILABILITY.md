# Compound prices and stock availability

How the app prices owned compounds today, where each value comes from, and the
offline tool for a recurring stock availability feed. Checkout rules are in
[compound shop](COMPOUND-SHOP.md); search sources in
[the search/checkout contract](../.agents/skills/pyxis-feature-slice/references/search-and-checkout.md).

## Current pricing behavior

One versioned price book, `shared/compoundPriceBook.js`, prices every offer.
It holds the **1–3 compounds tier** of the owner-supplied `Pyxis-e-shop_PRICE_LIST.xlsx`
(Sheet1 C:F rows 5–12, workbook SHA-256 recorded in the file), in **EUR**, converted
to USD at the fixed 24 Sep 2026 rate 1.1367 and rounded to whole cents. The USD
amount is what Stripe charges; shipping is included. There is no per-compound
price, no quantity discount above 3 compounds and no supplier repricing.

| Collection (`source`) | Code rule | Price column | Packs (mg) | Availability |
|---|---|---|---|---|
| Stock (`stock`) | prefix `LAS` | LAS (D) | 1, 2, 5, 10, 20, 30, 50, 100 | Snapshot mg, packs ≤ snapshot |
| Stock (`stock`) | any other 3-letter prefix (BAS, ASN, BDE, SYN, PYX, MAC, …) | Other codes (C) | same | Snapshot mg, packs ≤ snapshot |
| Stock (`stock`) | `RPX`/`VPX` prefix | none: no offer | — | — |
| Real macrocycles (`real`) | `RPX` | RPX (E) | 1, 2, 5 | `web_mg` snapshot |
| Virtual macrocycles (`virtual`) | `VPX` | VPX (F) | 1, 2, 5 | Made to order |
| Small-molecule virtual (`smallvirtual`) | dash-separated digits | VPX (F), by owner decision | 1, 2, 5 | Made to order |
| Open compounds (ChEMBL) | — | discovery only, never priced | — | — |

The only stock family distinction is LAS versus everything else. The
2026-09-01 stock file has 51 prefixes; LAS covers 80,214 of 630,652 compounds and
the other 550,438 (BAS 191,444, ASN 128,223, BDE 54,173, …, PYX 2,013, MAC 242)
take the Other codes column. Any family-based formula (BAS/LAS/…) beyond this
two-way split is not implemented.

A retired legacy path, `server/utils/asinexCompound.js`, still holds an older USD
table keyed by a supplier `price_category` (1–3; e.g. category 1 = $100/1 mg,
$160/10 mg) plus a $50 shipping surcharge. It belongs to the retired supplier
shop and prices nothing today; tests keep it only as history.

Changing a price requires a new `PRICE_BOOK_VERSION`: offers signed under the old
version stop verifying, so customers re-search and see the new price before paying.

## Source-to-field mapping

| App field | Stock source | Real macrocycle source | Used for |
|---|---|---|---|
| Identity (`rowId`) | search engine row ID | search engine row ID | basket/order identity |
| Display code (`code`) | `MAIN_BAS` | `MAIN_BAS` (`RPX …`) | price family, display, order |
| Structure | engine `canonical_smiles` | engine `canonical_smiles` | preview, order |
| Available mg (`availableMg`) | `CURRENT_TOT_NETTO_MG` | `web_mg`, else `CURRENT_TOT_NETTO_MG` | offer ≥ 1 mg, pack cap, basket cap |
| Lead time | `Lead_TIME` if present (absent in stock) | `Lead_TIME` text | display only |
| Price | price book by `source` + code prefix | price book | quote and Stripe amount |

Values come from the files imported into the search datasets
(`scripts/import-stock-compounds.mjs`, `scripts/import-macrocycle-datasets.mjs`)
and are carried as search metadata; `server/utils/compoundShopSearch.js` mints
signed offers from them. They are **dated snapshots**: stock is the 2026-09-01
per-compound file, real macrocycles the 2026-09-23 file.

Stale or missing data: a stock or real row with missing, non-numeric or < 1 mg
availability gets no offer; packs larger than the snapshot are hidden; checkout
caps aggregate mg against the snapshot. Nothing is reserved or decremented, and
a compound that has since run out still shows its snapshot amount until the
dataset changes. Physical stock can differ from any database (empty or missing
vials), so a paid order may still need merchant follow-up.

## Weekly stock availability feed

The stock search dataset takes about 12.5 hours to import (fingerprints for every
structure) and the search service has no metadata-only update, so a weekly
feed cannot be a re-import. The feed is therefore a separate per-compound
snapshot keyed by `MAIN_BAS`.

Input: the CompChem vial-level dump `STRUCTURES_FullDump_<YYYYMMDD>_<records>.zip`,
one SDF record per vial. Required tags are `MAIN_BAS`, `VIAL`,
`CURRENT_AMOUNT_UM` and `CURRENT_NETTO_MG`; other tags vary per vial and between
dumps (batch, purity, salt, `EXCLUSIVITY`, initial amounts, box location — the
2026-10-26 dump no longer carries `EXCLUSIVITY`, `BATCH` or `T0_*`). Amounts are
summed per `MAIN_BAS`. Summing the 2026-09-01 dump reproduces that date's
per-compound `CURRENT_TOT_NETTO_MG` within 0.05 mg for 99.98% of compounds, so
the vial dump is a usable feed. Dumps also contain zero and negative vial
amounts and, occasionally, vials without `MAIN_BAS`; those are rejected and
counted.

```bash
unzip -p STRUCTURES_FullDump_20261026_1165950.zip \
  | bun scripts/stock-availability-snapshot.mjs --input - \
      --source-name STRUCTURES_FullDump_20261026_1165950.zip \
      --out-dir <private data dir>/stock-availability \
      --previous <private data dir>/stock-availability/<last date>/availability.csv
```

Output `<out-dir>/<date>/availability.csv` (`MAIN_BAS, CURRENT_TOT_NETTO_MG,
CURRENT_TOT_AMOUNT_UM, VIALS`) and `manifest.json` (source SHA-256, counts,
rejects by reason, per-family price column and offerable count, optional-tag
counts, diff against the previous snapshot).

Guards — a refused run writes nothing and leaves the last good snapshot intact:

- A record count different from the file name's count (incomplete upload).
- An SDF tag outside the known vocabulary (format change) unless `--allow-new-tags`.
- Rejected vials above 0.1% (bad code, missing/non-numeric/negative amount,
  duplicate vial ID). Rejects are listed, never repaired.
- More than 5% of the previous snapshot's compounds missing unless
  `--allow-large-change` after review.
- A different snapshot for the same date unless `--replace`. Rerunning the same
  file is a verified no-op.

`bun run test:stock-availability` covers aggregation, price-family mapping,
invalid inputs, guards and reruns with fixtures.

**Not wired into offers.** Search offers still use the imported
`CURRENT_TOT_NETTO_MG`. Using the snapshot needs owner decisions first: whether a
compound absent from the newest snapshot is unavailable, how old a snapshot may
be before stock offers stop, whether compounds with an `Exclusive` vial may be
sold (the current stock data includes them), who approves each
upload, and where the snapshot lives (dataset copies do not belong on the
application host). Keep generated snapshots outside Git.
