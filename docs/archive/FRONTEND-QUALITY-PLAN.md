# Pyxis frontend quality plan

> **Archived 2026-08-22.** Historical `:5174` quality changelog + aspirational packages.
> Cutover gates below still say “before DNS moves to 84” — **false** (DNS already on `84`).
> Do not treat as a work plan. Current authority:
> [`../POST-PROMOTION-HANDOFF.md`](../POST-PROMOTION-HANDOFF.md),
> [`../NEXT-SESSION.md`](../NEXT-SESSION.md). Legacy `:5173` is **intentionally not improved**.

## Goal

Make Pyxis feel like a focused research workbench rather than a collection of individually
working pages: clear workflows, responsive layouts, fast result handling, keyboard access,
useful loading/error states, and a restrained visual system that keeps scientific data in focus.

## Audit findings — 2026-08-03

### Highest-impact overlap/layout problems

- The dashboard footer was `position: fixed` with `z-index: 50` even though the dashboard shell
  placed it in normal document flow. It could cover the bottom of any long page. The footer now
  participates in flow.
- The dashboard header and Material Tailwind navbar were both sticky. The outer shell remains
  sticky; the inner navbar is no longer a second sticky stacking context.
- The dashboard shell and navbar lacked enough `min-w-0`/overflow constraints. Long SMILES and
  wide tables could push controls sideways or underneath another layer.
- Molstar owned a full `h-screen` card plus `85vh`, `800px` minimums, and a second page-level
  results stack. Short screens and zoomed layouts could produce a giant viewer followed by
  cramped/overlapping controls. The viewer now uses a bounded responsive `clamp()` height.
- The Simulation page used `63vh` for the editor and `70vh` for results at the same time. The
  editor now stacks on smaller screens and uses a bounded responsive height; results use a
  bounded scroll region.

### Performance findings

- Molstar catalog-price requests were previously one request per pose. The current work
  deduplicates SMILES and limits concurrency to four.
- Client route-level lazy loading is already present. The home dashboard was still importing a
  516 KB chart chunk solely for hard-coded template charts; those charts and their fictional
  metrics have been removed.
- `client/dist` is large when static viewer assets are included, but application assets are
  route-split. In the current build the largest generated chunks are UI (~404 KB), React (~333
  KB), and general vendor (~281 KB); no generated chunk exceeds Vite's 500 KB warning threshold.
  Source maps are disabled for production builds.
- The normal one-click docking handoff downloaded roughly 223 KB of PDB/SDF data, discarded it,
  and fetched the authenticated artifacts again. The dashboard now opts into a key-only response;
  the default API response remains backward compatible for other consumers.
- The Simulation page is still a large all-in-one component. Splitting it is a maintainability
  and render-performance project, not a safe one-line optimization.
- Literature, Deep Similarity and Simulation catalog searches abort stale requests and cancel on
  unmount. Do not add a client response cache without deciding invalidation and tenant/auth
  boundaries.
- `react-router-dom` 6.30.4 currently has two moderate advisories. The SPA uses fixed internal
  navigation targets and no SSR hydration, so the affected paths are not exposed by the current
  code. The available 7.18.2 upgrade has a separate high-severity RSC advisory and this app does
  not use RSC; retain the proven 6.x runtime until upstream offers a clean advisory window rather
  than taking a major upgrade that does not make the audit clean.

### UX/accessibility findings

- Result rows now have explicit **Open Viewer** and **Save SDF** actions; row-click remains a
  convenience. This avoids making a table row pretend to be a button.
- Simulation molecule actions and Control Panel result actions now use semantic buttons with
  keyboard focus. A broader form/label audit is still worthwhile.
- Molstar still needs a complete dark-mode pass for DiffDock cards, table headers, empty states
  and loading states.
- Forms need a systematic label/autocomplete/input-type audit. Do not solve this by making
  placeholders carry all instructions.
- Add a skip link and a shared status/toast primitive rather than repeating ad-hoc messages.
- At 200% zoom and mobile widths, tables should scroll within their card, not force horizontal
  scrolling on the entire dashboard.

## Completed and deployed to `84:5174`

These items are verified in source, the production build, and the deployed staging application.
The historical-result workflow was accepted without spending a new simulation credit.

- Sidebar scrolls independently at high zoom and on short screens.
- Literature/PubMed dark-mode fields and cards have explicit dark styling.
- Molstar simulation results load the full stored SDF through authenticated parent requests.
- Automatic Molstar loading uses an explicit readiness handshake and one ordered receptor-then-pose
  command, instead of iframe timing delays and eval-based retries.
- Compound names prefer catalog/IUPAC metadata when available.
- `Clear Result` clears the viewer, result table, persisted handoff keys, and URL parameters.
- The embedded Molstar page has one parent-controlled clear action rather than two competing
  clear buttons.
- Viewer storage cleanup is centralized in `client/src/utils/viewerStorage.js`.
- Timestamped frontend rollback snapshots were preserved on 84 during staging deployments. Prune
  old remote snapshots only as a deliberate operations task, not as a frontend side effect.
- Price lookups are deduplicated and concurrency-limited.
- Result rows are keyboard reachable through explicit actions and async viewer status is
  announced with `aria-live`.
- The dashboard footer no longer overlays content.
- The dashboard uses one sticky header layer instead of nested sticky elements.
- Molstar and Simulation remove the most hazardous rigid viewport-height collisions.
- Simulation range-slider CSS is in the stylesheet rather than inline `dangerouslySetInnerHTML`.
- Direct historical-result routes show an honest loading state and responsive result cards rather
  than a false empty result while the authenticated SDF is still loading.
- One-click docking shows real elapsed time, relays useful server errors, and requests a key-only
  handoff payload before opening the result page.
- The fake home-dashboard charts, sales/tasks metrics and hard-coded success rate are gone; cards
  use tenant-scoped counts returned by `/api/activity`.
- Blog rich-text output is sanitized with DOMPurify before rendering.
- Legacy and current simulation ownership shapes are both visible to non-company accounts, so a
  newly created run remains in history and can hit the cache instead of charging twice.
- Dashboard API calls consistently read the shared `access_token`/legacy `auth_token` fallback.
- Protein Folding starts with one protein entity instead of forcing a simple prediction through
  two unrelated required DNA fields.
- Literature and Deep Similarity prevent stale slower requests from replacing a newer search.
- Control Panel safely encodes exact-price SMILES path parameters, including `/`, `#`, and `?`.
- Notifications show both current and legacy simulation usernames and focus the feed on useful
  run/project activity instead of undated registration noise.
- Molecular Viewer initializes 3Dmol independently from RDKit instead of serializing both behind
  arbitrary delays; pre-readiness DiffDock structures queue safely, stale remote lookups abort,
  PubChem/CACTUS fallback is bounded to 15 seconds, and example cards are keyboard controls that
  immediately render the selected molecule.
- Dashboard Home, Notifications and Control Panel abort route-owned fetches on unmount; Control
  Panel also clears delayed ADMET refresh and transient-message timers.
- Simulation catalog searches now cancel stale browse/search requests, always start a new query at
  cursor zero, pause the previous infinite-scroll mode until the new query succeeds, normalize all
  observed direct/wrapped/single result shapes consistently, and treat an empty HTTP 200 response
  as an honest zero-result search instead of a JSON-parser failure.
- Simulation now renders its existing cart, payment and DiffDock status state; copy failures use
  non-blocking feedback, selection fallbacks stay stable across renders, and molecule-preview
  fallbacks never remove SMILES characters and accidentally depict a different structure.
- The dashboard shell initializes the visible token balance from stored account data, cancels stale
  validation/cart requests, prevents repeated cart submissions, replaces browser alerts with
  accessible status messages, labels icon-only actions, and turns the previously dead mobile search
  icon into a page finder.
- The public contact page now describes the server-controlled support workflow honestly, uses
  explicit accessible labels and native autocomplete, and aborts an in-flight submission on route
  exit.
- Currency/location lookups are timeout-bounded, payload-validated and shared for the current page
  session, avoiding repeated third-party calls as users revisit Simulation.
- Molecule checkout no longer submits or trusts a browser total: clients send catalog IDs and
  package sizes, while the server re-resolves the configured catalog and creates itemized Stripe lines
  from authoritative cents. Forged totals, unsupported sizes and missing catalog items fail before
  Stripe. New carts retain BAS codes; older carts that stored a numeric ASINEX row ID are safely
  re-resolved by their bounded exact SMILES before the same authoritative pricing step.
- Generated-molecule structure previews share one immediate, semantics-preserving PubChem fallback
  instead of scheduling five retries per result and then stripping SMILES characters. This removes
  a possible 500-request storm for a 100-result page and prevents a fallback from depicting the
  wrong molecule.
- Public and authenticated pricing now share the actual four-plan one-time credit catalog. The
  retired subscription prices, fake 14-day trial claim, browser-only Stripe configuration gate and
  nonexistent post-checkout route are gone. Only the selected plan shows progress, requests abort on
  route exit, and checkout query/session identifiers are removed from the address bar after display.
- Simulation Results no longer logs stored structure URLs or pose details in production, and all
  transient viewer feedback shares one replaceable timer that is cleared on route exit. A crafted
  legacy checkout query can no longer announce a fake purchase or erase the local molecule cart.
- Company member removal uses an accessible inline Confirm/Cancel step instead of a blocking browser
  dialog. Admin feedback also uses one lifecycle-safe timer, so an older success timeout cannot erase
  a newer error message.
- Sign-in, password-reset and sign-up requests now cancel on route exit or replacement, tolerate
  non-JSON failure responses, expose form busy/error/status semantics, and provide browser autofill
  metadata. Sign-up uses the shared lightweight auth shell instead of importing Material Tailwind.
- The public navbar exposes the maintained Home, Services, About, Insights, Plans and Contact routes
  on desktop and mobile. Signed-in mobile users can reach the dashboard or sign out, and the menu
  toggle exposes its expanded state to assistive technology.
- Dashboard, marketing and auth layouts expose a skip link to `main#main-content`.
- The broken browser-local Blog editor no longer presents drafts as public content. Historical
  `/main/blog` links redirect to the maintained Insights page, and the dormant context no longer
  seeds fabricated posts.
- RDKit remains available through the existing on-demand loader but is initialized only by
  Molecular Viewer. Public, auth and Simulation routes no longer download/compile its WebAssembly
  runtime at DOM ready. The marketing home also replaces invented customer/usage totals, sample
  docking scores, and unimplemented template promises with capabilities verified in the current app.

## Prioritized work packages

### P0 — release safety

- [x] Build client successfully after every coherent batch.
- [x] Keep source maps out of production transfer artifacts unless debugging requires them.
- [x] Keep one remote frontend rollback snapshot.
- [ ] Manually accept the critical flow on 84: sign in → search → one-click docking → result
      page → Open Viewer → row load/download → clear → hard refresh remains empty.
- [x] Verify direct historical-result links from Control Panel still open the intended run.
- [ ] Confirm 84 Atlas access and all API endpoint health before making it production.
- [x] Check the historical result at 1280×800 and a narrow 552×734 viewport: no page-level
      horizontal overflow, desktop actions remain visible, and mobile result cards replace the
      wide table.
- [ ] Complete a separate 200% browser-zoom and short-laptop pass during the next full
      search-and-dock acceptance run.

### P1 — finish the layout and visual system

- [ ] Complete Molstar dark-mode surfaces and table contrast; no light cards stranded in dark
      mode.
- [ ] Add one shared `PageHeader`/`StatusBanner`/`EmptyState` vocabulary and use it on the
      dashboard, Simulation, Literature, Deep Similarity and results pages.
- [ ] Add a skip link, visible `focus-visible` rings, `scope` on table headers, and semantic
      labels to the highest-traffic controls. Skip link is in place on dashboard, marketing and
      auth layouts; remaining work is rings/labels beyond the Molstar result tables.
- [ ] Replace remaining `...` loading/copy strings with `…`; use tabular numerals for scores,
      prices and token balances.
- [ ] Make the navbar actions collapse into a compact overflow menu before they collide at
      intermediate widths.
- [ ] Give Molstar a compact “viewer status” strip: protein, pose count, selected pose, and
      clear/reload state, separate from the action toolbar.

### P2 — split the Simulation workbench

Split `simulation.jsx` into focused components without changing API contracts:

1. `MoleculeSourcePanel`: draw, PDB/ligand search, text input, and source validation.
2. `MoleculeBrowser`: paginated catalog/search results, filter state and preview.
3. `DockingPanel`: one-click docking and DiffDock forms with shared validation/progress.
4. `ResultsPanel`: search results, selection and cart actions.
5. `SimulationPage`: orchestration, URL state and navigation only.

Keep selection/filter/pagination in the URL where deep linking is useful. Keep transient modal
state local. Add cancellation on unmount and abort stale searches before adding caching.

### P3 — measurable performance work

- [x] Remove the fake chart dependency from the home dashboard; this eliminated the 516 KB
      `vendor-charts` build chunk and the chunk-size warning.
- [ ] Use `content-visibility: auto` or virtualization for lists that can exceed 50 items.
- [ ] Cache stable catalog/literature responses with a bounded TTL and auth-safe keys.
- [ ] Cache repeated SMILES price lookups in memory for the current result view and cap total
      metadata work.
- [ ] Move SDF parsing/pose metadata extraction to a Web Worker only after profiling shows main
      thread stalls; do not add worker complexity pre-emptively.
- [ ] Finish request abort controllers across remaining route-level fetches; auth, Literature, Deep
      Similarity, Dashboard Home, Notifications, Control Panel, Molecular Viewer, Simulation,
      Contact and dashboard-shell requests are complete.
- [ ] Add performance marks for viewer load, authenticated PDB fetch, SDF parse, and first
      rendered pose.
- [ ] Add client tests for storage cleanup, SDF parsing/deduplication, simulation validation,
      responsive state decisions and stale-request cancellation.

## GPU-box opportunities

The Amsterdam box is compute-only. These are product opportunities, not permission to move the
API or MongoDB:

### Ship after service qualification

- **Reliable local one-click docking:** CPU Vina first, then AutoDock-GPU only after a real
  hardware qualification. Expose engine, queue wait and execution time in the result metadata.
- **DiffDock pose comparison:** let users compare top poses side-by-side, rank confidence, and
  send the selected pose into Molstar. First capture/validate the real response contract; do not
  invent one.
- **Bulk virtual screening:** submit a bounded SMILES batch, process it through a queue with
  per-GPU concurrency limits, and stream partial top hits. This needs a durable job model,
  quotas, cancellation and result retention before it is user-facing.
- **GPU ADMET batch:** complete the Mongo-backed worker, assert CUDA availability in the image,
  and show property cards when jobs complete. Existing queued jobs need an explicit migration/
  retry policy.
- **Trajectory/MD preview:** once CUDA GROMACS is validated, show RMSD, energy and progress
  metrics while the job runs; do not stream raw frames by default.
- **Operator GPU health:** private admin-only telemetry for queue depth, GPU utilization, VRAM,
  temperature and failed jobs. Never expose unauthenticated compute endpoints.

### Do not build yet

- Live GPU controls for ordinary users.
- Multi-GPU scheduling without measured memory/concurrency limits.
- A Kubernetes layer for one box.
- Moving API, Pyxis MongoDB, billing or auth onto the GPU machine.
- “AI features” that are just another proxy to an unvalidated external model.

## Production cutover gates

The frontend is not the only cutover dependency. Before DNS moves to 84:

1. Atlas allowlists the 84 public IP and the server can authenticate to the intended cluster.
2. The API/`pyxis-web` service is the tested replacement, not merely a static frontend clone.
3. The `/convertSTR` dependency is reachable or the configured replacement is verified; the
   current production conversion service has previously been observed unavailable.
4. Stripe live checkout has a registered webhook and a tested credit-grant path; frontend
   success pages never grant credits by themselves.
5. A route-by-route response-shape comparison against the current 83 deployment passes.
6. A rollback is rehearsed: DNS/port switch, service restart, and frontend rollback snapshot.
7. The Amsterdam GPU-box dependencies are repointed one at a time only after their own health
   checks; they are not a prerequisite for the API/frontend port swap.

## Release discipline

- Work on 84 first; do not change 83 during staging iterations.
- One coherent client batch per deployment, with a local build and focused lint before upload.
- Deploy only `client/dist`; never copy `.env`, source snapshots, or docs to the web root.
- Create one timestamped rollback snapshot before promotion and prune redundant snapshots only
  after external health verification.
- Commit source and docs separately when they have different rollback intent.
