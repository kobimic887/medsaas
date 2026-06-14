# ASINEX eShop — Reverse-Engineered Spec

**Source:** `eitangenis/eShop` @ `ad7d332`, `Asinex.eShop/Controllers/ShopController.cs`
(833 lines), `Asinex.eShop.JS/Price.js`. **Inspected:** 2026-06-14.
Companion to [`ASINEX-ESHOP-HANDOFF.md`](./ASINEX-ESHOP-HANDOFF.md).

This is the implementable intel extracted from the legacy storefront — pricing,
data model, search semantics, and the security traps to *not* replicate when
building a MedSaaS stock/order adapter. No secrets or infrastructure addresses
are reproduced.

## 1. Authoritative pricing model (was client-side in `Price.js`)

`Price.CalcPrice(price_category, weight)` is a static lookup. `price_category`
is a stored compound column (values 1–3); weight is one of 1/2/5/10 mg. Prices
are USD, flat per (category, weight):

| price_category | 1 mg | 2 mg | 5 mg | 10 mg |
|---:|---:|---:|---:|---:|
| 1 | 100 | 120 | 140 | 160 |
| 2 | 160 | 185 | 210 | 235 |
| 3 | 200 | 240 | 280 | 320 |

- Order-level **flat shipping surcharge: +$50** (`SubmitOrder`: `order.TOTAL + 50`).
- A commented-out earlier scheme (`price_category * 100/200/300/400`) shows the
  table above superseded a linear formula — use the table, not the formula.
- **This is the server-side source of truth.** A MedSaaS quote/order flow must
  compute price = `table[category][weight]` itself and never trust a
  browser-supplied price/total (see §4).

## 2. Canonical compound model (Oracle)

The compound projection appears in ~7 queries, always identical:

```
ele_id, mol_weight, brutto_formula, iupac_name, available_mg, salt,
price_category, clogp, h_acc_count, bas, bas_prefix
```

Mapped to the JSON the controller returns (note the legacy casing the handoff
warns about): `elE_ID, molwt, molformula, available(_string), clogp, hac,
price_category, salt`, plus `baS_CODE`.

### Identifier graph (do not treat as interchangeable)

- `BAS_CODE` is **constructed**, not stored: `bas_prefix + " " + bas.ToString("00000000")`
  → e.g. prefix `BAS` + `12345678` → `"BAS 12345678"`. The numeric `bas` is
  zero-padded to 8 digits.
- `PREFIX` flag = `1` when `BAS_CODE` starts with `LAS`, else `0` — there are at
  least two code families (`BAS`, `LAS`).
- Stock join: `EShops` (stock units) joins compounds on **`ELE_ID = UNT_ID`**, so
  `ELE_ID` (internal structure id) ↔ `UNT_ID` (stock unit id) are the join key;
  `BAS_CODE` is display only.
- `LoadCompound` looks up a single vial by `ELE_ID` **and** `IN_SHOP == 1`.

## 3. Search semantics (`POST /api/Shop`, modes 0–4)

| mode | meaning | how it's executed |
|---:|---|---|
| 0 | browse in-stock | base query, `available_mg > 0`, `rownum < 1001` |
| 1 | exact structure | structure match via the chem cartridge |
| 2 | substructure | async — registers a worker, polled via `ReCheckQuery` |
| 3 | code list | `bas in (<comma-joined codes, capped at 1000>)` |
| 4 | property filter | min/max on MW, HAC (`h_acc_count`), cLogP; `orderBy` switch |

- **Hard rules everywhere:** `available_mg > 0` (only in-stock) and Oracle
  `rownum < 1001` (≈1000-row cap before app pagination). `in_shop=1`,
  `bas_code is not null`, `proccessed is not null` gate the structure searches.
- **Substructure** uses an Oracle chemistry cartridge:
  `sss(mol.ctab, '<molstring>', 'MATCH=FRA,TAU,SAL,MAS,VAL,HYD')=1`
  (fragment/tautomer/salt/mass/valence/hydrogen match flags). It is **not
  synchronous**: it writes `shop_worker_line` rows keyed by `work_id = requestid`,
  the client polls `ReCheckQuery` (statuses `STARTED` / `SUCESS` [sic] / `FAIL` /
  `ERROR`), and results are pulled by
  `ast.ele_id in (select ele_id from shop_worker_line where work_id = '<requestid>')`.
- `orderBy` maps numeric field ids to columns (e.g. `"4" → available_mg`), with
  `asc`/`desc`.

## 4. Security traps — do NOT replicate; flag upstream

All confirmed in `ShopController.cs` @ `ad7d332`:

1. **SQL injection (string-concatenated queries).** User input is interpolated
   straight into Oracle SQL:
   - `bag.molstring` → the `sss(mol.ctab,'…')` substructure clause
   - `bag.requestid` → `work_id = '…'` in the polling query
   - `bag.ELE_ID` → `ast.ele_id = …` in `LoadCompound`
   - the code list → `bas in (…)`
   A MedSaaS adapter must use bound parameters; treat the live upstream as
   injectable until proven otherwise.
2. **Client-trusted money.** `CreateOrder` persists browser-supplied values
   verbatim: `order.TOTAL = bag.total`, and per line `PRICE = o.price`,
   `TOTAL = o.total`. Recompute server-side from §1.
3. **Weak order authorization.** `LoadOrder` / `LoadLines` / `CancelOrder` /
   `SubmitOrder` act on a supplied order id with no visible ownership check —
   any caller who knows/guesses `SHO_ID` can read or cancel an order. Scope every
   order to `companyId` + user in MedSaaS.
4. **PII + email side-effects.** `SubmitOrder` emails customer + internal
   notifications containing name/company/total and an order URL. Order rows hold
   contact + address data — treat as sensitive PII.
5. **Committed secrets.** `Asinex.eShop/appsettings.json` contains
   `connectionStrings` (DB creds) and SMTP config in the repo. Rotate and scrub
   from git history.

## 5. What this enables in MedSaaS

- **A real server-side pricing module** (§1 table + §1 shipping) so a quote/order
  flow never trusts the browser — directly closes the legacy "client-trusted
  money" hole.
- **A correct normalizer** (`normalizeCompound`) using §2: fix the legacy casing
  once, build `BAS_CODE` from `bas_prefix`+`bas`, and keep `ELE_ID`/`UNT_ID`/
  `BAS_CODE`/`id_number` distinct with mapping tests.
- **An accurate stock client** honouring §3: the 1000-row cap, `available_mg > 0`,
  and the **async substructure poll** (fire search → poll `ReCheckQuery` by
  `requestid` → fetch) rather than expecting a synchronous result.
- All of it behind the protections already in `server/index.js`
  (`getRequestLigandServiceConfig` SSRF guard, `fetchWithTimeout`,
  upstream-`401→502`), per the handoff checklist.

## Source pointers (`ad7d332`)

- `Asinex.eShop/Controllers/ShopController.cs` — search (mode dispatch ~L63),
  `ReCheckQuery` (~L136), `LoadCompound` (L604), `CreateOrder` (L629),
  `LoadOrder`/`LoadLines` (~L704–725), `CancelOrder` (L750), `SubmitOrder` (L778),
  `GetMolstring` (~L822)
- `Asinex.eShop.JS/Price.js` — `CalcPrice` table (§1)
- `Asinex.eShop/Models/ShopModelIn.cs`, `ShopModel.cs`, `ShopCart.cs` — request /
  response / cart shapes
