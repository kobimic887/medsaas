# ASINEX eShop Reference and Agent Handoff

**Status:** Architecture reference, not an imported service
**Inspected:** 2026-06-14
**External repository:** [eitangenis/eShop](https://github.com/eitangenis/eShop) (private)
**Inspected commit:** `ad7d332`

## Short Answer

Yes: `eitangenis/eShop` strongly appears to be the legacy ASINEX stock
storefront and the source lineage for the `/api/Shop` contract that MedSaaS
currently treats as an external service.

It is not the same thing as every ASINEX integration in this repository.
MedSaaS currently has three distinct compound-data paths:

1. **Live catalog API** - browse and search through `ASINEX_API_BASE`.
2. **Stock/eShop API** - legacy storefront operations through
   `ASINEX_STOCK_API_URL`, whose default ends in `/api/Shop`.
3. **Local MongoDB mirror** - imported pricing records in the `mol_price`
   collection.

The external repository is useful for understanding old behavior and payloads.
It should not be copied into this monorepo or deployed unchanged.

## What Can Be Proven

- The eShop backend exposes an ASP.NET controller at `api/Shop`.
- MedSaaS defaults `ASINEX_STOCK_API_URL` to an ASINEX host ending in
  `/api/Shop`.
- Both systems use the same concepts: BAS/ASINEX identifiers, structure and
  substructure search, stock in milligrams, price categories, carts, orders,
  and SDF/molfile export.
- MedSaaS currently proxies only the root stock search request through
  `POST /api/shop`.
- The active MedSaaS simulation UI primarily uses the separate live catalog
  wrapper under `/api/asinex/*`, not `/api/shop`.

It cannot be proven from source alone that the production ASINEX stock host is
running this exact commit. Treat eShop as the contract's legacy source lineage,
not as a verified production deployment snapshot.

## System Relationship

```text
MedSaaS browser
    |
    v
MedSaaS Express API
    |
    +-- /api/asinex/* ------> ASINEX catalog API
    |                         /api/all, /api/id, /api/exact,
    |                         /api/substructure, /api4/*
    |
    +-- /api/shop ----------> ASINEX stock/eShop API
    |                         default target: .../api/Shop
    |
    +-- /api/mol-price* ----> local MongoDB mol_price collection
    |
    +-- docking routes -----> ASINEX docking and DiffDock services
```

The legacy eShop application has its own full stack:

```text
Legacy React 16 storefront
    |
    v
ASP.NET Core 2.1 ShopController
    |
    +-- Oracle catalog and stock tables
    +-- Oracle order and worker tables
    +-- shared molecule/image filesystem
    +-- SMTP order notifications
```

## MedSaaS Integration Points

### Service configuration

The defaults live in [`server/index.js`](../server/index.js):

| Field | Purpose |
|---|---|
| `catalogApiBase` | Live catalog browse, ID, exact, substructure, and API4 searches |
| `stockApiUrl` | Legacy eShop-compatible `/api/Shop` endpoint |
| `dockingApiUrl` | ASINEX docking endpoint |
| `diffdockApiUrl` | DiffDock generation endpoint |

Each company can override these URLs through its `ligandServiceConfig`.
Configuration updates are restricted to company admins and custom URLs are
checked against private/internal network targets.

### Active catalog flow

The simulation page calls:

```text
GET /api/asinex/all/:page_:pageSize
```

The server forwards this to:

```text
GET {catalogApiBase}/api/all/:page_:pageSize
```

The UI normalizes catalog records into fields such as:

```text
ASINEX_ID
SMILES_STRING
BRUTTO_FORMULA
MW_STRUCTURE
AVAILABLE_MG
PRICE_1MG
PRICE_2MG
PRICE_5MG
PRICE_10MG
IUPAC_NAME
INCHI
INCHIKEY
```

Exact-SMILES price lookup also uses the catalog path:

```text
GET /api/asinex/exact/:smiles
```

### Stock/eShop flow

MedSaaS currently implements:

```text
POST /api/shop
    -> POST {stockApiUrl}
```

This maps to the eShop controller's root `POST /api/Shop` search action.
There are currently no MedSaaS proxy routes for eShop order creation,
submission, cancellation, order lookup, SDF export, or molfile download.

No current client page calls `/api/shop`, so this route appears dormant or
reserved for future stock integration.

### Local `mol_price` mirror

`server/import-mol-price.js` imports the first sheet of an Excel workbook into
MongoDB. The import replaces the existing collection contents.

The local routes provide search, lookup, statistics, and price-related access
without calling an ASINEX service. This data can become stale because there is
no synchronization job or freshness metadata beyond import timestamps.

Do not silently combine local `mol_price` records with live catalog or stock
records. Define source precedence and freshness behavior first.

## Legacy eShop API Contract

The main contract is implemented in
[ShopController.cs](https://github.com/eitangenis/eShop/blob/ad7d332/Asinex.eShop/Controllers/ShopController.cs).

### Search

```text
POST /api/Shop
```

Representative request:

```json
{
  "searchMode": 0,
  "page": 0,
  "perPage": 25,
  "smiles": "",
  "codes": [],
  "requestid": "",
  "orderBy": "1",
  "order": "asc",
  "minMW": 0,
  "maxMW": 500,
  "minHAC": 0,
  "maxHAC": 5,
  "minCLP": -10,
  "maxCLP": 10
}
```

Search modes:

| Value | Meaning |
|---:|---|
| `0` | Browse all in-stock compounds |
| `1` | Exact structure search |
| `2` | Substructure search |
| `3` | Search by BAS/ASINEX code list |
| `4` | Property filters |

Representative response:

```json
{
  "list": [
    {
      "elE_ID": 123,
      "baS_CODE": "BAS 12345678",
      "molwt": 350.2,
      "molformula": "C18H20N2O4",
      "available": 42,
      "availablE_STRING": "42",
      "clogp": 2.1,
      "hac": 4,
      "price_category": 1,
      "salt": ""
    }
  ],
  "found": 1,
  "totalFound": 1
}
```

The odd property capitalization comes from old ASP.NET JSON serialization and
is visible in the legacy React client. A new adapter should normalize it at the
server boundary.

### Asynchronous search polling

```text
POST /api/Shop/ReCheckQuery
```

Input:

```json
{
  "requestid": "client-generated-id",
  "searchMode": 2
}
```

Possible statuses are `STARTED`, `SUCESS`, `FAIL`, and `ERROR`. `SUCESS` is the
legacy misspelling and may be part of the deployed contract.

### Compound and file access

| Endpoint | Purpose |
|---|---|
| `POST /api/Shop/LoadCompound` | Load one compound by internal `ELE_ID` |
| `POST /api/Shop/GetSDFile` | Export cart or search results as SDF |
| `GET /api/Shop/GetMolstring` | Download one molfile |

### Order lifecycle

| Endpoint | Purpose |
|---|---|
| `POST /api/Shop/CreateOrder` | Create order header and lines |
| `POST /api/Shop/LoadOrder` | Load order by ID |
| `POST /api/Shop/LoadLines` | Load order lines by ID |
| `POST /api/Shop/SubmitOrder` | Add customer details and submit |
| `POST /api/Shop/CancelOrder` | Mark an order cancelled |

Legacy cart line shape:

```json
{
  "compound": {
    "elE_ID": 123,
    "baS_CODE": "BAS 12345678"
  },
  "price": 100,
  "qty": 1,
  "total": 100,
  "weight": 1
}
```

## Identifier Mapping

Do not assume these are interchangeable:

| Identifier | Meaning |
|---|---|
| `ASINEX_ID` | MedSaaS/local import identifier |
| `id_number` | Live catalog API identifier |
| `BAS_CODE` / `baS_CODE` | Legacy display/catalog code |
| `BAS` | Numeric portion of a BAS code |
| `ELE_ID` / `elE_ID` | Legacy internal structure ID |
| `UNT_ID` | Legacy stock/unit identifier |

A future integration needs an explicit canonical compound model and mapping
tests. String cleanup such as stripping `ASN` or `BAS` prefixes must not be used
as proof that two records represent the same stock item.

## Important Legacy Behavior

- Searches only return compounds with positive `available_mg`.
- Search results are capped at roughly 1,000 records before application-side
  pagination.
- Exact and substructure searches can register worker records and be polled.
- SDF export reads molecule files from a shared filesystem.
- Legacy prices are derived from `price_category` and selected weight in the
  browser.
- Supported legacy weights are 1, 2, 5, and 10 mg.
- The old UI adds a fixed shipping charge of 50.
- Order submission sends customer and internal notification emails.

These are historical behaviors, not approved current business rules. Confirm
pricing, shipping, availability, and order status semantics with the product
owner or live service before implementing them.

## Security and Maintenance Warnings

Do not deploy or copy the eShop code as-is.

1. **Committed secrets:** The private repository contains production-looking
   SMTP and infrastructure configuration in `appsettings.json`. Rotate any
   still-valid credentials and remove them from Git history. This handoff
   intentionally does not reproduce secret values.
2. **Unsupported runtime:** The backend targets `.NET Core 2.1`, which is end
   of life.
3. **SQL injection risk:** Multiple SQL statements are built by concatenating
   request IDs, SMILES strings, and filter values.
4. **Client-trusted money:** The old client computes prices and totals, and
   `CreateOrder` persists client-supplied values. A new implementation must
   calculate prices and totals server-side.
5. **Weak order authorization:** The legacy order endpoints operate on supplied
   order IDs and the controller does not show an authorization requirement.
6. **Sensitive data exposure:** Order records include names, email, phone,
   billing addresses, and shipping addresses.
7. **Old dependencies:** The frontend uses React 16, Material-UI 3, Axios 0.18,
   and an old Webpack toolchain.
8. **Repository hygiene:** Compiled `bin/` and `obj/` outputs are committed.
9. **Contract quirks:** Misspelled statuses and serializer-dependent property
   casing can break a naive rewrite.

## Recommended Integration Direction

If stock or ordering is needed in MedSaaS, implement a new server-side adapter
instead of importing the C# application.

### Phase 1: Read-only stock

1. Define a normalized `StockCompound` schema.
2. Add a dedicated stock service module instead of adding more logic to
   `server/index.js`.
3. Proxy only explicitly supported upstream operations.
4. Normalize legacy casing and identifiers in one place.
5. Preserve existing authentication, active-user checks, per-company URL
   selection, timeouts, SSRF checks, and upstream `401 -> 502` behavior.
6. Add contract tests with saved, sanitized fixtures.

### Phase 2: Cart and quote

1. Store the cart in MedSaaS or treat it as client state only.
2. Fetch current stock and server-calculated prices before presenting a quote.
3. Return a quote ID with an expiry and immutable line snapshots.
4. Never accept authoritative price, total, or availability from the browser.

### Phase 3: Ordering

1. Confirm whether ASINEX accepts direct orders or only sales inquiries.
2. Create orders with idempotency keys.
3. Scope every order to `companyId` and user.
4. Audit create, submit, cancel, and view operations.
5. Keep payment credits and compound-order money as separate domains.
6. Treat customer contact and address data as sensitive PII.

## Suggested New Module Boundary

```text
server/services/asinex/
    catalogClient.js
    stockClient.js
    normalizeCompound.js
    schemas.js
    errors.js

server/routes/
    asinexCatalog.js
    asinexStock.js
```

Do not create this structure merely for cleanup. Create it when implementing a
real stock feature, because the current single-file server already has several
duplicate ASINEX proxy families and the new behavior needs an owned boundary.

## Agent Checklist

Before changing ASINEX behavior:

- Read this file and [`REPOS.md`](../REPOS.md).
- Read `DEFAULT_LIGAND_SERVICE_CONFIG`, `getRequestLigandServiceConfig`, and
  `assertConfiguredUrlsArePublic` in `server/index.js`.
- Inspect all existing `/api/asinex/*`, `/api/api4/*`, `/api/shop`, and
  `/api/mol-price*` routes before adding another route.
- Check the actual client caller and expected response shape.
- Decide which source is authoritative: live catalog, stock/eShop, or local
  `mol_price`.
- Preserve tenant isolation and company-specific upstream configuration.
- Preserve outbound timeouts and SSRF defenses.
- Map upstream authentication failures to `502`, not `401`, after the MedSaaS
  user has already authenticated.
- Never copy secrets or infrastructure addresses from eShop.
- Never copy the legacy client-side pricing logic as a source of truth.
- Add tests for identifier mapping, casing normalization, upstream failures,
  timeout behavior, and malformed responses.

## Source Pointers

### MedSaaS

- [`server/index.js`](../server/index.js) - configuration, proxies, company
  overrides, SSRF controls, local price routes
- [`client/src/pages/dashboard/simulation.jsx`](../client/src/pages/dashboard/simulation.jsx)
  - active catalog browsing and normalization
- [`client/src/pages/dashboard/controlpanel.jsx`](../client/src/pages/dashboard/controlpanel.jsx)
  - exact-SMILES price lookup
- [`client/src/pages/dashboard/company-admin.jsx`](../client/src/pages/dashboard/company-admin.jsx)
  - per-company ligand service settings
- [`server/import-mol-price.js`](../server/import-mol-price.js) - local Excel to
  MongoDB import

### Private eShop repository

- [ShopController.cs](https://github.com/eitangenis/eShop/blob/ad7d332/Asinex.eShop/Controllers/ShopController.cs)
  - search, export, and order endpoints
- [ShopModelIn.cs](https://github.com/eitangenis/eShop/blob/ad7d332/Asinex.eShop/Models/ShopModelIn.cs)
  - search request model and modes
- [ShopModel.cs](https://github.com/eitangenis/eShop/blob/ad7d332/Asinex.eShop/Models/ShopModel.cs)
  - compound response models
- [ShopCart.cs](https://github.com/eitangenis/eShop/blob/ad7d332/Asinex.eShop/Models/ShopCart.cs)
  - cart and export payloads
- [Compounds.js](https://github.com/eitangenis/eShop/blob/ad7d332/Asinex.eShop.JS/Compounds.js)
  - old storefront workflow
- [Price.js](https://github.com/eitangenis/eShop/blob/ad7d332/Asinex.eShop.JS/Price.js)
  - historical client-side price table
- [Asinex.eShop.csproj](https://github.com/eitangenis/eShop/blob/ad7d332/Asinex.eShop/Asinex.eShop.csproj)
  - old runtime and package versions
