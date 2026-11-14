# Pyxis Discovery

Repository name is `medsaas`. User-facing product is **Pyxis Discovery**.

The maintained frontend should stay recognizably Pyxis, deliver the best user
experience, and keep the Amsterdam compute-box cutover simple. That is not a
license to rewrite the product.

Git, Mac↔oracleOld sync, production approval, start mode, and
diagnose-vs-execute live in `~/.codex/AGENTS.md`. Do not create `LANDMINES.md`
here — encode traps in code and keep this file updated **in the same change**
when a path or trap moves.

**Diagnose fully; execute the small slice.**

## Invariants

- **“De-SaaS” means one-company Pyxis branding.** It does **not** mean deleting
  signup, plans, purchasing, billing, roles, companies, credits, or other working
  product behavior. Preserve controls users recognize. Do not add tenant/billing
  features without a direct request.
- **`401` is a dead session only.** The client logs out on any same-origin `401`.
  Authorization failures are `403`, validation `400`, upstream auth failures `502`.
- Metered error responses refund at `res.end()` as well as `finish`: Bun may emit
  neither response `finish` nor `close` after a disconnect. Request `close` is not
  a disconnect signal. Preserve `/api/simulation`'s `refundOnDisconnect: false`
  because its results are cached; explicit refunds clear the charge flag first.
- Credits are granted server-side from the Stripe webhook, never from the client.
  Credit packs are one-time purchases. Both plan checkout routes must use
  `server/utils/planCheckout.js`; do not duplicate the catalog or restore recurring billing.
- Company branding and role checks are server-owned. Do not trust client-only enforcement.
- MongoDB Atlas is the production application database. Do not replace it with a local dump.
  Pyxis and FinSrv use separate Atlas projects.
- OpenFold3 request/result normalization lives in `client/src/utils/openfold.js`;
  folding previews use `ProteinFoldViewer.jsx`. Preserve the PDB default for docking
  when extending the shared Molstar message format to mmCIF.
- Normal/full-staging folding history uses Atlas `folding_history` through
  `server/routes/foldingHistory.js` and `server/utils/foldMongoStore.js`.
  Every operation requires both user and company ownership. Demo history remains
  ephemeral; never advertise it as durable storage. Failed saves retry existing
  coordinates without calling the prediction provider again.
  `/api/folding-history/status` advertises history independently of staging.
  Reuse fetches the full private run; list rows intentionally omit inputs.
  Large custom MSAs are trimmed only for history, never before prediction;
  reused omitted MSAs require re-entry. Save only finite confidence metrics.
- Hosted OpenFold3 `202` results use bounded same-origin status polling in
  `server/utils/nvidiaFoldResponse.js`, with the accepting key. Never resubmit
  an accepted prediction. Empty results and polling failures refund credits.
- Protein complex + glue setup uses hosted OpenFold3 with at least two protein
  chains and a ligand. It is not AlphaFold3 and does not establish glue efficacy.
  API output format `cif` is normalized to viewer/history `mmcif`; docking retains PDB.
- Folding and molecule generation stay hosted NVIDIA services. DiffDock replacement is
  OSS DiffDock — do not re-propose NVIDIA NIM / AI Enterprise for DiffDock.
- Compute cutovers retain a measured, supported service endpoint for rollback;
  production/full-staging Asinex docking and DiffDock remain supported until a
  qualified replacement is configured; catalog retirement does not block compute.
- The replacement Compose defaults to CPU Vina without a GPU reservation.
  `autodock-gpu` is an unavailable stub, never a production default.
  Single-GPU 3060 preparation uses `deploy/box/compose.3060.yml` and
  `deploy/box/WORKSTATION-3060.md`. DiffDock writes effective per-request YAML
  because upstream YAML overrides CLI flags; prepare both docking and ESM2
  embedding weights before serving. Health is not real inference qualification.
  Set application `DIFFDOCK_NUM_POSES=10` only for an explicitly approved,
  qualified smaller workload; absent configuration preserves 100. Invalid counts
  refuse before charging. HTTP 200 with failed, empty or incomplete poses is a
  failed inference and refunds; include `server/utils/diffdockResult.js` in releases.
  When `DIFFDOCK_API_URL` explicitly changes the platform endpoint, company records
  holding the exact seeded Asinex default inherit that endpoint without Atlas edits.
  Independent company endpoints retain the request-time SSRF guard.
  Docking follows the same exact legacy-default mapping for
  `ASINEX_DOCKING_API_URL`. Store inherited company endpoints as omitted fields,
  never environment-derived loopback URLs; malformed docking payloads must fail
  before entering the persistent simulation cache.
- Missing `ADMET_CALLBACK_SECRET` refuses new ADMET queue work with 503 after
  ownership checks. Existing saved predictions remain readable; never advertise
  an unconfigured pipeline as a queued prediction that will finish.

## Architecture

- Bun workspace: `client/` React 18 + Vite; `server/` Express/Bun API; `services/`
  scientific + MCP; `deploy/` host and box.
- Routes primarily in `server/index.js`; scientific proxies also in
  `server/routes/scientificServices.js`.
- Home (formerly Simulation) is the login destination at `/dashboard/simulation`.
  History (formerly Home) stays at `/dashboard/controlpanel`; Scaffolding Hop
  (formerly Link Fragments) stays at `/dashboard/link-fragments`. Keep these
  existing URLs for saved links. Use the current labels in user-facing navigation.
- Simulation sources (catalog, stock, macrocycles, open compounds), pricing and
  checkout: read [the search/checkout contract](.agents/skills/pyxis-feature-slice/references/search-and-checkout.md)
  before changing these flows. Stock/RPX/VPX purchase through signed Pyxis offers
  and `/api/compound-shop`; ChEMBL stays discovery-only. Missing data never falls
  back to another source. Supplier catalog aliases and legacy molecule
  checkout refuse locally with `503 CATALOG_RETIRED`; company overrides cannot
  restore Asinex dependence. Credit-plan checkout remains available. Configured
  Asinex docking/DiffDock remain supported in production/full staging; preserve
  SSRF checks and failure refunds. Stock search belongs in Home (Simulation).
  Home searches Small molecules (Stock, Virtual `smallvirtual`) and Macrocycles
  (RPX, VPX) singly or together; mixed selections are `/api/owned-search`
  `source=multi` (Morgan Tanimoto only). `smallvirtual` is an owned 6.7M-row
  index (file named Asinex_Virtual, not a supplier route), never part of `both`.
  Result selection never overwrites query text; docking uses selected rows, with
  query fallback only when none are selected and explicit DiffDock ligand precedence.
  Structure previews depict exact SMILES with browser RDKit; workbook price displays
  preserve original EUR alongside fixed USD prices (1–3 tier only, at most three
  distinct compounds per order). Shipping is included; Stripe charges immediately.
  Owned results omit Formula/MW/SMILES columns but retain exact identifier previews.
  Selected pack additions are atomic and open `/dashboard/review-order`, with
  server-quoted structures, quantities and approval CSV. Home retains its visited
  workspace until the authenticated layout unmounts; hidden Home must not paginate
  or navigate on another page. Draw loads once and blocks startup autofocus while
  reserving its height.
  Verified compound payments save `compound_orders`, never grant credits. Include
  `shared/compoundPriceBook.js` in server releases. See `docs/COMPOUND-SHOP.md`.
- Scientific SQL inspection: `services/catalog-sql/README.md`. The additive
  `pyxis_catalog` schema combines stock views with all RPX/VPX source rows and
  copied vectors. Never ingest these into the legacy public search tables;
  source row numbers and search index IDs differ. This does not switch app search.
  RPX/VPX data and derived search artifacts stay on the scientific data host;
  the staging app reaches its loopback index through the private SSH tunnel.
  Do not leave dataset or dataset-backup copies on the application host.
- Home ID/exact/substructure/batch search: `services/owned-search/README.md`.
  Staging and production both use one combined similarity + graph service
  (`services/owned-search/combined.mjs`, scientific host :8276, tunnel 18276;
  app drop-ins set `MACROCYCLE_SEARCH_BASE=<base>`, `OWNED_SEARCH_BASE=<base>/graph`).
  The older shared :8274 macrocycle service is a rollback target only.
  `/api/owned-search` is source-scoped (stock/RPX/VPX/open), capability-gated by
  `/api/owned-search/status`, and never reaches retired supplier routes. Exact is
  canonical isomeric graph equality, not similarity 1.0. Graph screens stay on the
  scientific host; ship `server/utils/ownedSearch.js` with server releases.
  Generic substructure patterns can exceed the 35 s VPX scan budget and must fail
  explicitly, never return a partial scan as complete. Home multi-SMARTS annotation
  and any/all filtering operate on loaded results only, using browser RDKit and
  the supplied labeled 12–69-member preset; they do not scan the full catalog
  or infer a negative match when a structure cannot be evaluated.
- Public stock catalog for the WordPress site: `services/stock-catalog/`, a WordPress
  plugin (`[pyxis_stock_catalog]`). By owner decision it proxies the Asinex stock shop
  API and hotlinks `compounds.asinex.com` images. WordPress-only and not an 84
  artifact; never wire it into the app, where the supplier catalog/shop retirement above still applies.
- WordPress site content (not 84 artifacts). The Insights blog is the theme's
  `pyxis_insights` post type; core `posts` are disabled there.
  `services/learning-center/`: plugin serving `/learning/` (own rewrite rules,
  `glossary` reserved). Activation imports starter articles only for missing
  slugs. Its templates render inside the Timber theme's `base.twig` content block;
  `get_header()` alone loses this theme's real navigation/footer. `services/insights-agent/`: scheduled PubMed → model → Insights
  **draft** agent. Stories require an explicit macrocycle connection in their
  source, lead with that relevance, and use 150–250 words plus an original
  conceptual PNG illustration (inline and featured media). Unreviewed drafts
  never claim human review. It defaults to the direct OmniRoute free API; Claude
  subscription mode is explicit opt-in, never an automatic fallback. Its guard rejects scientific numbers absent from the abstract and any
  links other than the paper and Learning Center pages; citations are generated,
  never written by the model. Keep `WP_STATUS=draft` unless the owner opts in.
- Scientific API proxy reads must outlast the ten-minute application inference
  budget: use `deploy/nginx/scientific-timeouts.conf` in the app HTTPS server
  block (including staging). The nginx default of 60 seconds cuts off valid
  docking/folding jobs before the API can answer.
- Client builds write `.br`/`.gz` siblings for `assets/` and `ketcher/static/`;
  `server/utils/precompressedAssets.js` serves them. Ship them with `client/dist`.
- Link Fragments: `docs/LINK-FRAGMENTS.md`, `services/link-fragments/README.md`.
  Owned 3D linker archive/index, matching workers and Python RDKit refinement stay
  on the scientific data host. Two connected V2000 fragments, explicit one-based
  atom selections (original numbering) replacing an implicit or explicit H;
  geometric matching preserves fragment coordinates. Searches are owner-scoped
  background jobs over every pair in a provably safe distance window; only a
  finished full scan is "complete". Optional receptors are validated before search
  and rank every accepted pose by rigid excluded-volume overlaps before RMSD;
  receptor jobs must never use RMSD-only retention pruning; they may skip building
  only placements strictly behind the full K-th receptor key, after every torsion is scored. Private job history is
  a separate bounded SQLite database on the scientific host; interrupted scans
  restore as failed/partial, never complete. MMFF94/UFF refinement keeps uploaded atoms
  fixed and is not MOE refinement, affinity or synthesis scoring. Assembled
  products are discovery-only. History owns saved Linker searches; query deep links
  reopen that exact job. Active scans allow provisional previews; exports and
  refinement require a retained result and a server-confirmed terminal state,
  never a local polling failure. Bulk SDF export is owner-scoped and includes retained original
  products only (maximum 50), with rank/job/result and complete/partial provenance.
  Staging and consumer apps may share the scientific service. An app-only release
  can aggregate older owner-scoped terminal result APIs for bulk export; never
  restart shared science on staging-only authorization.
  Ship `services/link-fragments/sdf.mjs` with the
  application server for input parsing. Refined SDF downloads retain linker IDs,
  source atom mapping and original placement scores; new hydrogens are appended,
  so source atom numbers remain valid. RDKit molblock output alone drops SD tags.
  Optional Duplicate Window (`duplicateWindow` 0.05–5 Å) keeps distinct poses of the
  same stereo product via symmetry-aware unaligned heavy-atom RMSD; it disables
  top-K deferral and is shown only when the service advertises
  `capabilities.duplicateWindow`. It never merges different chemistry.
- Client routes: `client/src/routes.jsx`. Use `API_CONFIG.buildApiUrl()` for `/api/*`
  and `API_CONFIG.buildUrl()` for top-level routes.
- Auth state: `client/src/context/auth.jsx`. Session logout interceptor:
  `client/src/utils/authInterceptor.js`.
- Amsterdam box is **compute-only** (docking, DiffDock, conversion, Tanimoto/Postgres,
  GROMACS, ADMET, glioblastoma). It does not receive the application API or MongoDB.
- Full staging at `/staging/` uses `PYXIS_STAGING_MODE=true` and
  `PYXIS_DEMO_MODE=false`. It shares production Atlas, accounts, history, credits,
  orders, and providers. Browser storage is namespaced, but data is not isolated.
  See `docs/STAGING.md` and `deploy/staging/README.md`.
- Host identities, release evidence, and backup locations belong in private operator
  records. Read `docs/OPERATIONS.md` before remote work and measure current state.
- `SDF_CONVERTER_URL` has a retired-host fallback in code. Measure the deployed
  environment before changing it; a code default is not deployment policy.
- Root, `client/`, and `server/` keep both Bun and npm lockfiles. After a dependency
  change run `bun run lockfiles:refresh` and commit both families.

## Conditional docs

Read only the entry that matches the task; ordinary edits do not require ops runbooks.

| Task | Read |
| --- | --- |
| Deploy, host identity, rollback, or leftover copies | `docs/OPERATIONS.md`, then the relevant private operator record |
| Compute cutover | `docs/ARRIVAL-RUNBOOK.md` and `docs/BOX-ARCHITECTURE.md` |
| Roadmap or unclear priority | `GOAL.md` |
| Docking | `docs/DOCKING-CONTRACT.md` |
| Staging, demo mode, or folding history | `docs/STAGING.md` and `deploy/staging/README.md` |
| Other documentation | `docs/README.md` |

Use global `graphify` only when `graphify-out/` exists or explicitly requested.
Keep shared docs about maintained behavior; do not append private incident,
account, purchasing, host, or deployment histories. Existing private records are
located through `docs/OPERATIONS.md` and must be checked against current evidence.

## Local development

Start with `git status --short`, then read only the files/docs relevant to the task.
Do not start Mongo to make the app work: application data is Atlas. The legacy
`services:up` command still starts local Mongo; it is not application setup.
`bun run dev` invokes an informational `predev` that never writes configuration
or starts services; `bun run dev:bun` starts both services directly. Use the
approved Atlas configuration. Necessary credential-file edits follow authorized
task scope and protection rules; do not require the user to name filenames.
Frontend-only preview: `bun --cwd=client run dev` (API must be available separately).

## Commands

```bash
bun run dev:bun           # API + Vite; skips informational predev
bun run check             # server compile + client build
bun run lint
bun run test              # server suite
bun run ci                # full gate
bun run test:staging-demo # demo/staging server contract (fixtures, privacy, refusals)
bun run test:staging-simulation # staging Simulation: catalog/search/docking/artifacts against fixture upstreams
bun run test:staging-build # staging client build scoping checks
bun run test:compound-shop   # signed offers, payment retries, orders and cart lifecycle
bun run test:link-fragments  # matching, explicit-H, jobs, refinement (RDKit host), API and UI lifecycle
bun run test:catalog-pricing # supplier retirement, molecule refusal, credit plans + UI
bun run test:macrocycle-index # macrocycle index contract: RDKit parity, format-1/2, count stream
bun run test:count-morgan    # count-Morgan support parity vs RDKit + count Tanimoto/Dice math
bun --cwd=server run test:folding-history # normal-app history, privacy and restart durability
bun --cwd=server run test:owned-search # owned ID/exact/substructure/batch merge + precompressed assets
```

Staging build (never for the live tree): `bun --cwd=client run build:staging`
writes `client/dist` in staging mode — re-run the normal `bun --cwd=client run
build` before packing anything for production.

Pick the smallest convincing check:

- UI / routing: `build` or `check`, nearest `test:*` lifecycle, one real browser path when feasible.
- Server / auth / billing: compile check + nearest focused server test; full server suite when shared middleware changes.
- Branding: include `bun run test:brand`.
- Docking / box: service-level tests plus the real contract verifier in `docs/DOCKING-CONTRACT.md`.
  Replay fixtures are not arrival evidence.
- Shared config / dependency / release boundary: `bun run ci` when justified.

Loose grep and mocked fixtures have produced false confidence here. A build alone
does not prove a dashboard flow.

## Release

Production deploy is manual. Source upload, built `client/dist`, service restart, and
deployed identity are separate — follow the current runbook; do not reconstruct
commands from memory. Pushes run CI and do **not** deploy. After a finished
shippable live-app change that actually runs on 84, **ask** whether to deploy
it unless the user already authorized deployment this turn. Docs, skills, hooks
and agent settings have no live artifact and do not require a deploy question.

Begin remote work with read-only identity, DNS, listener, service, build, and database
checks. On shared hosts, never modify nginx, TLS, DNS, firewall, unrelated apps, or
database volumes unless the user names that action. Kill only measured PIDs or named
units — never broad `pkill`.

## Claude automation

`CLAUDE.md` imports this file. `.claude/skills/` links to `.agents/skills/`;
maintain the source, not a duplicate. The post-edit Biome hook lints only the
changed supported source file, never formats or fixes it, and reports diagnostics
as model context. It does not replace the final focused check and does not catch
shell-based edits. The secret-file hook is an authorization reminder for file
editing tools, not a sandbox; global approval/secrecy rules still apply.

## Skills and subagents

Subagent limits: `~/.codex/AGENTS.md` (Skills, subagents, cheap mode). Use the named skill when the trigger fits.

| Trigger | Use |
|---|---|
| Box arrival, cutover prep, arrival readiness | `pyxis-arrival` |
| Express `/api` routes, auth middleware, credits, proxies, 401/403/502 | `pyxis-api-route` |
| Product behavior / Simulation sources / basket or checkout / the right test harness | `pyxis-feature-slice` |
| Explicit coding-box readiness / bun missing / lockfile or local-mongo confusion | `/pyxis-dev-ready` (user-only; normal startup commands are above) |
| Read-only topology / runbook / deploy-risk / live-identity audit | `pyxis_ops` (Codex) / `pyxis-ops` (Claude) |
| Improvements everywhere / vibe coding / agent setup (in this repo) | `mac-oracleold-sync`. Usual: this repo’s product leftovers **and** AGENTS.md / skills / hooks **and** Mac+151 files that serve medsaas. Not FinSrv product, Hermes, or 83-kill. “Agent setups for everything” also covers globals + `finbs` agent files — how in `~/.codex/AGENTS.md`. A product-only ask stays product-only. Recommend 1–2 per type, then implement. |

Do not spawn `pyxis-ops` for ordinary one-file work.

Deployment history and rollback locations live in private operator records;
`docs/OPERATIONS.md` explains access. Never treat a dated hash as live identity.
