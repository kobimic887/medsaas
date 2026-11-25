# Compound prices and stock availability

How the app prices owned compounds today, where each value comes from, and the
offline tool for a recurring stock availability feed. Checkout rules are in
[compound shop](COMPOUND-SHOP.md); search sources in
[the search/checkout contract](../.agents/skills/pyxis-feature-slice/references/search-and-checkout.md).

DBeaver exposes released pack prices in `pricing.pack_prices`. Refresh the reporting view from the deployed price book on pricing releases (see `services/catalog-sql/README.md`).

## Current pricing behavior

The signed-in shop uses two source workbooks in `shared/compoundPriceBook.js`.
The order limit is three distinct compounds. Pack count and compound count are separate.

| Collection | Source of pack prices | Packs (mg) | Availability |
|---|---|---|---|
| Stock | Dmitry’s December 2025 USD workbook, “ASINEX Price List USD”, C6:E13, 1–10 compounds tier | 1, 2, 5, 10, 20, 30, 50, 100 | Imported stock mg |
| RPX real macrocycles | Pyxis-e-shop_PRICE_LIST.xlsx, Sheet1 E10:E12, EUR 1–3 tier | 1, 2, 5 | Imported RPX mg |
| VPX virtual macrocycles | Same Pyxis workbook, F10:F12 | 1, 2, 5 | Made to order |
| Virtual small molecules | VPX column by owner decision | 1, 2, 5 | Made to order |
| Open compounds (ChEMBL) | Discovery only | — | — |

Both of Dmitry’s attachments contain all three stock columns. Excel’s last-save
metadata dates `Prices_NEW (December 2025) (15).xls` to 17 December 2025 and
`Prices_NEW (PRO).xls` to 24 May 2023. The newer attachment supplies all three
columns. The email recommends these USD lists but gives no separate contractual
effective date. The September Pyxis workbook’s stock columns are superseded for
new offers under the revised price-book version.

| Stock pack | Other stock codes (including BAS, ASN) | LAS | PRO |
|---:|---:|---:|---:|
| 1 mg | $132 | $194 | $251 |
| 2 mg | $158 | $224 | $291 |
| 5 mg | $184 | $254 | $330 |
| 10 mg | $211 | $284 | $370 |
| 20 mg | $277 | $375 | $487 |
| 30 mg | $330 | $466 | $606 |
| 50 mg | $422 | $568 | $739 |
| 100 mg | $587 | $786 | $1,022 |

These are pack prices including shipping. For example, the price for 5 mg
comes from its own row. RPX costs €317/€365/€420 and VPX costs €400/€460/€529
for 1/2/5 mg. A stock row carrying an RPX or VPX code is ineligible. No
published formula from Mark is needed to reproduce these values.

The browser chooses EUR for EU time zones and USD otherwise. The server quotes
stock at its listed USD amount or divides by 1.1367 for EUR. For EUR-listed
collections it multiplies by 1.1367 for USD. Both conversions round to cents
per pack before multiplying by quantity. A 1 mg LAS pack is $194 or €170.67.

To audit the stock mapping against a supplied attachment, run
`python3 scripts/check-stock-price-workbook.py "<path to .xls>"` with Node.js
and Python’s `xlrd` installed. It checks the tier, family labels, pack sizes,
cell references and all 24 USD values against the shop code and prints the file
digest. The reference digest is recorded in the price book. A different source
file is reviewed before changing the mapping or version.

The separate public WordPress stock catalog displays supplier-reported
availability and links to the signed-in shop to order. Its cards display no
checkout price. See [stock catalog](../services/stock-catalog/README.md).

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
the vial dump is a usable feed. Zero-mg vials contribute zero. Negative amounts and vials missing `MAIN_BAS` are rejected and counted. Vials marked Exclusive count toward stock under the current owner decision.

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
  file verifies the stored CSV before reporting a no-op. A missing or corrupt published revision requires an explicit repair.

`bun run test:stock-availability` covers aggregation, price-family mapping,
invalid inputs, guards and reruns with fixtures.

Snapshot generation alone does not change checkout. Keep generated snapshots
outside Git on the scientific host. To activate a validated snapshot for stock offers, quotes and new checkouts, follow the [activation and rollback instructions](../services/owned-search/README.md). The newest file measures availability on its
export date. Physical stock can change between exports.

## Scheduled refresh (scientific host)

The publisher posts full dumps in the same CompChem directory the shop was
activated from, on no fixed schedule (2026: May 5, May 26, Jul 8, Sep 1, Oct 26).
`scripts/stock-availability-refresh.mjs`, run by `pyxis-stock-availability-refresh.timer`
(Mondays 12:30 UTC, `deploy/stock-availability/`), checks that directory and does
nothing unless a strictly newer `STRUCTURES_FullDump_<date>_<records>.zip` exists.
Then it downloads to a private temporary directory, runs the snapshot tool with the
active CSV as `--previous`, activates the new date, confirms the running service
reports it and, if it does not, reverts to the previous snapshot.

- Refuses (non-zero exit, push through `kobi-notify`, active snapshot unchanged):
  any guard of the snapshot tool, a dump that is not newer, a future date, two
  dumps with one date, an index with no dumps, a damaged active CSV, an unconfirmed
  activation. It never passes `--replace`, `--allow-large-change` or `--allow-new-tags`;
  a person reviews and runs those by hand.
- Does nothing when `ACTIVE.json` is absent: an operator deactivated the snapshot
  on purpose and the job never turns it back on. It also leaves a pointer alone that
  changed while it ran. Nothing is ever deleted, so every earlier date stays a rollback target.
- The job runs from an immutable release, not the checkout:
  `git archive <sha> scripts/stock-availability-snapshot.mjs scripts/stock-availability-refresh.mjs shared/compoundPriceBook.js services/owned-search/stockAvailability.mjs server/utils/stockAvailability.js`
  extracted to `~/.local/share/pyxis/stock-refresh-releases/<sha>`, with `current` linking to it.
  Re-cut that release whenever those files change.
- Check: `systemctl list-timers pyxis-stock-availability-refresh.timer`, `journalctl -u pyxis-stock-availability-refresh`,
  or run `systemctl start pyxis-stock-availability-refresh.service` (a no-newer run takes seconds).
  Test: `bun run test:stock-availability` (index parsing, unchanged, older, deactivated, valid, truncated,
  invalid, unknown-tag, large-loss, unconfirmed, concurrent-pointer cases against a fake publisher).
