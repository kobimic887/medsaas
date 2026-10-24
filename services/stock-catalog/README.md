# Public stock catalog

A browse-only page of the Pyxis stock compounds for the WordPress site
(`www.pyxis-discovery.com`): structure, ID, MW, formula and the dated availability
snapshot in a 25-per-page grid. You can sort by ID, library, MW or availability,
and click the same sort again to reverse it. There is no structure or ID search;
that stays in the app's Home page. **Order** links to the web-shop
(`https://app.pyxis-discovery.com/dashboard/simulation`, which asks visitors to
sign in), and purchasing goes through the normal signed-offer flow.

Everything is static. The page never calls the application API, so it needs no
session, spends no credits and puts no load on the app host.

| Path | Purpose |
|---|---|
| `web/pyxis-catalog.js` | Self-mounting widget (ES module). Pure helpers are exported for `test.mjs` |
| `web/pyxis-catalog.css` | Styles, all scoped under `.pxc`, using the brand site's colours and Poppins |
| `web/index.html` | Standalone page and iframe target |
| `build_catalog.py` | Builds `manifest.json` and the pre-sorted row chunks |
| `test.mjs` | Pagination, image key, formatting and URL-hash contract (`bun run test:stock-catalog`) |

## Data

`build_catalog.py` joins the import upload CSV (source ID and mg snapshot) to
the engine export (`id, MAIN_BAS, canonical_smiles`). It needs RDKit, so run it
on a science host, not the Mac or the app host. RDKit computes MW and formula
from the canonical SMILES. Each sort is written once, ascending, as 500-row chunks
(`data/sorts/<sort>/<n>.json`, about 41 KB raw or 9 KB gzipped). A descending
page reads from the end of the same files. `manifest.json` is written last.

Structure images come from [`scripts/render-structure-images.py`](../../scripts/render-structure-images.py)
and are keyed by `sha256(canonical_smiles)`. The widget hashes the exact SMILES
in the browser. If an image is missing, it draws that SMILES with RDKit.js
(jsDelivr, loaded only on demand). It never shows a picture filed under another
spelling.

The 2026-09-01 build contains 630,646 compounds across 51 libraries. Six source
rows are missing from the engine and are left out. The output is 5,048 chunk
files (235 MB) plus 630,646 SVGs (about 6.5 GB). Generated data stays outside Git.

## Hosting layout

Serve one directory from a CDN, for example `https://catalog.pyxis-discovery.com/`:

```
index.html  pyxis-catalog.js  pyxis-catalog.css
data/manifest.json  data/sorts/{id,library,mw,availability}/<n>.json
svg/<aa>/<bb>/<sha256>.svg
```

The widget resolves `data/` and `svg/` relative to its own script URL. Override
them with `data-data-base` / `data-image-base`. The CDN needs:

- `Access-Control-Allow-Origin` for `.js`, `.css` and `.json`. Module scripts and
  `fetch` are CORS requests when the page is embedded in WordPress. Images are not.
- gzip/brotli for `.json`, `.svg`, `.js` and `.css`.
- Long caching for `svg/` and `data/`. After replacing data or widget files,
  purge the CDN cache so chunks from two builds are never mixed.

## WordPress

Create a page (full-width template) with a **Custom HTML** block:

```html
<div data-pyxis-catalog></div>
<script type="module" src="https://catalog.pyxis-discovery.com/pyxis-catalog.js"></script>
```

Only one catalog can appear on a page, because the URL hash
(`#pxc-sort=mw&pxc-order=asc&pxc-page=3`) holds its state. This also keeps the
back button and shared links working. WordPress strips scripts for editors
without `unfiltered_html`, so an administrator should add the block. If the
theme fights the embed, use an iframe of `index.html` instead.

## Rebuild and preview

```bash
python3 services/stock-catalog/build_catalog.py \
  --stock-csv stock-compounds-upload.csv \
  --canonical stock-20260901-canonical.tsv \
  --out-dir ./stock-catalog-data
```

For a local preview, serve a directory that holds the three `web/` files plus
`data/` and `svg/` links (for example `python3 -m http.server`). Python's server
drops connections under many parallel image requests. Those images then use the
RDKit fallback; a CDN does not have this problem.
