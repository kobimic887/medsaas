# Pyxis stock catalog (WordPress plugin)

This is the Asinex stock shop listing (`stock.asinex.com:5443/compounds`) with Pyxis
branding, served from `www.pyxis-discovery.com`. It has no structure editor and no
ID/filter search. The page is a 25-per-page grid showing the ID, structure, MW,
formula and availability. Visitors can sort by ID, library, MW or availability,
and clicking the active sort reverses it. **Order** links to the Pyxis web-shop
(`app.pyxis-discovery.com/dashboard/simulation`).

The page uses the same data as the Asinex page, by owner decision:

| What | Where it comes from |
|---|---|
| Compound pages | Asinex shop API `POST https://stock.asinex.com:5443/api/Shop`, through this plugin's proxy |
| Structure images | Asinex CloudFront: `https://compounds.asinex.com/<LIB>/<first 4 digits>/<LIB><digits>.svg` |
| Missing images (CloudFront 403) | Drawn in the browser from the row's SMILES with RDKit.js (jsDelivr, loaded only when needed) |

The shop API sends no CORS headers, so a browser on the Pyxis site cannot call
it directly. The plugin therefore exposes a fixed, read-only route:
`GET /wp-json/pyxis-catalog/v1/compounds?sort=id|library|mw|availability&order=asc|desc&page=N`.
It forwards only those three values, refuses anything else with `400`, and
returns `502` when the shop fails. Note that the shop sometimes reports errors
as HTTP 200 with a `SystemError` body. Pages 0–39 of each sort are cached as
10-minute transients; deeper pages are not, so crawlers cannot fill `wp_options`.

This is a WordPress artifact only. Nothing here runs on the app host, and it
must never be wired into the Pyxis app, where the no-Asinex rules in
`AGENTS.md` still apply.

| Path | Purpose |
|---|---|
| `wordpress/pyxis-stock-catalog/pyxis-stock-catalog.php` | Shortcode `[pyxis_stock_catalog]` + REST proxy (PHP 7.4+) |
| `wordpress/pyxis-stock-catalog/assets/pyxis-catalog.js` | Widget (ES module). Pure helpers are exported for `test.mjs` |
| `wordpress/pyxis-stock-catalog/assets/pyxis-catalog.css` | Styles scoped under `.pxc`, using the brand site's colours and Poppins |
| `test.mjs` | Image path, formatting and URL-hash contract (`bun run test:stock-catalog`) |
| `test/wp-harness.php` | Minimal WordPress stand-in for running the plugin with `php -S` |

## Install on WordPress

1. Zip the plugin directory:
   `cd services/stock-catalog/wordpress && zip -r pyxis-stock-catalog.zip pyxis-stock-catalog`.
2. Go to WP admin → Plugins → Add New → Upload, then install and activate.
3. Create a page (full-width template works best) that contains the shortcode
   `[pyxis_stock_catalog]`, and add it to the menu.
   `[pyxis_stock_catalog shop_url="https://…"]` overrides the Order link.

Only one catalog can appear on a page, because the URL hash
(`#pxc-sort=mw&pxc-order=asc&pxc-page=3`) holds its state. This also keeps the
back button and shared links working. When updating the plugin, bump
`PYXIS_CATALOG_VERSION` so browsers fetch the new JS/CSS.

## Verify

```bash
bun run test:stock-catalog
# PHP + browser, with no WordPress install (PHP 7.4 in Docker, e.g. on oracleOld):
docker run --rm -p 127.0.0.1:8790:8790 -v "$PWD/services/stock-catalog":/app -w /app \
  php:7.4-cli php -S 0.0.0.0:8790 test/wp-harness.php
# then open http://127.0.0.1:8790/ — the proxy calls the live shop API
```

The upstream shop takes about 1–3 s per uncached page; the widget prefetches the
next page.
